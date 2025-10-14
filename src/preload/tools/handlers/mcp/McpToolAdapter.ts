/**
 * MCP Tool Adapter implementation
 */

import { BaseTool } from '../../base/BaseTool'
import { ValidationResult } from '../../base/types'
import { ExecutionError } from '../../base/errors'
import { ToolResult } from '../../../../types/tools'
import { McpServerConfig } from '../../../../types/agent-chat'
import { McpToolExecutionResult } from '../../../../types/mcp'
import { ipcRenderer } from 'electron'

/**
 * Input type for McpToolAdapter
 */
interface McpToolInput {
  type: string // MCP tool type (e.g., 'mcp_search_documentation')
  mcpToolName?: string // Original MCP tool name passed from registry
  [key: string]: any // Allow any additional parameters
}

/**
 * Result type for McpToolAdapter
 */
interface McpToolResult extends ToolResult {
  name: 'mcp'
  result: any
}

/**
 * Adapter for MCP (Model Context Protocol) tools
 */
export class McpToolAdapter extends BaseTool<McpToolInput, McpToolResult> {
  readonly name = 'mcp' as const
  readonly description = 'Execute tools provided by MCP servers'

  /**
   * Validate input
   */
  protected validateInput(input: McpToolInput): ValidationResult {
    const errors: string[] = []

    if (!input.type) {
      errors.push('Tool type is required')
    }

    if (typeof input.type !== 'string') {
      errors.push('Tool type must be a string')
    }

    return {
      isValid: errors.length === 0,
      errors
    }
  }

  /**
   * Execute the tool
   */
  protected async executeInternal(input: McpToolInput): Promise<McpToolResult> {
    // Extract the actual tool name from mcpToolName or type
    let toolName = input.mcpToolName || input.type

    // Handle legacy format (mcp_toolName) for backward compatibility
    if (!input.mcpToolName && input.type.startsWith('mcp_')) {
      // Legacy format: remove mcp_ prefix
      toolName = input.type.replace(/^mcp_/, '')
    }

    // Extract arguments (exclude type, mcpToolName, and internal BackgroundAgentService metadata)
    const { type, mcpToolName: _mcpToolName, _agentId, _mcpServers, ...args } = input

    this.logger.debug('Executing MCP tool.', {
      originalType: type,
      toolName,
      hasArgs: Object.keys(args).length > 0,
      hasBackgroundAgentContext: !!_agentId
    })

    try {
      this.logger.info('Calling MCP tool.', { toolName })

      let mcpServers: McpServerConfig[] | undefined
      let agentId: string | undefined
      let agentName: string | undefined

      // Check if this is called from BackgroundAgentService (priority)
      if (_agentId && _mcpServers) {
        this.logger.debug('Using BackgroundAgentService context', {
          agentId: _agentId,
          mcpServersCount: _mcpServers.length
        })

        agentId = _agentId
        mcpServers = _mcpServers
        agentName = `BackgroundAgent-${_agentId}`
      } else {
        // Fallback to frontend store (original behavior)
        this.logger.debug('Using frontend store context')

        const selectedAgentId = this.store.get('selectedAgentId') as string | undefined
        const customAgents = (this.store.get('customAgents') as any[] | undefined) || []

        if (!selectedAgentId) {
          throw new ExecutionError(
            'No agent selected. Please select an agent to use MCP tools.',
            this.name,
            undefined,
            { toolName }
          )
        }

        // Find the current agent
        const currentAgent = customAgents.find((agent: any) => agent.id === selectedAgentId)

        if (!currentAgent) {
          throw new ExecutionError(
            'Agent not found for MCP tool execution.',
            this.name,
            undefined,
            { toolName, selectedAgentId }
          )
        }

        agentId = selectedAgentId
        mcpServers = currentAgent.mcpServers as McpServerConfig[] | undefined
        agentName = currentAgent.name
      }

      if (!mcpServers || mcpServers.length === 0) {
        throw new ExecutionError(
          'No MCP servers configured for this agent. Please configure MCP servers in agent settings.',
          this.name,
          undefined,
          { toolName, agentId }
        )
      }

      this.logger.debug('Resolved MCP servers for agent.', {
        agentId,
        agentName,
        serverCount: mcpServers.length,
        serverNames: mcpServers.map((s) => s.name)
      })

      // Execute the MCP tool via direct IPC to Main Process
      const result = (await ipcRenderer.invoke(
        'mcp:executeTool',
        toolName,
        args,
        mcpServers
      )) as McpToolExecutionResult

      this.logger.info('MCP tool execution completed.', {
        toolName,
        success: result.success,
        found: result.found,
        resultType: typeof result.result
      })

      const normalizedDetails: Record<string, unknown> = result.details
        ? { ...result.details }
        : {}

      if (result.message) {
        normalizedDetails.serviceMessage = result.message
      }

      const hasDetails = Object.keys(normalizedDetails).length > 0

      // Check if the tool was found
      if (!result.found) {
        throw new ExecutionError(
          'MCP tool not found.',
          this.name,
          undefined,
          {
            toolName,
            availableServers: mcpServers.length,
            resultDetails: hasDetails ? normalizedDetails : undefined
          }
        )
      }

      // Check if execution was successful
      if (!result.success) {
        throw new ExecutionError(
          'MCP tool execution failed.',
          this.name,
          undefined,
          {
            toolName,
            args: this.sanitizeObject(args),
            resultDetails: hasDetails ? normalizedDetails : undefined,
            rawError: result.error
          }
        )
      }

      return {
        success: true,
        name: 'mcp',
        message: 'MCP tool execution succeeded.',
        result: result.result,
        details: hasDetails ? normalizedDetails : undefined
      }
    } catch (error) {
      // If it's already an ExecutionError, re-throw it
      if (error instanceof ExecutionError) {
        throw error
      }

      this.logger.error('MCP tool execution failed.', {
        error: error instanceof Error ? error.message : String(error),
        toolName,
        args: this.sanitizeObject(args)
      })

      throw new ExecutionError(
        'MCP tool execution failed.',
        this.name,
        error instanceof Error ? error : undefined,
        {
          toolName,
          args: this.sanitizeObject(args),
          causeMessage: error instanceof Error ? error.message : String(error)
        }
      )
    }
  }

  /**
   * Override to return error as string for compatibility
   */
  protected shouldReturnErrorAsString(): boolean {
    return true
  }

  /**
   * Override to sanitize args for logging
   */
  protected sanitizeInputForLogging(input: McpToolInput): any {
    const { type, mcpToolName, ...args } = input

    return {
      type,
      mcpToolName,
      args: args ? this.sanitizeObject(args) : undefined
    }
  }

  /**
   * Sanitize object for logging
   */
  private sanitizeObject(obj: Record<string, any>): Record<string, any> {
    const sanitized: Record<string, any> = {}

    for (const [key, value] of Object.entries(obj)) {
      // Redact potentially sensitive keys
      if (
        key.toLowerCase().includes('password') ||
        key.toLowerCase().includes('token') ||
        key.toLowerCase().includes('secret') ||
        key.toLowerCase().includes('key')
      ) {
        sanitized[key] = '[REDACTED]'
      } else if (typeof value === 'string' && value.length > 100) {
        sanitized[key] = this.truncateForLogging(value, 100)
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitizeObject(value)
      } else {
        sanitized[key] = value
      }
    }

    return sanitized
  }
}
