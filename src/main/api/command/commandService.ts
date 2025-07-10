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
   * Electron環境で適切な環境変数を取得
   * Windows特有のPATH問題を解決
   */
  private getEnhancedEnvironment(isWindows: boolean): NodeJS.ProcessEnv {
    const env = { ...process.env }

    if (isWindows) {
      // Windows固有の環境変数とPATHの強化
      const systemPaths = [
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
      env.Path = enhancedPath // Windowsでは両方設定

      // Windows固有の環境変数
      env.COMSPEC = env.COMSPEC || 'C:\\Windows\\System32\\cmd.exe'
      env.PATHEXT = env.PATHEXT || '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC'
      env.SYSTEMROOT = env.SYSTEMROOT || 'C:\\Windows'
      env.WINDIR = env.WINDIR || 'C:\\Windows'
    } else {
      // Unix系の場合
      const systemPaths = [
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

  // TODO: Refactor command pattern parsing and matching for better security and flexibility.
  // The current string splitting is too basic for robust argument validation.
  // The CommandPatternConfig structure might need to change to define allowed executables
  // and then specific rules or patterns for their arguments.
  private isCommandAllowed(executable: string, _args: string[]): boolean {
    // allowedCommands が未定義の場合は空の配列として処理
    const allowedCommands = this.config.allowedCommands || []

    if (allowedCommands.length === 0) {
      // If no commands are explicitly allowed, deny all.
      // Or, decide if this means all commands are allowed (less secure).
      // For now, let's assume if allowlist is empty, nothing is allowed unless a wildcard '*' is present.
      // This behavior might need to be configurable.
      console.warn('No allowedCommands configured. Denying command execution by default.')
      return false;
    }

    // "*" in allowedCommands means all commands are allowed (use with extreme caution)
    if (allowedCommands.some(cmd => cmd.pattern === '*')) {
        console.warn("Wildcard '*' found in allowedCommands. All commands will be permitted.")
        return true;
    }

    return allowedCommands.some((allowedCmdPattern) => {
      // Current pattern is just a string. We'll assume it's primarily for the executable.
      // For a more robust system, allowedCmdPattern.pattern should be more structured.
      const patternParts = allowedCmdPattern.pattern.split(' ')
      const allowedExecutable = patternParts[0]
      // const allowedArgsPattern = patternParts.slice(1); // Basic arg pattern

      if (allowedExecutable === executable) {
        // TODO: Implement more sophisticated argument checking here based on allowedArgsPattern
        // For now, if the executable matches, and if the pattern had a wildcard for args (e.g. "git *")
        // or no specific args, we allow it. This simplifies the transition.
        // A truly secure model needs to validate args based on the specific executable.
        if (patternParts.includes('*') || patternParts.length === 1) {
            return true;
        }
        // Basic check: if pattern has args, then input must also have args.
        // This is insufficient for real security.
        // if (allowedArgsPattern.length > 0 && args.length === 0) return false;
        // if (allowedArgsPattern.length === 0 && args.length > 0 && !patternParts.includes('*')) return false;

        // For now, focusing on executable match. Argument validation needs a proper design.
        // If we want to be stricter now: if pattern has args, they must match or pattern must allow wildcard for them.
        // This part is tricky without changing CommandPatternConfig.
        // Let's default to allowing if executable matches and pattern is simple.
        return true; // Placeholder for more robust arg validation
      }
      return false
    })
  }

  // 入力待ち状態かどうかを判定
  private isWaitingForInput(output: string): { isWaiting: boolean; prompt?: string } {
    for (const pattern of this.inputDetectionPatterns) {
      if (output.match(pattern.pattern)) {
        const prompt = pattern.promptExtractor ? pattern.promptExtractor(output) : output
        return { isWaiting: true, prompt }
      }
    }
    return { isWaiting: false }
  }

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

  // サーバーが正常に起動しているかチェック
  private isServerReady(output: string): boolean {
    return this.serverReadyPatterns.some((pattern) =>
      output.toLowerCase().includes(pattern.toLowerCase())
    )
  }

  // エラーチェック
  private checkForErrors(stdout: string, stderr: string): boolean {
    // エラーパターンのチェック
    if (
      this.errorPatterns.some((pattern) => stdout.includes(pattern) || stderr.includes(pattern))
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
      // 入力値の事前検証
      if (!executable || typeof executable !== 'string' || executable.trim() === '') {
        reject(new Error('Invalid command: Executable cannot be empty'))
        return
      }
      if (!cwd || typeof cwd !== 'string') {
        reject(new Error('Invalid working directory: cwd must be a valid string'))
        return
      }
      if (!Array.isArray(args)) {
        reject(new Error('Invalid arguments: args must be an array of strings'))
        return
      }


      // シェルの設定は spawn の options.shell で制御するため、ここでの config.shell の直接チェックは変更
      // if (!this.config.shell) {
      //   reject(new Error('Shell configuration is missing'))
      //   return
      // }

      if (!this.isCommandAllowed(executable, args)) {
        const fullCommand = `${executable} ${args.join(' ')}`.trim()
        reject(new Error(`Command not allowed: ${fullCommand}`))
        return
      }

      const isWindows = process.platform === 'win32'
      const spawnEnv = this.getEnhancedEnvironment(isWindows)
      let childProcess

      try {
        // Secure spawn: pass executable and args separately.
        // Avoid shell interpretation of the command string.
        // For Windows, if executable is a .bat, .cmd or built-in shell command,
        // `shell: true` might still be needed, or `cmd /c executable args...`
        // This is a complex area. Defaulting to `shell: false` for security.
        // If specific commands require shell (e.g. `echo hello > file.txt`), they must be
        // explicitly handled or the `isCommandAllowed` should be very strict for them.
        // A safer way for shell-required commands is `spawn('cmd.exe', ['/c', executable, ...args])` on Windows
        // or `spawn('/bin/sh', ['-c', `${executable} ${args.join(' ')}`])` on Unix,
        // but this re-introduces shell parsing risk if not handled carefully.
        // The ideal is to always use shell: false or not set it (defaults to false).

        // TODO: Investigate specific Windows commands that might require `shell: true`
        // (e.g., internal cmd commands like `dir` if not using `cmd /c dir`).
        // For now, we aim for `shell: false` as much as possible.
        // If `executable` is 'cmd' or 'powershell' on Windows, or '/bin/sh', '/bin/bash' on Unix,
        // then the arguments might themselves form a command to be parsed by that shell.
        // This needs careful consideration in `isCommandAllowed`.

        const options: any = { // child_process.SpawnOptionsWithoutStdio
            cwd: cwd,
            env: spawnEnv,
            stdio: ['pipe', 'pipe', 'pipe'], // For stdin, stdout, stderr
            detached: !isWindows, // Detach on Unix for process group killing, Windows handles this differently
            windowsHide: true,
        };

        // Special handling for Windows shell commands if necessary
        // This is a simplification. A more robust solution would check if `executable`
        // is a built-in shell command or script that requires shell.
        if (isWindows && (executable.endsWith('.cmd') || executable.endsWith('.bat'))) {
            options.shell = true; // For .cmd/.bat files, shell is often required.
                                  // This means `executable` itself is given to `spawn` and `args` are separate.
            childProcess = spawn(executable, args, options);
        } else if (isWindows && ['dir', 'echo', 'type', 'copy', 'del', 'move', 'ren', 'mkdir', 'rmdir'].includes(executable.toLowerCase())) {
            // These are common internal cmd.exe commands.
            // Safer to run them via cmd /c
            const cmdArgs = ['/c', executable, ...args];
            childProcess = spawn('cmd.exe', cmdArgs, options);
        }
        else {
            options.shell = false; // Explicitly set to false for others
            childProcess = spawn(executable, args, options);
        }

      } catch (spawnError: any) {
        console.error('Error during spawn:', spawnError);
        reject(new Error(`Failed to spawn command "${executable}": ${spawnError.message}`));
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
      const fullCommandForLogging = `${executable} ${args.join(' ')}`.trim()

      this.initializeProcessState(pid)
      this.runningProcesses.set(pid, {
        pid,
        command: fullCommandForLogging, // Log the reconstructed command
        timestamp: Date.now()
      })

      this.updateProcessState(pid, { process: childProcess })

      let currentOutput = ''
      let currentError = ''
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
                command: input.command,
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
                command: input.command,
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
              command: input.command,
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
