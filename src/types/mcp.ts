export interface McpToolExecutionResult {
  found: boolean
  success: boolean
  name: string
  message: string
  result: unknown
  error?: string
  details?: Record<string, unknown>
}

export interface McpConnectionTestDetails {
  toolCount?: number
  toolNames?: string[]
  error?: string
  errorDetails?: string
  startupTime?: number
  serverName?: string
}

export interface McpConnectionTestResult {
  success: boolean
  message: string
  details?: McpConnectionTestDetails
}
