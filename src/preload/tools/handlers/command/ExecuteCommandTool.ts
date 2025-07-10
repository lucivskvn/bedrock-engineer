/**
 * ExecuteCommand tool implementation
 */

import { Tool } from '@aws-sdk/client-bedrock-runtime'
import { BaseTool } from '../../base/BaseTool'
import { ValidationResult } from '../../base/types'
import { ExecutionError, PermissionDeniedError } from '../../base/errors'
import { ToolResult } from '../../../../types/tools'
import { CommandService } from '../../../../main/api/command/commandService'
import {
  CommandInput,
  CommandStdinInput,
  ProcessInfo,
  CommandConfig,
  CommandPatternConfig
} from '../../../../main/api/command/types'
import { findAgentById } from '../../../helpers/agent-helpers'
import { ipcRenderer } from 'electron' // Added for IPC communication

/**
 * Input type for ExecuteCommandTool
 */
type ExecuteCommandInput = {
  type: 'executeCommand'
} & (CommandInput | CommandStdinInput)

/**
 * Result type for ExecuteCommandTool
 */
interface ExecuteCommandResult extends ToolResult {
  name: 'executeCommand'
  stdout: string
  stderr: string
  exitCode: number
  processInfo?: ProcessInfo
  requiresInput?: boolean
  prompt?: string
}

/**
 * Command service state management
 */
interface CommandServiceState {
  service: CommandService
  config: CommandConfig
}

let commandServiceState: CommandServiceState | null = null

/**
 * Tool for executing system commands
 */
export class ExecuteCommandTool extends BaseTool<ExecuteCommandInput, ExecuteCommandResult> {
  static readonly toolName = 'executeCommand'
  static readonly toolDescription = [
    'Executes system commands or sends input to a running process.',
    'Security: Commands are executed with enhanced security measures.',
    'Potentially destructive commands (e.g., file deletion, git push, package installation) will require user confirmation via a UI dialog before execution.',
    'Input command strings are parsed into an executable and arguments to prevent shell injection vulnerabilities.',
    'Usage: 1) To start a new process: provide `command` (full command string, e.g., "ls -la /tmp") and `cwd` (current working directory).',
    '2) To send input to an existing process: provide `pid` (process ID from a previous execution) and `stdin` (string to send as standard input).'
  ].join(' ')

  readonly name = ExecuteCommandTool.toolName
  readonly description = ExecuteCommandTool.toolDescription

  /**
   * AWS Bedrock tool specification
   */
  static readonly toolSpec: Tool['toolSpec'] = {
    name: ExecuteCommandTool.toolName,
    description: ExecuteCommandTool.toolDescription, // Updated description
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          command: { // LLM will still provide a single command string
            type: 'string',
            description: 'The command to execute (e.g., "ls -l /tmp")'
          },
          cwd: {
            type: 'string',
            description: 'The working directory for the command execution (used with command)'
          },
          pid: {
            type: 'number',
            description: 'Process ID to send input to (used when sending input to existing process)'
          },
          stdin: {
            type: 'string',
            description: 'Standard input to send to the process (used with pid)'
          }
        }
      }
    }
  } as const

  /**
   * System prompt description
   */
  static readonly systemPromptDescription = [
    'Allows execution of system commands. Commands are run with user permissions.',
    'Security Note: Potentially destructive operations will require explicit user confirmation through a UI dialog.',
    'Only commands from the configured allowed list (see agent settings) can be executed: {{allowedCommands}}.',
    'The command string provided will be parsed into an executable and arguments to prevent common injection attacks.'
  ].join('\n')

  /**
   * Get or create command service instance
   */
  private getCommandService(config: CommandConfig): CommandService {
    // Check if we need to create a new instance
    if (
      !commandServiceState ||
      JSON.stringify(commandServiceState.config) !== JSON.stringify(config)
    ) {
      commandServiceState = {
        service: new CommandService(config),
        config
      }
    }
    return commandServiceState.service
  }

  /**
   * Parses a command string into an executable and arguments.
   * This is a basic parser. For robust shell-like parsing, a dedicated library would be better.
   * Handles simple cases, quotes for arguments with spaces. Does not handle complex escapes within quotes.
   * @param commandStr The command string to parse.
   * @returns An object with 'executable' and 'args' array.
   */
  private parseCommandString(commandStr: string): { executable: string; args: string[] } {
    if (!commandStr) {
      return { executable: '', args: [] }
    }
    const args: string[] = []
    let currentArg = ''
    let inQuote = false
    for (let i = 0; i < commandStr.length; i++) {
      const char = commandStr[i]
      if (char === ' ' && !inQuote) {
        if (currentArg) {
          args.push(currentArg)
          currentArg = ''
        }
      } else if (char === '"' || char === "'") {
        if (inQuote && char === currentArg[0]) { // End quote
          currentArg += char
          // Decide whether to keep quotes or strip them. Stripping is common.
                          args.push(currentArg.slice(1, -1)); // Remove quotes
          currentArg = '';
                          inQuote = false;
        } else if (!inQuote && !currentArg) { // Start quote
          inQuote = true
          currentArg += char
        } else {
           currentArg += char; // Character inside a quote or part of an unquoted arg
        }
      } else {
        currentArg += char
      }
    }
    if (currentArg) {
      args.push(currentArg)
    }

    const executable = args.shift() || ''
    // TODO: Consider using a more robust command parsing library if complex shell syntax is needed.
    // For now, this handles basic space separation and simple quotes.
    this.logger.debug(`Parsed command: "${commandStr}" into executable: "${executable}", args: [${args.join(', ')}]`)
    return { executable, args }
  }

  /**
   * Checks if a command is potentially destructive.
   * @param executable The command executable.
   * @param args The command arguments.
   * @param originalCommandString The original full command string for context and logging.
   * @returns True if the command is deemed destructive, false otherwise.
   */
  private isDestructiveCommand(executable: string, args: string[], originalCommandString: string): boolean {
    if (!executable) return false
    const lowerExec = executable.toLowerCase().trim()

    // Destructive executables
    const destructiveExecutables: string[] = [
      'rm', 'mv', 'dd', 'mkfs', 'fdisk', 'git' // git is broad, subcommands are more specific
    ]
    if (destructiveExecutables.includes(lowerExec)) {
       // More specific checks for git
      if (lowerExec === 'git') {
        const gitSubCommand = args[0]?.toLowerCase()
        const destructiveGitSubCommands = ['clone', 'checkout', 'reset', 'clean', 'push', 'rebase', 'commit'] // commit can be if --amend etc.
        if (destructiveGitSubCommands.includes(gitSubCommand)) {
            this.logger.warn(`Destructive git command: ${executable} ${args.join(' ')} (Original: ${originalCommandString})`)
            return true
        }
      } else {
        this.logger.warn(`Destructive command executable: ${executable} (Original: ${originalCommandString})`)
        return true
      }
    }

    // Commands that are destructive with certain arguments or patterns
    if ((lowerExec === 'curl' || lowerExec === 'wget') && args.some(arg => ['-XPOST', '-XPUT', '-XDELETE', '-XPATCH', '--data', '--upload-file'].includes(arg.toUpperCase()))) {
      this.logger.warn(`Destructive network command: ${executable} ${args.join(' ')} (Original: ${originalCommandString})`)
      return true
    }
    if (lowerExec === 'npm' || lowerExec === 'pip') {
        if (args[0]?.toLowerCase() === 'install' || args[0]?.toLowerCase() === 'uninstall' || args[0]?.toLowerCase() === 'remove') {
            this.logger.warn(`Destructive package manager command: ${executable} ${args.join(' ')} (Original: ${originalCommandString})`)
            return true
        }
    }

    // Check for output redirection in the original command string (as args might not capture this if not parsed perfectly for shell)
    if (/>\s*[\w/.-]+/.test(originalCommandString) && !originalCommandString.includes('>\&')) { // Simple file overwrite, ignore >& (stderr to stdout)
        this.logger.warn(`Destructive redirection detected in command: ${originalCommandString}`)
        return true
    }

    // If the command is 'echo' or 'tee' and the original string suggests redirection to a file
    if ((lowerExec === 'echo' || lowerExec === 'tee') && originalCommandString.includes('>')) {
        this.logger.warn(`Destructive use of ${lowerExec} with redirection: ${originalCommandString}`)
        return true
    }
     if (lowerExec === 'writetofile' && originalCommandString.toLowerCase().startsWith('writetofile')) { // If writeToFile itself is invoked via executeCommand
      this.logger.warn(`Direct call to writeToFile via executeCommand: ${originalCommandString}`)
      return true
    }


    // TODO: Add more patterns, e.g., for common database operations, cloud CLI commands that modify resources.
    // This list is not exhaustive and needs continuous improvement.
    return false
  }

  /**
   * Validate input
   */
  protected validateInput(input: ExecuteCommandInput): ValidationResult {
    const errors: string[] = []

    // Check if it's stdin input
    if ('pid' in input && 'stdin' in input) {
      if (typeof input.pid !== 'number') {
        errors.push('PID must be a number')
      }
      if (input.stdin !== undefined && typeof input.stdin !== 'string') {
        errors.push('Stdin must be a string')
      }
    }
    // Check if it's command input
    else if ('command' in input && 'cwd' in input) {
      if (!input.command) {
        errors.push('Command is required')
      }
      if (typeof input.command !== 'string') {
        errors.push('Command must be a string')
      }
      if (!input.cwd) {
        errors.push('Working directory (cwd) is required')
      }
      if (typeof input.cwd !== 'string') {
        errors.push('Working directory must be a string')
      }
    } else {
      errors.push('Invalid input format: requires either (command, cwd) or (pid, stdin)')
    }

    return {
      isValid: errors.length === 0,
      errors
    }
  }

  /**
   * Execute the tool
   */
  protected async executeInternal(input: ExecuteCommandInput): Promise<ExecuteCommandResult> {
    // Get command configuration
    const config = this.getCommandConfig()

    this.logger.debug('Executing command', {
      input: JSON.stringify(input),
      config: JSON.stringify({
        allowedCommands: config.allowedCommands?.length || 0
      })
    })

    try {
      const commandService = this.getCommandService(config)
      let result

      if ('stdin' in input && 'pid' in input) {
        // Send stdin to existing process
        this.logger.info('Sending stdin to process', {
          pid: input.pid,
          stdinLength: input.stdin?.length || 0
        })

        result = await commandService.sendInput(input)

        this.logger.debug('Process stdin result', {
          pid: input.pid,
          exitCode: result.exitCode,
          hasStdout: !!result.stdout.length,
          hasStderr: !!result.stderr.length
        })
      } else if ('command' in input && 'cwd' in input) {
        // Execute new command
        const { executable, args } = this.parseCommandString(input.command)

        if (!executable) {
          this.logger.warn('Empty executable after parsing command string.', { originalCommand: input.command })
          throw new ExecutionError('Invalid command: Executable cannot be empty after parsing.', this.name)
        }

        this.logger.info('Executing new command', {
          executable,
          args,
          cwd: input.cwd,
          originalCommand: input.command
        })

        // Check for destructive commands and request confirmation
        if (this.isDestructiveCommand(executable, args, input.command)) {
          this.logger.warn(`Destructive command detected: ${input.command} (parsed as: ${executable} ${args.join(' ')})`)
          try {
            // Show the original, full command string to the user for clarity
            const userResponse = await ipcRenderer.invoke('confirm-destructive-command', input.command)
            if (!userResponse.confirmed) {
              this.logger.info(`User denied execution of destructive command: ${input.command}`)
              return {
                success: false,
                name: 'executeCommand',
                message: `User denied execution of command: ${input.command}`,
                stdout: '',
                stderr: 'Command execution cancelled by user.',
                exitCode: -1,
                requiresInput: false
              }
            }
            this.logger.info(`User approved execution of destructive command: ${input.command}`)
          } catch (ipcError) {
            this.logger.error('Error during IPC confirmation for destructive command', { error: ipcError })
            throw new ExecutionError(
              `Failed to get user confirmation: ${ipcError instanceof Error ? ipcError.message : String(ipcError)}`,
              this.name
            )
          }
        }

        // Prepare the input for commandService, which will be refactored to take executable and args
        const commandServiceInput: CommandInput = {
            executable,
            args,
            cwd: input.cwd
        }
        // @ts-expect-error // Temporarily allow passing old structure until CommandService is updated
        result = await commandService.executeCommand(commandServiceInput)


        this.logger.debug('Command execution result', {
          pid: result.processInfo?.pid,
          exitCode: result.exitCode,
          hasStdout: !!result.stdout.length,
          hasStderr: !!result.stderr.length,
          requiresInput: result.requiresInput
        })
      } else {
        const errorMsg = 'Invalid input format'
        this.logger.warn(errorMsg, { input: JSON.stringify(input) })
        throw new Error(errorMsg)
      }

      this.logger.info('Command execution completed', {
        exitCode: result.exitCode,
        success: result.exitCode === 0,
        requiresInput: result.requiresInput || false
      })

      return {
        success: true,
        name: 'executeCommand',
        message: `Command executed: ${JSON.stringify(input)}`,
        ...result
      }
    } catch (error) {
      this.logger.error('Error executing command', {
        error: error instanceof Error ? error.message : 'Unknown error',
        input: JSON.stringify(input)
      })

      // Check if it's a permission error
      if (error instanceof Error && error.message.includes('not allowed')) {
        throw new PermissionDeniedError(
          error.message,
          this.name,
          'command' in input ? input.command : 'stdin'
        )
      }

      throw new ExecutionError(
        error instanceof Error ? error.message : 'Unknown error occurred',
        this.name,
        error instanceof Error ? error : undefined,
        { input }
      )
    }
  }

  /**
   * Get command configuration from store
   */
  private getCommandConfig(): CommandConfig {
    // Get basic shell setting
    const shell = (this.storeManager.get('shell') as string) || '/bin/bash'

    // Get current selected agent ID
    const selectedAgentId = this.storeManager.get('selectedAgentId') as string | undefined

    // Get agent-specific allowed commands
    let allowedCommands: CommandPatternConfig[] = []

    if (selectedAgentId) {
      // Find agent and get allowed commands
      const currentAgent = findAgentById(selectedAgentId)
      if (currentAgent && currentAgent.allowedCommands) {
        // Convert to CommandPatternConfig format
        allowedCommands = currentAgent.allowedCommands.map((cmd) => ({
          pattern: cmd.pattern,
          description: cmd.description || ''
        }))
      }
    }

    return {
      allowedCommands,
      shell
    }
  }

  /**
   * Override to return error as JSON string for compatibility
   */
  protected handleError(error: unknown): Error {
    const toolError = super.handleError(error) as Error

    // For this tool, we need to return a JSON string error
    return new Error(
      JSON.stringify({
        success: false,
        error: toolError.message
      })
    )
  }

  /**
   * Override to sanitize command for logging
   */
  protected sanitizeInputForLogging(input: ExecuteCommandInput): any {
    if ('command' in input) {
      return {
        ...input,
        command: this.truncateForLogging(input.command, 100)
      }
    }

    if ('stdin' in input) {
      return {
        ...input,
        stdin: input.stdin ? this.truncateForLogging(input.stdin, 50) : undefined
      }
    }

    return input
  }
}
