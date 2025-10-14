import { ipcMain } from 'electron'
import { createCategoryLogger } from '../../common/logger'
import { McpServerConfig } from '../../types/agent-chat'
import {
  McpConnectionTestResult,
  McpToolExecutionResult
} from '../../types/mcp'
import {
  initMcpFromAgentConfig,
  getMcpToolSpecs,
  tryExecuteMcpTool,
  testMcpServerConnection,
  testAllMcpServerConnections,
  cleanupMcpClients
} from '../mcp/index'

/**
 * MCP関連のIPCハンドラー定義
 */
const logger = createCategoryLogger('mcp:ipc')

export const mcpHandlers = {
  // MCP初期化
  'mcp:init': async (_, mcpServers: McpServerConfig[]) => {
    try {
      logger.info('Received MCP init request.', {
        serverCount: mcpServers.length
      })
      await initMcpFromAgentConfig(mcpServers)
      logger.info('MCP clients initialised.', {
        serverCount: mcpServers.length
      })
      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Failed to initialise MCP clients.', {
        error: errorMessage,
        serverCount: mcpServers.length
      })
      return { success: false, error: errorMessage }
    }
  },

  // ツール取得
  'mcp:getTools': async (_, mcpServers: McpServerConfig[]) => {
    try {
      logger.info('Received MCP tool discovery request.', {
        serverCount: mcpServers.length
      })
      const tools = await getMcpToolSpecs(mcpServers)
      logger.info('Resolved MCP tool specifications.', {
        serverCount: mcpServers.length,
        toolCount: tools.length
      })
      return { success: true, tools }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Failed to resolve MCP tools.', { error: errorMessage })
      return { success: false, error: errorMessage, tools: [] }
    }
  },

  // ツール実行
  'mcp:executeTool': async (
    _,
    toolName: string,
    input: any,
    mcpServers: McpServerConfig[]
  ): Promise<McpToolExecutionResult> => {
    try {
      logger.info('Received MCP tool execution request.', {
        toolName,
        hasInput: input != null && Object.keys(input).length > 0
      })
      const result = await tryExecuteMcpTool(toolName, input, mcpServers)
      logger.info('MCP tool execution completed.', {
        toolName,
        success: result.success,
        found: result.found
      })
      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('MCP tool execution failed.', {
        toolName,
        error: errorMessage
      })
      return {
        found: false,
        success: false,
        name: toolName,
        error: errorMessage,
        message: 'MCP tool execution failed.',
        details: {
          toolName,
          error: errorMessage
        },
        result: null
      }
    }
  },

  // 単一サーバー接続テスト
  'mcp:testConnection': async (
    _,
    mcpServer: McpServerConfig
  ): Promise<McpConnectionTestResult> => {
    try {
      logger.info('Received MCP connection test request.', {
        serverName: mcpServer.name
      })
      const result = await testMcpServerConnection(mcpServer)
      logger.info('Completed MCP connection test.', {
        serverName: mcpServer.name,
        success: result.success
      })
      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('MCP connection test failed.', {
        serverName: mcpServer.name,
        error: errorMessage
      })
      return {
        success: false,
        message: 'MCP server connection test failed.',
        details: {
          error: errorMessage,
          errorDetails: 'An unexpected error occurred during connection testing',
          serverName: mcpServer.name
        }
      }
    }
  },

  // 複数サーバー接続テスト
  'mcp:testAllConnections': async (_, mcpServers: McpServerConfig[]) => {
    try {
      logger.info('Received MCP bulk connection test request.', {
        serverCount: mcpServers.length
      })
      const results = await testAllMcpServerConnections(mcpServers)
      logger.info('Completed MCP bulk connection tests.', {
        serverCount: mcpServers.length
      })
      return { success: true, results }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('MCP bulk connection tests failed.', { error: errorMessage })
      return {
        success: false,
        error: errorMessage,
        message: 'Failed to complete MCP connection tests.',
        results: {}
      }
    }
  },

  // MCPクライアントクリーンアップ
  'mcp:cleanup': async () => {
    try {
      logger.info('Received MCP client cleanup request.')
      await cleanupMcpClients()
      logger.info('MCP client cleanup completed.')
      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('MCP client cleanup failed.', { error: errorMessage })
      return { success: false, error: errorMessage }
    }
  }
}

/**
 * MCP関連のIPCハンドラーをクリーンアップする
 */
export const cleanupMcpHandlers = () => {
  logger.info('Starting MCP IPC handler cleanup.')

  // すべてのMCP関連ハンドラーを削除
  ipcMain.removeAllListeners('mcp:init')
  ipcMain.removeAllListeners('mcp:getTools')
  ipcMain.removeAllListeners('mcp:executeTool')
  ipcMain.removeAllListeners('mcp:testConnection')
  ipcMain.removeAllListeners('mcp:testAllConnections')
  ipcMain.removeAllListeners('mcp:cleanup')

  logger.info('MCP IPC handler cleanup completed.')
}
