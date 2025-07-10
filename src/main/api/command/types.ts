export interface CommandPatternConfig {
  // pattern: string; // Old structure
  executable: string; // The specific command executable, e.g., "git", "npm", "ls"
  description: string; // Description of what this allowed command pattern does
  // Defines allowed arguments. Each element can be a string for an exact match
  // or a RegExp for pattern matching. The order matters.
  allowedArgs?: (string | RegExp)[];
  // If true, allows any arguments to follow after those matched by allowedArgs.
  // If false or undefined, only arguments matching allowedArgs (and no more) are permitted.
  allowSubsequentArgs?: boolean;
}

export interface CommandConfig {
  allowedCommands?: CommandPatternConfig[]
  shell: string
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
  // command: string // Old structure
  executable: string // The command or executable to run
  args: string[] // Arguments for the command
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

export interface CommandPattern {
  command: string
  args: string[]
  wildcard: boolean
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
