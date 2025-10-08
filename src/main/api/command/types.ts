export interface CommandPatternConfig {
  pattern: string
  description: string
}

export interface CommandConfig {
  allowedCommands?: CommandPatternConfig[]
  shell: string
  allowedWorkingDirectories?: string[]
  projectPath?: string
  /**
   * Maximum number of concurrent commands allowed. When undefined the service
   * does not enforce a limit.
   */
  maxConcurrentProcesses?: number
  /**
   * Maximum stdin payload (in bytes) accepted when piping input to a running
   * process.
   */
  maxStdinBytes?: number
  /**
   * Environment variable keys that are safe to pass through to spawned
   * processes. Keys must be alphanumeric/underscore to be honoured.
   */
  passthroughEnvKeys?: string[]
  /**
   * Additional PATH entries appended to the sanitised environment.
   */
  additionalPathEntries?: string[]
}

export interface ProcessInfo {
  pid: number
  command: string
  detached: boolean
}

export interface DetachedProcessInfo {
  pid: number
  command: string
  timestamp: number
}

export interface CommandInput {
  command: string
  cwd: string
}

export interface CommandStdinInput {
  pid: number
  stdin: string
}

export interface CommandExecutionResult {
  stdout: string
  stderr: string
  exitCode: number
  processInfo?: ProcessInfo
  requiresInput?: boolean
  prompt?: string
}

export interface ProcessOutput {
  stdout: string
  stderr: string
  code: number | null
}

export interface ProcessState {
  isRunning: boolean
  hasError: boolean
  output: ProcessOutput
  process?: any // childProcess instance
}

export interface InputDetectionPattern {
  pattern: string | RegExp
  promptExtractor?: (output: string) => string
}
