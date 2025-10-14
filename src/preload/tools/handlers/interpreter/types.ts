/**
 * Simplified types for CodeInterpreter tool
 */

import { ToolResult } from '../../../../types/tools'

/**
 * Supported programming languages (currently Python only)
 */
export type SupportedLanguage = 'python'

/**
 * Python execution environments with different library sets
 */
export type PythonEnvironment = 'basic' | 'datascience'

/**
 * Docker image build configuration
 */
export interface DockerImageConfig {
  name: string
  tag: string
  environment: PythonEnvironment
  libraries: string[]
  systemPackages?: string[]
  environmentVariables?: Record<string, string>
}

/**
 * Docker build result
 */
export interface DockerBuildResult {
  success: boolean
  imageName: string
  buildTime: number
  error?: string
}

/**
 * Input file for CodeInterpreter
 */
export interface InputFile {
  path: string // ホスト側のファイルパス
}

/**
 * CodeInterpreter input type with async execution support
 */
export interface CodeInterpreterInput {
  type: 'codeInterpreter'
  code: string // Python code to execute
  environment?: PythonEnvironment // Optional: 'basic' | 'datascience' (default: 'datascience')
  inputFiles?: InputFile[] // Optional: files to mount in container
  // 非同期実行機能
  async?: boolean // 非同期実行モード（デフォルト: false）
  taskId?: string // 状態確認・キャンセル用のタスクID
  operation?: 'execute' | 'status' | 'cancel' | 'list' // 操作種別（デフォルト: 'execute'）
  statusFilter?: TaskStatus // リスト操作時のステータスフィルター
}

/**
 * Code execution result (internal)
 */
export interface CodeExecutionResult {
  stdout: string
  stderr: string
  exitCode: number
  executionTime: number
}

export interface TaskErrorInfo {
  message: string
  code?: string
  metadata?: Record<string, unknown>
}

/**
 * Simplified CodeInterpreter result type
 */
export interface CodeInterpreterResult extends ToolResult {
  name: 'codeInterpreter'
  code: string // The executed code - included in result for UI display
  output: string // Combined stdout + file info for easy consumption
  error?: string // stderr (only when error occurs)
  executionTime: number
  result: {
    code: string // The executed code - duplicated here for backward compatibility
    stdout: string
    stderr: string
    exitCode: number
    files: string[] // List of generated files
  }
}

/**
 * User-configurable execution configuration
 */
export interface ExecutionConfig {
  timeout: number // User configurable: 30, 60, 120 seconds
  memoryLimit: string // User configurable: '128m', '256m', '512m', '1g'
  cpuLimit: number // User configurable: 0.5, 1.0, 2.0
  environment?: PythonEnvironment // Environment type
}

/**
 * CodeInterpreter container configuration for UI settings
 */
export interface CodeInterpreterContainerConfig {
  memoryLimit: string // Memory limit for containers
  cpuLimit: number // CPU limit for containers
  timeout: number // Execution timeout in seconds
}

/**
 * Docker availability status
 */
export interface DockerAvailabilityStatus {
  available: boolean
  version?: string
  error?: string
  lastChecked?: Date
}

/**
 * Workspace configuration (simplified, mostly internal)
 */
export interface WorkspaceConfig {
  basePath: string
  sessionId: string
  maxFiles: number
  maxFileSize: number
  cleanupOnExit: boolean
}

/**
 * Task status for async execution
 */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

/**
 * Task information for async execution
 */
export interface TaskInfo {
  taskId: string
  status: TaskStatus
  createdAt: Date
  startedAt?: Date
  completedAt?: Date
  code: string
  environment: PythonEnvironment
  inputFiles?: InputFile[]
  result?: CodeInterpreterResult
  error?: string
  errorInfo?: TaskErrorInfo
  progress?: number // 0-100 for progress indication
}

/**
 * Async execution result - returned immediately when starting async task
 */
export interface AsyncTaskResult extends ToolResult {
  name: 'codeInterpreter'
  taskId: string
  status: TaskStatus
  message: string
  progress?: number
  result: {
    taskId: string
    status: TaskStatus
    createdAt: string
    startedAt?: string
    completedAt?: string
    executionResult?: CodeInterpreterResult
    errorInfo?: TaskErrorInfo
  }
}

/**
 * Task list result - returned when requesting task list
 */
export interface TaskListResult extends ToolResult {
  name: 'codeInterpreter'
  operation: 'list'
  tasks: TaskInfo[]
  summary: {
    total: number
    pending: number
    running: number
    completed: number
    failed: number
    cancelled: number
  }
  message: string
  result: {
    tasks: TaskInfo[]
    summary: {
      total: number
      pending: number
      running: number
      completed: number
      failed: number
      cancelled: number
    }
    statusFilter?: TaskStatus
    errorInfo?: TaskErrorInfo
  }
}

/**
 * Task manager configuration
 */
export interface TaskManagerConfig {
  maxConcurrentTasks: number // Maximum number of concurrent tasks
  taskTimeout: number // Task timeout in milliseconds
  maxTaskHistory: number // Maximum number of completed tasks to keep in history
  cleanupInterval: number // Cleanup interval in milliseconds
}
