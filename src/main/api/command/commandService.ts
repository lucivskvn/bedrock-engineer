import { createHash } from 'node:crypto'
import path from 'node:path'
import { spawn } from 'node:child_process'
import {
  CommandConfig,
  CommandExecutionResult,
  CommandInput,
  CommandStdinInput,
  DetachedProcessInfo,
  InputDetectionPattern,
  ProcessState,
  CommandPatternConfig
} from './types'
import { log } from '../../../common/logger'
import { createStructuredError, StructuredError } from '../../../common/errors'
import { ensureDirectoryWithinAllowed } from '../../security/path-utils'

const SAFE_ENV_KEY_PATTERN = /^[A-Z0-9_]+$/

const BASE_ENV_ALLOWLIST = [
  'HOME',
  'USER',
  'LOGNAME',
  'TMPDIR',
  'TEMP',
  'TMP',
  'PWD',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'SHELL',
  'TERM',
  'NODE_ENV',
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ATTACH_CONSOLE'
]

const WINDOWS_ENV_ALLOWLIST = ['SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT']

type CommandErrorCode =
  | 'COMMAND_WORKDIR_CONFIGURATION_MISSING'
  | 'COMMAND_WORKDIR_REQUIRED'
  | 'COMMAND_ARGUMENT_INVALID_CHARACTERS'
  | 'COMMAND_INPUT_EMPTY'
  | 'COMMAND_INPUT_CWD_INVALID_TYPE'
  | 'COMMAND_MAX_CONCURRENCY_REACHED'
  | 'COMMAND_WORKDIR_RESOLUTION_FAILED'
  | 'COMMAND_NOT_ALLOWED'
  | 'COMMAND_SPAWN_PID_UNDEFINED'
  | 'COMMAND_STATE_NOT_FOUND'
  | 'COMMAND_RUNTIME_FAILURE'
  | 'COMMAND_PROCESS_EXITED_WITH_ERROR'
  | 'COMMAND_TIMEOUT'
  | 'COMMAND_WAIT_TIMEOUT'
  | 'COMMAND_NO_RUNNING_PROCESS'
  | 'COMMAND_STDIN_LIMIT_EXCEEDED'
  | 'COMMAND_STOP_FAILED'

const COMMAND_ERROR_MESSAGES: Record<CommandErrorCode, string> = {
  COMMAND_WORKDIR_CONFIGURATION_MISSING: 'Command execution configuration is incomplete.',
  COMMAND_WORKDIR_REQUIRED: 'Command execution requires a working directory.',
  COMMAND_ARGUMENT_INVALID_CHARACTERS: 'Command argument validation failed.',
  COMMAND_INPUT_EMPTY: 'Command execution input is invalid.',
  COMMAND_INPUT_CWD_INVALID_TYPE: 'Command execution working directory is invalid.',
  COMMAND_MAX_CONCURRENCY_REACHED: 'Command execution concurrency limit reached.',
  COMMAND_WORKDIR_RESOLUTION_FAILED: 'Command execution working directory could not be resolved.',
  COMMAND_NOT_ALLOWED: 'Command execution rejected by allowlist.',
  COMMAND_SPAWN_PID_UNDEFINED: 'Command process did not expose a PID.',
  COMMAND_STATE_NOT_FOUND: 'Command process state is unavailable.',
  COMMAND_RUNTIME_FAILURE: 'Command execution failed.',
  COMMAND_PROCESS_EXITED_WITH_ERROR: 'Command process exited with a non-zero status.',
  COMMAND_TIMEOUT: 'Command execution timed out.',
  COMMAND_WAIT_TIMEOUT: 'Command execution did not respond before timeout.',
  COMMAND_NO_RUNNING_PROCESS: 'Command execution process is not running.',
  COMMAND_STDIN_LIMIT_EXCEEDED: 'Command stdin payload exceeds configured limit.',
  COMMAND_STOP_FAILED: 'Command process termination failed.'
}

type CommandServiceError = StructuredError<CommandErrorCode>

const createCommandError = (
  code: CommandErrorCode,
  metadata?: Record<string, unknown>
): CommandServiceError =>
  createStructuredError({
    name: 'CommandServiceError',
    message: COMMAND_ERROR_MESSAGES[code],
    code,
    metadata
  })

const toCommandError = (
  error: unknown,
  code: CommandErrorCode,
  metadata?: Record<string, unknown>
): CommandServiceError => {
  if (error instanceof Error && typeof (error as { code?: unknown }).code === 'string') {
    const structured = error as CommandServiceError
    if (metadata && Object.keys(metadata).length > 0) {
      structured.metadata = {
        ...(structured.metadata ?? {}),
        ...metadata
      }
    }
    return structured
  }

  return createCommandError(code, {
    ...metadata,
    errorMessage: error instanceof Error ? error.message : String(error)
  })
}

const summarizeText = (value: string) => ({
  length: value.length,
  sha256: createHash('sha256').update(value).digest('hex'),
  lines: value.length > 0 ? value.split('\n').length : 0
})

const summarizeSensitiveValue = (value: string) => ({
  length: value.length,
  sha256: createHash('sha256').update(value).digest('hex')
})

const summarizeProcessStreams = (stdout: string, stderr: string) => ({
  stdout: summarizeText(stdout),
  stderr: summarizeText(stderr)
})

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

  private resolveWorkingDirectory(cwd: string): string {
    const allowedDirectories = this.config.allowedWorkingDirectories || []
    if (allowedDirectories.length === 0) {
      throw createCommandError('COMMAND_WORKDIR_CONFIGURATION_MISSING', {
        configuredDirectoryCount: 0
      })
    }

    const trimmed = cwd?.trim()
    if (!trimmed) {
      throw createCommandError('COMMAND_WORKDIR_REQUIRED')
    }

    const candidate = path.isAbsolute(trimmed)
      ? trimmed
      : this.config.projectPath
      ? path.resolve(this.config.projectPath, trimmed)
      : path.resolve(trimmed)

    try {
      return ensureDirectoryWithinAllowed(candidate, allowedDirectories)
    } catch (error) {
      throw toCommandError(error, 'COMMAND_WORKDIR_RESOLUTION_FAILED', {
        candidateDirectory: summarizeSensitiveValue(candidate)
      })
    }
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

  private buildCommandEnvironment(isWindows: boolean): NodeJS.ProcessEnv {
    const baseEnv = this.getEnhancedEnvironment(isWindows)
    const allowedKeys = new Set<string>([
      ...BASE_ENV_ALLOWLIST,
      ...(isWindows ? WINDOWS_ENV_ALLOWLIST : []),
      ...(this.config.passthroughEnvKeys
        ?.filter((key) => SAFE_ENV_KEY_PATTERN.test(key))
        .map((key) => key.trim()) ?? [])
    ])

    const sanitizedEnv: NodeJS.ProcessEnv = {}

    for (const key of allowedKeys) {
      const value = baseEnv[key] ?? process.env[key]
      if (typeof value === 'string' && value.length > 0) {
        sanitizedEnv[key] = value
      }
    }

    const pathSeparator = isWindows ? ';' : ':'
    const pathEntries = new Set<string>()

    const basePath = baseEnv.PATH ?? baseEnv.Path ?? ''
    basePath
      .split(pathSeparator)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .forEach((entry) => pathEntries.add(entry))

    for (const entry of this.config.additionalPathEntries ?? []) {
      if (typeof entry === 'string' && entry.trim().length > 0) {
        pathEntries.add(entry.trim())
      }
    }

    if (pathEntries.size > 0) {
      const normalisedPath = Array.from(pathEntries).join(pathSeparator)
      sanitizedEnv.PATH = normalisedPath
      if (isWindows) {
        sanitizedEnv.Path = normalisedPath
      }
    }

    return sanitizedEnv
  }

  private parseCommand(commandStr: string): { command: string; args: string[] } {
    const parts = commandStr.trim().split(/\s+/).filter(Boolean)
    return {
      command: parts[0],
      args: parts.slice(1)
    }
  }

  private sanitizeArgs(args: string[]): void {
    for (const arg of args) {
      // Reject potentially dangerous characters
      if (/[^a-zA-Z0-9@%+=:,./-]/.test(arg)) {
        throw createCommandError('COMMAND_ARGUMENT_INVALID_CHARACTERS', {
          argumentSummary: summarizeSensitiveValue(arg)
        })
      }
    }
  }

  private isCommandAllowed(commandToExecute: string): boolean {
    const executeParts = this.parseCommand(commandToExecute)

    // allowedCommands が未定義の場合は空の配列として処理
    const allowedCommands = this.config.allowedCommands || []

    return allowedCommands.some((allowedCmd) => {
      if (allowedCmd.pattern.includes('*')) {
        return false
      }

      const allowedParts = this.parseCommand(allowedCmd.pattern)

      if (allowedParts.command !== executeParts.command) {
        return false
      }

      if (allowedParts.args.length !== executeParts.args.length) {
        return false
      }

      return allowedParts.args.every((arg, index) => arg === executeParts.args[index])
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

  async executeCommand(input: CommandInput): Promise<CommandExecutionResult> {
    return new Promise((resolve, reject) => {
      // 入力値の事前検証
      if (!input.command || typeof input.command !== 'string' || input.command.trim() === '') {
        reject(
          createCommandError('COMMAND_INPUT_EMPTY', {
            receivedType: typeof input.command
          })
        )
        return
      }

      if (!input.cwd || typeof input.cwd !== 'string') {
        reject(
          createCommandError('COMMAND_INPUT_CWD_INVALID_TYPE', {
            receivedType: typeof input.cwd
          })
        )
        return
      }

      const maxConcurrent = this.config.maxConcurrentProcesses
      if (typeof maxConcurrent === 'number' && maxConcurrent > 0) {
        if (this.runningProcesses.size >= maxConcurrent) {
          reject(
            createCommandError('COMMAND_MAX_CONCURRENCY_REACHED', {
              configuredLimit: maxConcurrent,
              activeProcessCount: this.runningProcesses.size
            })
          )
          return
        }
      }

      let resolvedCwd: string
      try {
        resolvedCwd = this.resolveWorkingDirectory(input.cwd)
      } catch (error) {
        reject(
          toCommandError(error, 'COMMAND_WORKDIR_RESOLUTION_FAILED', {
            receivedWorkingDirectory: summarizeSensitiveValue(input.cwd)
          })
        )
        return
      }

      const parsed = this.parseCommand(input.command)
      try {
        this.sanitizeArgs([parsed.command, ...parsed.args])
      } catch (err) {
        reject(err)
        return
      }

      if (!this.isCommandAllowed(input.command)) {
        reject(
          createCommandError('COMMAND_NOT_ALLOWED', {
            commandSummary: summarizeSensitiveValue(input.command),
            allowedPatternCount: this.config.allowedCommands?.length ?? 0
          })
        )
        return
      }

      // プラットフォーム別の設定
      const isWindows = process.platform === 'win32'

      // Electron特有の環境変数問題を解決
      const spawnEnv = this.buildCommandEnvironment(isWindows)

      const childProcess = spawn(parsed.command, parsed.args, {
        cwd: resolvedCwd,
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: spawnEnv
      })

      if (typeof childProcess.pid === 'undefined') {
        log.error('Process spawn failed', {
          platform: process.platform,
          commandSummary: summarizeSensitiveValue(input.command),
          workingDirectory: summarizeSensitiveValue(input.cwd),
          spawnfile:
            typeof childProcess.spawnfile === 'string'
              ? summarizeSensitiveValue(childProcess.spawnfile)
              : null,
          spawnargsCount: Array.isArray(childProcess.spawnargs)
            ? childProcess.spawnargs.length
            : 0
        })
        reject(
          createCommandError('COMMAND_SPAWN_PID_UNDEFINED', {
            platform: process.platform,
            commandSummary: summarizeSensitiveValue(input.command),
            workingDirectory: summarizeSensitiveValue(resolvedCwd)
          })
        )
        return
      }

      const pid = childProcess.pid

      // プロセス情報を初期化
      this.initializeProcessState(pid)
      this.runningProcesses.set(pid, {
        pid,
        command: input.command,
        timestamp: Date.now()
      })

      // プロセスの状態を保存
      this.updateProcessState(pid, { process: childProcess })

      let currentOutput = ''
      let currentError = ''
      let isCompleted = false

      const cleanup = () => {
        childProcess.stdout.removeAllListeners()
        childProcess.stderr.removeAllListeners()
        childProcess.removeAllListeners()
        this.runningProcesses.delete(pid)
        this.processStates.delete(pid)
      }

      const completeWithError = (error: CommandServiceError) => {
        if (!isCompleted) {
          isCompleted = true
          cleanup()
          reject(error)
        }
      }

      const completeWithSuccess = () => {
        if (!isCompleted) {
          const state = this.processStates.get(pid)
          if (!state) {
            reject(
              createCommandError('COMMAND_STATE_NOT_FOUND', {
                pid,
                commandSummary: summarizeSensitiveValue(input.command)
              })
            )
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
            completeWithError(
              createCommandError('COMMAND_RUNTIME_FAILURE', {
                pid,
                failureSource: 'stdout',
                commandSummary: summarizeSensitiveValue(input.command),
                workingDirectory: summarizeSensitiveValue(resolvedCwd),
                streams: summarizeProcessStreams(currentOutput, currentError)
              })
            )
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
            completeWithError(
              createCommandError('COMMAND_RUNTIME_FAILURE', {
                pid,
                failureSource: 'stderr',
                commandSummary: summarizeSensitiveValue(input.command),
                workingDirectory: summarizeSensitiveValue(resolvedCwd),
                streams: summarizeProcessStreams(currentOutput, currentError)
              })
            )
          }
        }
      })

      childProcess.on('error', (error) => {
        const hints: string[] = []
        if (process.platform === 'win32' && error instanceof Error) {
          if (error.message.includes('ENOENT')) {
            hints.push('missing_command_or_shell')
          } else if (error.message.includes('EACCES')) {
            hints.push('permission_denied')
          }
        }

        const errorMetadata: Record<string, unknown> = {
          pid,
          failureSource: 'process_error',
          commandSummary: summarizeSensitiveValue(input.command),
          workingDirectory: summarizeSensitiveValue(resolvedCwd),
          platform: process.platform
        }

        if (hints.length > 0) {
          errorMetadata.hints = hints
        }

        const structuredError = toCommandError(error, 'COMMAND_RUNTIME_FAILURE', errorMetadata)
        completeWithError(structuredError)
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
            completeWithError(
              createCommandError('COMMAND_PROCESS_EXITED_WITH_ERROR', {
                pid,
                exitCode: code ?? null,
                commandSummary: summarizeSensitiveValue(input.command),
                workingDirectory: summarizeSensitiveValue(resolvedCwd),
                streams: summarizeProcessStreams(currentOutput, currentError)
              })
            )
          }
        }
      })

      const TIMEOUT = 60000 * 5 // 5分
      // タイムアウト処理
      setTimeout(async () => {
        if (!isCompleted) {
          const state = this.processStates.get(pid)
          if (!state) return

          if (state.hasError) {
            completeWithError(
              createCommandError('COMMAND_RUNTIME_FAILURE', {
                pid,
                failureSource: 'startup',
                commandSummary: summarizeSensitiveValue(input.command),
                workingDirectory: summarizeSensitiveValue(resolvedCwd),
                stderr: summarizeText(currentError)
              })
            )
          } else {
            // 開発サーバーの状態チェック
            if (
              this.isServerReady(currentOutput) ||
              currentOutput.includes('waiting for file changes')
            ) {
              completeWithSuccess()
            } else {
              await this.stopProcess(pid).catch((err) =>
                log.error('Failed to stop process after timeout', {
                  pid,
                  error: err instanceof Error ? err.message : String(err)
                })
              )
              completeWithError(
                createCommandError('COMMAND_TIMEOUT', {
                  pid,
                  commandSummary: summarizeSensitiveValue(input.command),
                  workingDirectory: summarizeSensitiveValue(resolvedCwd),
                  streams: summarizeProcessStreams(currentOutput, currentError)
                })
              )
            }
          }
        }
      }, TIMEOUT) // Multi-Agent 的な処理を見据えて長めに設定する
    })
  }

  async sendInput(input: CommandStdinInput): Promise<CommandExecutionResult> {
    const state = this.processStates.get(input.pid)
    if (!state || !state.process) {
      throw createCommandError('COMMAND_NO_RUNNING_PROCESS', {
        pid: input.pid
      })
    }

    if (typeof this.config.maxStdinBytes === 'number' && this.config.maxStdinBytes > 0) {
      const payloadSize = Buffer.byteLength(input.stdin ?? '', 'utf8')
      if (payloadSize > this.config.maxStdinBytes) {
        throw createCommandError('COMMAND_STDIN_LIMIT_EXCEEDED', {
          configuredLimit: this.config.maxStdinBytes,
          payloadSize
        })
      }
    }

    return new Promise((resolve, reject) => {
      const { process: childProcess } = state
      const commandSummary = summarizeSensitiveValue(
        Array.isArray(childProcess.spawnargs) ? childProcess.spawnargs.join(' ') : ''
      )
      let currentOutput = state.output.stdout
      let currentError = state.output.stderr
      let isCompleted = false

      // 既存のリスナーを削除
      childProcess.stdout.removeAllListeners('data')
      childProcess.stderr.removeAllListeners('data')
      childProcess.removeAllListeners('error')
      childProcess.removeAllListeners('exit')

      const completeWithError = (error: CommandServiceError) => {
        if (!isCompleted) {
          isCompleted = true
          reject(error)
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
          completeWithError(
            createCommandError('COMMAND_RUNTIME_FAILURE', {
              pid: input.pid,
              failureSource: 'stdout',
              commandSummary,
              streams: summarizeProcessStreams(currentOutput, currentError)
            })
          )
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
          completeWithError(
            createCommandError('COMMAND_RUNTIME_FAILURE', {
              pid: input.pid,
              failureSource: 'stderr',
              commandSummary,
              streams: summarizeProcessStreams(currentOutput, currentError)
            })
          )
        }
      })

      childProcess.on('error', (error) => {
        completeWithError(
          toCommandError(error, 'COMMAND_RUNTIME_FAILURE', {
            pid: input.pid,
            failureSource: 'process_error',
            commandSummary
          })
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
          completeWithError(
            createCommandError('COMMAND_PROCESS_EXITED_WITH_ERROR', {
              pid: input.pid,
              exitCode: code ?? null,
              commandSummary,
              streams: summarizeProcessStreams(currentOutput, currentError)
            })
          )
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
            completeWithError(
              createCommandError('COMMAND_RUNTIME_FAILURE', {
                pid: input.pid,
                failureSource: 'stdin_timeout',
                commandSummary,
                stderr: summarizeText(currentError)
              })
            )
          } else if (
            this.isServerReady(currentOutput) ||
            currentOutput.includes('waiting for file changes')
          ) {
            completeWithSuccess()
          } else {
            completeWithError(
              createCommandError('COMMAND_WAIT_TIMEOUT', {
                pid: input.pid,
                commandSummary,
                streams: summarizeProcessStreams(currentOutput, currentError)
              })
            )
          }
        }
      }, 5000)
    })
  }

  async stopProcess(pid: number): Promise<void> {
    const state = this.processStates.get(pid)
    const childProcess = state?.process

    if (!this.runningProcesses.has(pid)) {
      return
    }

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        childProcess?.stdout?.removeAllListeners()
        childProcess?.stderr?.removeAllListeners()
        childProcess?.removeAllListeners()
        this.runningProcesses.delete(pid)
        this.processStates.delete(pid)
        resolve()
      }

      const terminateProcess = () => {
        const attempts: Array<() => void> = []
        const isWindows = process.platform === 'win32'

        if (!isWindows) {
          attempts.push(() => process.kill(-pid))
        }

        if (childProcess) {
          attempts.push(() => childProcess.kill())
        }

        attempts.push(() => process.kill(pid))

        let lastError: unknown

        for (const attempt of attempts) {
          try {
            attempt()
            return
          } catch (error) {
            lastError = error
          }
        }

        if (
          lastError &&
          typeof lastError === 'object' &&
          'code' in lastError &&
          (lastError as { code?: unknown }).code === 'ESRCH'
        ) {
          return
        }

        throw lastError ?? new Error('Process termination failed')
      }

      if (childProcess) {
        childProcess.stdout?.removeAllListeners()
        childProcess.stderr?.removeAllListeners()
        childProcess.removeAllListeners('error')
        childProcess.removeAllListeners('exit')
        childProcess.once('exit', cleanup)

        try {
          terminateProcess()
        } catch (error) {
          childProcess.removeAllListeners('exit')
          reject(
            toCommandError(error, 'COMMAND_STOP_FAILED', {
              pid,
              hasProcessHandle: true,
              attemptedProcessGroupKill: process.platform !== 'win32'
            })
          )
        }
      } else {
        try {
          terminateProcess()
          cleanup()
        } catch (error) {
          reject(
            toCommandError(error, 'COMMAND_STOP_FAILED', {
              pid,
              hasProcessHandle: false,
              attemptedProcessGroupKill: process.platform !== 'win32'
            })
          )
        }
      }
    })
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
