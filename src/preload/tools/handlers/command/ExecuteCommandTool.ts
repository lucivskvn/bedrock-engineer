/**
 * ExecuteCommand tool implementation
 */

import { Tool } from '@aws-sdk/client-bedrock-runtime'
import path from 'path'
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
import {
  buildAllowedOutputDirectories,
  ensureDirectoryWithinAllowed
} from '../../../../common/security/pathGuards'
import { toFileToken } from '../../../../common/security/pathTokens'

const ENV_KEY_PATTERN = /^[A-Z0-9_]+$/
const DEFAULT_MAX_CONCURRENT = 2
const MAX_CONCURRENT_CAP = 4
const DEFAULT_MAX_STDIN_BYTES = 64 * 1024
const MIN_MAX_STDIN_BYTES = 1024
const MAX_STDIN_CAP = 256 * 1024

/**
 * Input type for ExecuteCommandTool
 */
type ExecuteCommandInput = {
  type: 'executeCommand'
  _agentId?: string // BackgroundAgentService用のメタデータ
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
  static readonly toolDescription =
    'Execute a command or send input to a running process. First execute the command to get a PID, then use that PID to send input if needed. Usage: 1) First call with command and cwd to start process, 2) If input is required, call again with pid and stdin.\n\nRun system commands with user permission. Only use commands from allowed list: {{allowedCommands}}.'

  readonly name = ExecuteCommandTool.toolName
  readonly description = ExecuteCommandTool.toolDescription

  /**
   * AWS Bedrock tool specification
   */
  static readonly toolSpec: Tool['toolSpec'] = {
    name: ExecuteCommandTool.toolName,
    description: ExecuteCommandTool.toolDescription,
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The command to execute (used when starting a new process)'
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

  private getWorkingDirectoryContext(): { projectPath?: string; userDataPath?: string } {
    const projectPathValue = this.store.get('projectPath')
    const projectPath =
      typeof projectPathValue === 'string' && projectPathValue.trim().length > 0
        ? (projectPathValue as string)
        : undefined
    const userDataPathValue = this.store.get('userDataPath')
    const userDataPath =
      typeof userDataPathValue === 'string' && userDataPathValue.trim().length > 0
        ? (userDataPathValue as string)
        : undefined

    return { projectPath, userDataPath }
  }

  private getAllowedWorkingDirectories(): string[] {
    const { projectPath, userDataPath } = this.getWorkingDirectoryContext()
    return buildAllowedOutputDirectories({ projectPath, userDataPath }).sort()
  }

  private resolveWorkingDirectory(cwd: string): string {
    const allowedDirectories = this.getAllowedWorkingDirectories()
    if (allowedDirectories.length === 0) {
      throw new Error('No allowed working directories configured')
    }

    const trimmed = cwd?.trim()
    if (!trimmed) {
      throw new Error('Working directory must be provided')
    }

    const { projectPath } = this.getWorkingDirectoryContext()
    const candidate = path.isAbsolute(trimmed)
      ? trimmed
      : projectPath
      ? path.resolve(projectPath, trimmed)
      : path.resolve(trimmed)

    return ensureDirectoryWithinAllowed(candidate, allowedDirectories)
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
    const config = this.getCommandConfig(input)

    this.logger.debug('Executing command', {
      input: sanitizeExecuteCommandInput(input),
      allowedCommandCount: config.allowedCommands?.length || 0
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
        this.logger.info('Executing new command', {
          command: input.command,
          cwd: toFileToken(input.cwd)
        })

        let resolvedCwd: string
        try {
          resolvedCwd = this.resolveWorkingDirectory(input.cwd)
        } catch (error) {
          throw new ExecutionError('Failed to resolve working directory.', this.name, error instanceof Error ? error : undefined, {
            input: sanitizeExecuteCommandInput(input),
            detailMessage: error instanceof Error ? error.message : String(error)
          })
        }

        result = await commandService.executeCommand({
          command: input.command,
          cwd: resolvedCwd
        })

        this.logger.debug('Command execution result', {
          pid: result.processInfo?.pid,
          exitCode: result.exitCode,
          hasStdout: !!result.stdout.length,
          hasStderr: !!result.stderr.length,
          requiresInput: result.requiresInput
        })
      } else {
        const sanitizedInput = sanitizeExecuteCommandInput(input)
        this.logger.warn('Invalid executeCommand input', { input: sanitizedInput })
        throw new ExecutionError('Invalid executeCommand input.', this.name, undefined, {
          input: sanitizedInput
        })
      }

      this.logger.info('Command execution completed', {
        exitCode: result.exitCode,
        success: result.exitCode === 0,
        requiresInput: result.requiresInput || false
      })

      return {
        success: true,
        name: 'executeCommand',
        message: 'Command executed successfully.',
        result: {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          processInfo: result.processInfo,
          requiresInput: result.requiresInput,
          prompt: result.prompt
        },
        ...result
      }
    } catch (error) {
      this.logger.error('Error executing command', {
        detailMessage: error instanceof Error ? error.message : 'Unknown error',
        input: sanitizeExecuteCommandInput(input)
      })

      // Check if it's a permission error
      if (error instanceof Error && error.message.includes('not allowed')) {
        if ('command' in input) {
          this.logger.warn('Command rejected by allowlist', {
            command: input.command,
            cwd: toFileToken(input.cwd)
          })
        }
        throw new PermissionDeniedError(
          'Command is not permitted.',
          this.name,
          'command' in input ? 'execute' : 'stdin'
        )
      }

      throw new ExecutionError(
        'Command execution failed.',
        this.name,
        error instanceof Error ? error : undefined,
        {
          input: sanitizeExecuteCommandInput(input),
          detailMessage: error instanceof Error ? error.message : String(error)
        }
      )
    }
  }

  /**
   * Get command configuration from store
   */
  private getCommandConfig(input?: ExecuteCommandInput): CommandConfig {
    // Get basic shell setting
    const shell = (this.store.get('shell') as string) || '/bin/bash'

    // Get agent ID - prioritize _agentId from BackgroundAgentService, fallback to selectedAgentId
    const agentId = input?._agentId || (this.store.get('selectedAgentId') as string | undefined)

    // Get agent-specific allowed commands
    let allowedCommands: CommandPatternConfig[] = []

    if (agentId) {
      // Find agent and get allowed commands
      const currentAgent = findAgentById(agentId)
      if (currentAgent && currentAgent.allowedCommands) {
        // Convert to CommandPatternConfig format
        allowedCommands = currentAgent.allowedCommands.map((cmd) => ({
          pattern: cmd.pattern,
          description: cmd.description || ''
        }))
      }

      this.logger.debug('Found agent configuration', {
        agentId,
        agentName: currentAgent?.name,
        allowedCommandsCount: allowedCommands.length,
        isFromBackgroundAgent: !!input?._agentId
      })
    } else {
      this.logger.warn('No agent ID found for command configuration', {
        hasInputAgentId: !!input?._agentId,
        hasSelectedAgentId: !!this.store.get('selectedAgentId')
      })
    }

    const { projectPath } = this.getWorkingDirectoryContext()
    const allowedWorkingDirectories = this.getAllowedWorkingDirectories()

    const rawMaxConcurrent = this.store.get('commandMaxConcurrentProcesses')
    const maxConcurrentProcesses =
      typeof rawMaxConcurrent === 'number' && Number.isFinite(rawMaxConcurrent)
        ? rawMaxConcurrent <= 0
          ? undefined
          : Math.min(Math.max(Math.floor(rawMaxConcurrent), 1), MAX_CONCURRENT_CAP)
        : DEFAULT_MAX_CONCURRENT

    const rawMaxStdinBytes = this.store.get('commandMaxStdinBytes')
    const maxStdinBytes =
      typeof rawMaxStdinBytes === 'number' && Number.isFinite(rawMaxStdinBytes)
        ? Math.min(
            Math.max(Math.floor(rawMaxStdinBytes), MIN_MAX_STDIN_BYTES),
            MAX_STDIN_CAP
          )
        : DEFAULT_MAX_STDIN_BYTES

    const rawPassthroughEnvKeys = this.store.get('commandPassthroughEnvKeys')
    const passthroughEnvKeys = Array.isArray(rawPassthroughEnvKeys)
      ? Array.from(
          new Set(
            rawPassthroughEnvKeys
              .map((key) => (typeof key === 'string' ? key.trim().toUpperCase() : ''))
              .filter((key) => key.length > 0 && ENV_KEY_PATTERN.test(key))
          )
        )
      : []

    const rawCommandSearchPaths = this.store.get('commandSearchPaths')
    const additionalPathEntries = Array.isArray(rawCommandSearchPaths)
      ? Array.from(
          new Set(
            rawCommandSearchPaths
              .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
              .filter((entry) => entry.length > 0)
          )
        )
      : []

    return {
      allowedCommands,
      shell,
      allowedWorkingDirectories,
      projectPath,
      maxConcurrentProcesses,
      maxStdinBytes,
      passthroughEnvKeys,
      additionalPathEntries
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

function sanitizeExecuteCommandInput(input: ExecuteCommandInput): Record<string, unknown> {
  const baseMetadata = {
    type: input.type,
    hasAgentContext: Boolean(input._agentId)
  }

  if ('command' in input && 'cwd' in input) {
    return {
      ...baseMetadata,
      mode: 'execute',
      command: input.command,
      cwd: toFileToken(input.cwd)
    }
  }

  if ('pid' in input && 'stdin' in input) {
    return {
      ...baseMetadata,
      mode: 'stdin',
      pid: input.pid,
      stdinLength: input.stdin?.length ?? 0
    }
  }

  return {
    ...baseMetadata,
    mode: 'unknown'
  }
}
