import { spawn } from 'child_process'
import {
  CommandConfig,
  CommandExecutionResult,
  CommandInput,
  CommandPattern,
  CommandStdinInput,
  DetachedProcessInfo,
  InputDetectionPattern,
  ProcessState,
  CommandPatternConfig,
  CommandInput as CommandServiceInput // Renaming for clarity within this file
} from './types'

export class CommandService {
  private config: CommandConfig
  private runningProcesses: Map<number, DetachedProcessInfo> = new Map()
  private processStates: Map<number, ProcessState> = new Map()

  // 入力待ち状態を検出するパターン
  private inputDetectionPatterns: InputDetectionPattern[] = [
    {
      pattern: /\? .+\?.*$/m, // inquirer形式の質問
      promptExtractor: (output) => {
        const match = output.match(/\? (.+\?.*$)/m)
        return match ? match[1] : output
      }
    },
    {
      pattern: /[^:]+: $/m, // 基本的なプロンプト（例: "Enter name: "）
      promptExtractor: (output) => {
        const lines = output.split('\n')
        return lines[lines.length - 1]
      }
    }
  ]

  // サーバー起動状態を示すパターン
  private serverReadyPatterns = [
    'listening',
    'ready',
    'started',
    'running',
    'live',
    'compiled successfully',
    'compiled',
    'waiting for file changes',
    'development server running'
  ]

  // エラーを示すパターン
  private errorPatterns = [
    'EADDRINUSE',
    'Error:',
    'error:',
    'ERR!',
    'app crashed',
    'Cannot find module',
    'command not found',
    'Failed to compile',
    'Syntax error:',
    'TypeError:',
    // Windows固有のエラーパターン
    'The system cannot find the file specified',
    'Access is denied',
    'The filename, directory name, or volume label syntax is incorrect',
    'is not recognized as an internal or external command',
    'The process cannot access the file because it is being used by another process',
    'ENOENT',
    'EACCES'
  ]

  constructor(config: CommandConfig) {
    this.config = config
  }

  /**
   * Retrieves and enhances environment variables for command execution.
   * This method is particularly important for ensuring commands can find necessary executables,
   * resolving common PATH issues, especially in packaged Electron applications or diverse OS environments.
   * @param isWindows Indicates if the current platform is Windows.
   * @returns A NodeJS.ProcessEnv object with potentially augmented PATH and other relevant variables.
   */
  private getEnhancedEnvironment(isWindows: boolean): NodeJS.ProcessEnv {
    const env = { ...process.env }

    // Common system paths that might be missing in some environments.
    // These are added to the existing PATH to increase chances of finding common CLIs.
    if (isWindows) {
      const systemPaths = [
        // Standard Windows paths
        'C:\\Windows\\System32',
        'C:\\Windows',
        'C:\\Windows\\System32\\Wbem',
        'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\',
        'C:\\Program Files\\Amazon\\AWSCLIV2', // AWS CLI v2
        'C:\\Program Files (x86)\\Amazon\\AWSCLIV2',
        'C:\\Program Files\\Git\\cmd', // Git
        'C:\\Program Files\\nodejs', // Node.js
        'C:\\Users\\Public\\chocolatey\\bin', // Chocolatey
        'C:\\ProgramData\\chocolatey\\bin'
      ]

      // 既存のPATHに追加
      const currentPath = env.PATH || env.Path || ''
      const enhancedPath = [currentPath, ...systemPaths].filter(Boolean).join(';')

      env.PATH = enhancedPath
      env.Path = enhancedPath // Ensure both casings are covered for Windows PATH

      // Set essential Windows environment variables if not already present.
      env.COMSPEC = env.COMSPEC || 'C:\\Windows\\System32\\cmd.exe'
      env.PATHEXT = env.PATHEXT || '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC'
      env.SYSTEMROOT = env.SYSTEMROOT || 'C:\\Windows' // Often required by system utilities
      env.WINDIR = env.WINDIR || 'C:\\Windows'
    } else {
      // For Unix-like systems (Linux, macOS)
      const systemPaths = [
        // Standard Unix paths
        '/usr/local/bin',
        '/usr/bin',
        '/bin',
        '/usr/sbin',
        '/sbin',
        '/opt/homebrew/bin', // macOS Homebrew (Apple Silicon)
        '/usr/local/aws-cli/v2/current/bin' // AWS CLI v2
      ]

      const currentPath = env.PATH || ''
      const enhancedPath = [currentPath, ...systemPaths].filter(Boolean).join(':')

      env.PATH = enhancedPath
    }

    return env
  }

  /**
   * Validates if the given executable and arguments are permitted based on the configured allowlist.
   * @param executable The command executable (e.g., "git", "npm").
   * @param args An array of arguments for the executable.
   * @returns True if the command is allowed, false otherwise.
   */
  private isCommandAllowed(executable: string, args: string[]): boolean {
    const allowedCommands = this.config.allowedCommands || []

    if (allowedCommands.length === 0) {
      // It's crucial to default to deny if no rules are set.
      console.warn('CommandService: No allowedCommands configured. Denying all command execution by default.')
      return false
    }

    for (const pattern of allowedCommands) {
      // Check if the executable matches. A pattern with executable '*' is a wildcard for any executable.
      if (pattern.executable === '*' || pattern.executable === executable) {

        // If pattern.allowedArgs is undefined or empty, it means this pattern doesn't restrict arguments.
        if (!pattern.allowedArgs || pattern.allowedArgs.length === 0) {
          // If no specific args are defined in pattern, then:
          // - If allowSubsequentArgs is true, any arguments are fine.
          // - If allowSubsequentArgs is false/undefined, only no arguments are fine.
          if (pattern.allowSubsequentArgs || args.length === 0) {
            return true // Command allowed by this pattern
          }
          // If subsequent args are not allowed, but args were provided, this pattern does not match.
          // Continue to the next pattern.
          if (!pattern.allowSubsequentArgs && args.length > 0) {
            continue
          }
        } else {
          // Specific arguments are defined in the pattern. Validate them.
          if (args.length < pattern.allowedArgs.length && !pattern.allowSubsequentArgs) {
            // Not enough arguments provided by the command to match the pattern,
            // and subsequent arguments are not allowed.
            continue // Try next pattern
          }

          let  argsPatternMatch = true
          for (let i = 0; i < pattern.allowedArgs.length; i++) {
            const patternArgRule = pattern.allowedArgs[i]
            const actualArg = args[i]

            if (actualArg === undefined) {
              // Command provided fewer arguments than this pattern expects.
              argsPatternMatch = false;
              break;
            }

            if (typeof patternArgRule === 'string') {
              if (patternArgRule !== actualArg) {
                argsPatternMatch = false
                break
              }
            } else if (patternArgRule instanceof RegExp) {
              if (!patternArgRule.test(actualArg)) {
                argsPatternMatch = false
                break
              }
            } else {
              // Should not happen if CommandPatternConfig is correctly typed and used.
              console.warn(`CommandService: Invalid type in allowedArgs for pattern: ${pattern.executable}`)
              argsPatternMatch = false
              break
            }
          }

          if (argsPatternMatch) {
            // All arguments defined in pattern.allowedArgs have matched.
            // Now, check if subsequent arguments are allowed or if the count must be exact.
            if (pattern.allowSubsequentArgs) {
              return true // Command allowed by this pattern
            } else {
              // Not allowing subsequent arguments, so the number of actual args must exactly match pattern's args.
              if (args.length === pattern.allowedArgs.length) {
                return true // Command allowed by this pattern
              } else {
                // Exact number of arguments mismatch.
                continue // Try next pattern
              }
            }
          }
          // Arguments did not match this pattern's rules. Continue to the next pattern.
        }
      }
    }
    // If no pattern matched after checking all of them.
    console.warn(`CommandService: Command not allowed: '${executable} ${args.join(' ')}'. No matching allowlist pattern.`)
    return false
  }

  /**
   * Detects if the process output indicates it's waiting for user input.
   * @param output The process output string.
   * @returns An object with `isWaiting` (boolean) and an optional `prompt` string.
   */
  private isWaitingForInput(output: string): { isWaiting: boolean; prompt?: string } {
    for (const pattern of this.inputDetectionPatterns) {
      if (output.match(pattern.pattern)) {
        const prompt = pattern.promptExtractor ? pattern.promptExtractor(output) : output
        return { isWaiting: true, prompt }
      }
    }
    return { isWaiting: false }
  }

  /**
   * Initializes the state for a new process.
   * @param pid The process ID.
   */
  private initializeProcessState(pid: number): void {
    this.processStates.set(pid, {
      isRunning: true,
      hasError: false,
      output: {
        stdout: '',
        stderr: '',
        code: null
      }
    })
  }

  private updateProcessState(pid: number, updates: Partial<ProcessState>): void {
    const currentState = this.processStates.get(pid)
    if (currentState) {
      this.processStates.set(pid, { ...currentState, ...updates })
    }
  }

  /**
   * Checks if the process output suggests a server or development process is ready.
   * @param output The process output string.
   * @returns True if a ready pattern is found, false otherwise.
   */
  private isServerReady(output: string): boolean {
    return this.serverReadyPatterns.some((pattern) =>
      output.toLowerCase().includes(pattern.toLowerCase())
    )
  }

  /**
   * Checks for common error indicators in process output.
   * @param stdout Standard output string.
   * @param stderr Standard error string.
   * @returns True if an error pattern is matched, false otherwise.
   */
  private checkForErrors(stdout: string, stderr: string): boolean {
    const combinedOutput = `${stdout}\n${stderr}`.toLowerCase();
    if (
      this.errorPatterns.some((pattern) => combinedOutput.includes(pattern.toLowerCase()))
    ) {
      return true
    }

    // クラッシュ状態のチェック
    if (stdout.includes('app crashed') && !stdout.includes('waiting for file changes')) {
      return true
    }

    return false
  }

  async executeCommand(input: CommandServiceInput): Promise<CommandExecutionResult> {
    const { executable, args, cwd } = input;

    return new Promise((resolve, reject) => {
      // Validate input parameters
      if (!executable || typeof executable !== 'string' || executable.trim() === '') {
        return reject(new Error('Invalid command: Executable cannot be empty.'))
      }
      if (!cwd || typeof cwd !== 'string') {
        return reject(new Error('Invalid working directory: CWD must be a valid string.'))
      }
      if (!Array.isArray(args) || !args.every(arg => typeof arg === 'string')) {
        return reject(new Error('Invalid arguments: Args must be an array of strings.'))
      }

      // Check if the command is allowed by the configured patterns
      if (!this.isCommandAllowed(executable, args)) {
        const fullCommand = `${executable} ${args.join(' ')}`.trim()
        return reject(new Error(`Command not allowed by security configuration: ${fullCommand}`))
        return
      }

      const isWindows = process.platform === 'win32'
      const spawnEnv = this.getEnhancedEnvironment(isWindows)
      let childProcess

      try {
        // Spawn the process.
        // The primary security measure here is that `executable` and `args` are passed separately,
        // and `shell: false` (or its default behavior) is used for most cases, preventing the OS
        // from interpreting the command string as a whole through a shell.
        const spawnOptions: any = {
            cwd: cwd,
            env: spawnEnv,
            stdio: 'pipe', // ['pipe', 'pipe', 'pipe'] is equivalent for stdin, stdout, stderr
            detached: !isWindows,
            windowsHide: true,
            shell: false // Default to false for security, override below if necessary
        };

        // Platform-specific considerations for shell usage:
        // Certain commands on Windows (batch files, internal cmd commands) might require a shell.
        // On Unix, `shell: false` is generally safer.
        if (isWindows) {
          if (executable.endsWith('.cmd') || executable.endsWith('.bat')) {
            // Batch/cmd scripts typically require a shell to interpret them.
            // Spawning the script directly with `shell: true` is one way.
            // Args are still passed separately to the script itself.
            spawnOptions.shell = true;
            childProcess = spawn(executable, args, spawnOptions);
          } else if (['dir', 'echo', 'type', 'copy', 'del', 'move', 'ren', 'mkdir', 'rmdir'].includes(executable.toLowerCase())) {
            // For common internal cmd.exe commands, it's safer to explicitly invoke cmd.exe.
            const cmdArgs = ['/c', executable, ...args];
            childProcess = spawn('cmd.exe', cmdArgs, spawnOptions); // shell:false is fine here as cmd.exe is the executable
          } else {
            // For other executables on Windows, attempt direct execution.
            childProcess = spawn(executable, args, spawnOptions);
          }
        } else {
          // On Unix-like systems, direct execution without a shell is preferred.
          childProcess = spawn(executable, args, spawnOptions);
        }
      } catch (spawnError: any) {
        console.error(`CommandService: Error during process spawn for "${executable}"`, { error: spawnError });
        reject(new Error(`Failed to spawn command "${executable}": ${spawnError.message || 'Unknown spawn error'}`));
        return;
      }


      if (typeof childProcess.pid === 'undefined') {
        const fullCommand = `${executable} ${args.join(' ')}`.trim()
        const errorMessage = `Failed to start process: PID is undefined. Command: "${fullCommand}"`
        console.error('Process spawn failed details:', {
          executable,
          args,
          cwd,
          platform: process.platform,
          spawnfile: childProcess.spawnfile,
          spawnargs: childProcess.spawnargs,
          error: childProcess.error // if any
        })
        reject(new Error(errorMessage))
        return
      }

      const pid = childProcess.pid
      const fullCommandForLogging = `${executable} ${args.join(' ')}`.trim() // For logging and messages

      this.initializeProcessState(pid)
      this.runningProcesses.set(pid, {
        pid,
        command: fullCommandForLogging,
        timestamp: Date.now()
      })
      this.updateProcessState(pid, { process: childProcess })

      let currentOutput = '' // Accumulates stdout
      let currentError = '' // Accumulates stderr
      let isCompleted = false

      const cleanup = () => {
        this.runningProcesses.delete(pid)
        this.processStates.delete(pid)
      }

      const completeWithError = (error: string) => {
        if (!isCompleted) {
          isCompleted = true
          cleanup()
          reject(new Error(error))
        }
      }

      const completeWithSuccess = () => {
        if (!isCompleted) {
          const state = this.processStates.get(pid)
          if (!state) {
            reject(new Error('Process state not found'))
            return
          }

          // 入力待ち状態のチェック
          const { isWaiting, prompt } = this.isWaitingForInput(currentOutput)
          if (isWaiting) {
            resolve({
              stdout: currentOutput,
              stderr: currentError,
              exitCode: 0,
              processInfo: {
                pid,
                command: fullCommandForLogging, // Use the reconstructed command for info
                detached: true
              },
              requiresInput: true,
              prompt
            })
            return
          }

          // 開発サーバーの状態チェック
          if (this.isServerReady(currentOutput)) {
            resolve({
              stdout: currentOutput,
              stderr: currentError,
              exitCode: 0,
              processInfo: {
                pid,
                command: fullCommandForLogging, // Use the reconstructed command for info
                detached: true
              }
            })
            return
          }

          // 通常のコマンド完了
          isCompleted = true
          cleanup()
          resolve({
            stdout: currentOutput,
            stderr: currentError,
            exitCode: state.output.code || 0,
            processInfo: {
              pid,
              command: fullCommandForLogging, // Use the reconstructed command for info
              detached: true
            }
          })
        }
      }

      childProcess.stdout.on('data', (data) => {
        const chunk = data.toString()
        currentOutput += chunk

        const state = this.processStates.get(pid)
        if (state) {
          this.updateProcessState(pid, {
            output: { ...state.output, stdout: currentOutput }
          })

          // エラーチェック
          if (this.checkForErrors(chunk, '')) {
            this.updateProcessState(pid, { hasError: true })
            completeWithError(`Command failed: \n${currentOutput}\n${currentError}`)
            return
          }

          // 入力待ち状態または開発サーバーの状態をチェック
          const { isWaiting } = this.isWaitingForInput(currentOutput)
          if (isWaiting || this.isServerReady(currentOutput)) {
            completeWithSuccess()
          }
        }
      })

      childProcess.stderr.on('data', (data) => {
        const chunk = data.toString()
        currentError += chunk

        const state = this.processStates.get(pid)
        if (state) {
          this.updateProcessState(pid, {
            output: { ...state.output, stderr: currentError }
          })

          // エラーチェック
          if (this.checkForErrors('', chunk)) {
            this.updateProcessState(pid, { hasError: true })
            completeWithError(`Command failed: \n${currentOutput}\n${currentError}`)
          }
        }
      })

      childProcess.on('error', (error) => {
        let errorMessage = `Command execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`

        // Windows固有のエラーの詳細情報を追加
        if (process.platform === 'win32' && error instanceof Error) {
          if (error.message.includes('ENOENT')) {
            errorMessage +=
              '\nHint: The command or shell may not be found. Please check if the command exists and the shell path is correct.'
          } else if (error.message.includes('EACCES')) {
            errorMessage +=
              '\nHint: Permission denied. Please check if you have the necessary permissions to execute this command.'
          }
        }

        completeWithError(errorMessage)
      })

      childProcess.on('exit', (code) => {
        const state = this.processStates.get(pid)
        if (state) {
          this.updateProcessState(pid, {
            isRunning: false,
            output: { ...state.output, code: code || 0 }
          })

          if (!this.checkForErrors(currentOutput, currentError) && code === 0) {
            completeWithSuccess()
          } else if (!isCompleted) {
            completeWithError(`Process exited with code ${code}\n${currentOutput}\n${currentError}`)
          }
        }
      })

      const TIMEOUT = 60000 * 5 // 5分
      // タイムアウト処理
      setTimeout(() => {
        if (!isCompleted) {
          const state = this.processStates.get(pid)
          if (!state) return

          if (state.hasError) {
            completeWithError(`Command failed to start: \n${currentError}`)
          } else {
            // 開発サーバーの状態チェック
            if (
              this.isServerReady(currentOutput) ||
              currentOutput.includes('waiting for file changes')
            ) {
              completeWithSuccess()
            } else {
              completeWithError('Command timed out')
            }
          }
        }
      }, TIMEOUT) // Multi-Agent 的な処理を見据えて長めに設定する
    })
  }

  async sendInput(input: CommandStdinInput): Promise<CommandExecutionResult> {
    const state = this.processStates.get(input.pid)
    if (!state || !state.process) {
      throw new Error(`No running process found with PID: ${input.pid}`)
    }

    return new Promise((resolve, reject) => {
      const { process: childProcess } = state
      let currentOutput = state.output.stdout
      let currentError = state.output.stderr
      let isCompleted = false

      // 既存のリスナーを削除
      childProcess.stdout.removeAllListeners('data')
      childProcess.stderr.removeAllListeners('data')
      childProcess.removeAllListeners('error')
      childProcess.removeAllListeners('exit')

      const completeWithError = (error: string) => {
        if (!isCompleted) {
          isCompleted = true
          reject(new Error(error))
        }
      }

      const completeWithSuccess = () => {
        if (!isCompleted) {
          isCompleted = true

          // 入力待ち状態のチェック
          const { isWaiting, prompt } = this.isWaitingForInput(currentOutput)

          resolve({
            stdout: currentOutput,
            stderr: currentError,
            exitCode: 0,
            processInfo: {
              pid: input.pid,
              command: childProcess.spawnargs.join(' '),
              detached: true
            },
            requiresInput: isWaiting,
            prompt: isWaiting ? prompt : undefined
          })
        }
      }

      childProcess.stdout.on('data', (data) => {
        const chunk = data.toString()
        currentOutput += chunk

        this.updateProcessState(input.pid, {
          output: { ...state.output, stdout: currentOutput }
        })

        // エラーチェック
        if (this.checkForErrors(chunk, '')) {
          this.updateProcessState(input.pid, { hasError: true })
          completeWithError(`Command failed: \n${currentOutput}\n${currentError}`)
          return
        }

        // 入力待ち状態または開発サーバーの状態をチェック
        const { isWaiting } = this.isWaitingForInput(currentOutput)
        if (isWaiting || this.isServerReady(currentOutput)) {
          completeWithSuccess()
        }
      })

      childProcess.stderr.on('data', (data) => {
        const chunk = data.toString()
        currentError += chunk

        this.updateProcessState(input.pid, {
          output: { ...state.output, stderr: currentError }
        })

        if (this.checkForErrors('', chunk)) {
          this.updateProcessState(input.pid, { hasError: true })
          completeWithError(`Command failed: \n${currentOutput}\n${currentError}`)
        }
      })

      childProcess.on('error', (error) => {
        completeWithError(
          `Command execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      })

      childProcess.on('exit', (code) => {
        this.updateProcessState(input.pid, {
          isRunning: false,
          output: { ...state.output, code: code || 0 }
        })

        if (!this.checkForErrors(currentOutput, currentError) && code === 0) {
          completeWithSuccess()
        } else if (!isCompleted) {
          completeWithError(`Process exited with code ${code}\n${currentOutput}\n${currentError}`)
        }

        // プロセスが終了したらクリーンアップ
        this.runningProcesses.delete(input.pid)
        this.processStates.delete(input.pid)
      })

      // 標準入力を送信
      childProcess.stdin.write(input.stdin + '\n')

      // タイムアウト処理
      setTimeout(() => {
        if (!isCompleted) {
          const currentState = this.processStates.get(input.pid)
          if (!currentState) return

          if (currentState.hasError) {
            completeWithError(`Command failed: \n${currentError}`)
          } else if (
            this.isServerReady(currentOutput) ||
            currentOutput.includes('waiting for file changes')
          ) {
            completeWithSuccess()
          } else {
            completeWithError('Command timed out waiting for response')
          }
        }
      }, 5000)
    })
  }

  async stopProcess(pid: number): Promise<void> {
    const processInfo = this.runningProcesses.get(pid)
    if (processInfo) {
      try {
        process.kill(-pid) // プロセスグループ全体を終了
        this.runningProcesses.delete(pid)
        this.processStates.delete(pid)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        throw new Error(`Failed to stop process ${pid}: ${errorMessage}`)
      }
    }
  }

  getRunningProcesses(): DetachedProcessInfo[] {
    return Array.from(this.runningProcesses.values())
  }

  getAllowedCommands(): CommandPatternConfig[] {
    return [...(this.config.allowedCommands || [])]
  }

  updateConfig(newConfig: CommandConfig): void {
    this.config = newConfig
  }
}
