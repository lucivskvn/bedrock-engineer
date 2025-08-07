import { Tool } from '@aws-sdk/client-bedrock-runtime'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { z } from 'zod'
import { resolveCommand } from './command-resolver'
import { log } from '../logger'

// https://github.com/modelcontextprotocol/quickstart-resources/blob/main/mcp-client-typescript/index.ts
export class MCPClient {
  private mcp: Client
  private transport: StdioClientTransport | null = null
  private _tools: Tool[] = []

  private constructor() {
    this.mcp = new Client(
      { name: 'mcp-client-cli', version: '1.0.0' },
      {
        capabilities: {
          tools: {}
        }
      }
    )
  }

  static async fromCommand(command: string, args: string[], env?: Record<string, string>) {
    const client = new MCPClient()
    // コマンドパスを解決
    const resolvedCommand = resolveCommand(command)
    if (resolvedCommand !== command) {
      log.debug(`Using resolved command path: ${resolvedCommand} (original: ${command})`)
    }
    await client.connectToServer(resolvedCommand, args, env ?? {})
    return client
  }

  public get tools() {
    return this._tools
  }

  async connectToServer(command: string, args: string[], env: Record<string, string>) {
    try {
      // Initialize transport and connect to server
      this.transport = new StdioClientTransport({
        command,
        args,
        env: {
          ...env,
          ...(process.env as Record<string, string>),
          // 明示的にPATHを設定して確実に現在の環境変数を使用
          PATH: process.env.PATH || ''
        }
      })
      await this.mcp.connect(this.transport)

      // List available tools
      const toolsResult = await this.mcp.listTools()
      this._tools = toolsResult.tools.map((tool) => {
        return {
          toolSpec: {
            name: tool.name,
            description: tool.description,
            inputSchema: { json: JSON.parse(JSON.stringify(tool.inputSchema)) }
          }
        }
      })
      log.debug(
        `Connected to server with tools: ${this._tools
          .map(({ toolSpec }) => toolSpec!.name)
          .join(', ')}`
      )
    } catch (e) {
      log.error(`Failed to connect to MCP server: ${e}`)
      throw e
    }
  }

  async callTool(toolName: string, input: any) {
    const result = await this.mcp.callTool({
      name: toolName,
      arguments: input
    })
    // https://spec.modelcontextprotocol.io/specification/2024-11-05/server/tools/#tool-result
    const contentSchema = z.array(
      z.union([
        z.object({ type: z.literal('text'), text: z.string() }),
        z.object({ type: z.literal('image'), data: z.string(), mimeType: z.string() })
      ])
    )
    const { success, data: content } = contentSchema.safeParse(result.content)
    if (!success) {
      return JSON.stringify(result)
    }
    return content
  }

  async cleanup() {
    /**
     * Clean up resources
     */
    await this.mcp.close()
  }
}

// MCPClient.fromCommand('npx', ['-y', '@modelcontextprotocol/server-aws-kb-retrieval'], { aa: 'aa' });
