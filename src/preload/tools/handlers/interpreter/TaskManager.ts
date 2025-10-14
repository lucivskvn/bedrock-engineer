/**
 * Task Manager for async CodeInterpreter execution
 * Handles task lifecycle, status tracking, and concurrent execution management
 */

import { randomUUID } from 'crypto'
import {
  TaskInfo,
  TaskStatus,
  TaskManagerConfig,
  CodeInterpreterResult,
  PythonEnvironment,
  TaskErrorInfo
} from './types'
import { ToolLogger } from '../../base/types'

/**
 * Task Manager class for handling async code execution
 */
export class TaskManager {
  private tasks: Map<string, TaskInfo> = new Map()
  private runningTasks: Set<string> = new Set()
  private logger: ToolLogger
  private config: TaskManagerConfig
  private cleanupTimer?: NodeJS.Timeout

  constructor(logger: ToolLogger, config?: Partial<TaskManagerConfig>) {
    this.logger = logger
    this.config = {
      maxConcurrentTasks: config?.maxConcurrentTasks ?? 3,
      taskTimeout: config?.taskTimeout ?? 300000, // 5 minutes default
      maxTaskHistory: config?.maxTaskHistory ?? 50,
      cleanupInterval: config?.cleanupInterval ?? 60000 // 1 minute cleanup interval
    }

    this.startCleanupTimer()
    this.logger.info('TaskManager initialized', {
      maxConcurrentTasks: this.config.maxConcurrentTasks,
      taskTimeout: this.config.taskTimeout
    })
  }

  /**
   * Create a new task for async execution
   */
  createTask(
    code: string,
    environment: PythonEnvironment = 'datascience',
    inputFiles?: Array<{ path: string }>
  ): TaskInfo {
    const taskId = this.generateTaskId()
    const task: TaskInfo = {
      taskId,
      status: 'pending',
      createdAt: new Date(),
      code,
      environment,
      inputFiles,
      progress: 0
    }

    this.tasks.set(taskId, task)

    this.logger.info('Task created', {
      taskId,
      codeLength: code.length,
      environment,
      inputFileCount: inputFiles?.length || 0
    })

    return task
  }

  /**
   * Get task information by ID
   */
  getTask(taskId: string): TaskInfo | undefined {
    return this.tasks.get(taskId)
  }

  /**
   * Update task status
   */
  updateTaskStatus(taskId: string, status: TaskStatus, progress?: number): boolean {
    const task = this.tasks.get(taskId)
    if (!task) {
      this.logger.warn('Task not found for status update', { taskId, status })
      return false
    }

    const oldStatus = task.status
    task.status = status

    if (progress !== undefined) {
      task.progress = Math.max(0, Math.min(100, progress))
    }

    // Update timestamps based on status
    switch (status) {
      case 'running':
        task.startedAt = new Date()
        this.runningTasks.add(taskId)
        break
      case 'completed':
      case 'failed':
      case 'cancelled':
        task.completedAt = new Date()
        this.runningTasks.delete(taskId)
        break
    }

    this.logger.debug('Task status updated', {
      taskId,
      oldStatus,
      newStatus: status,
      progress: task.progress
    })

    return true
  }

  /**
   * Set task result when completed
   */
  setTaskResult(taskId: string, result: CodeInterpreterResult): boolean {
    const task = this.tasks.get(taskId)
    if (!task) {
      this.logger.warn('Task not found for result setting', { taskId })
      return false
    }

    task.result = result
    this.updateTaskStatus(taskId, 'completed', 100)

    this.logger.info('Task result set', {
      taskId,
      success: result.success,
      executionTime: result.executionTime
    })

    return true
  }

  /**
   * Set task error when failed
   */
  setTaskError(taskId: string, error: TaskErrorInfo | string): boolean {
    const task = this.tasks.get(taskId)
    if (!task) {
      this.logger.warn('Task not found for error setting', { taskId })
      return false
    }

    const normalizedError: TaskErrorInfo =
      typeof error === 'string'
        ? { message: error }
        : {
            message: error.message,
            code: error.code,
            metadata: error.metadata
          }

    task.error = normalizedError.message
    task.errorInfo = normalizedError
    this.updateTaskStatus(taskId, 'failed', 0)

    this.logger.error('Task error set', {
      taskId,
      errorCode: normalizedError.code,
      hasMetadata: !!normalizedError.metadata
    })

    return true
  }

  /**
   * Cancel a task
   */
  cancelTask(taskId: string): boolean {
    const task = this.tasks.get(taskId)
    if (!task) {
      this.logger.warn('Task not found for cancellation', { taskId })
      return false
    }

    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
      this.logger.warn('Cannot cancel task in final state', {
        taskId,
        currentStatus: task.status
      })
      return false
    }

    this.updateTaskStatus(taskId, 'cancelled', 0)

    this.logger.info('Task cancelled', { taskId })

    return true
  }

  /**
   * Check if we can start a new task (within concurrent limit)
   */
  canStartNewTask(): boolean {
    const runningCount = this.runningTasks.size
    const canStart = runningCount < this.config.maxConcurrentTasks

    if (!canStart) {
      this.logger.debug('Cannot start new task - concurrent limit reached', {
        runningCount,
        maxConcurrent: this.config.maxConcurrentTasks
      })
    }

    return canStart
  }

  /**
   * Get all tasks with optional status filter
   */
  getAllTasks(statusFilter?: TaskStatus): TaskInfo[] {
    const allTasks = Array.from(this.tasks.values())

    if (statusFilter) {
      return allTasks.filter((task) => task.status === statusFilter)
    }

    return allTasks.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  }

  /**
   * Get running task count
   */
  getRunningTaskCount(): number {
    return this.runningTasks.size
  }

  /**
   * Get task statistics
   */
  getTaskStats(): {
    total: number
    pending: number
    running: number
    completed: number
    failed: number
    cancelled: number
  } {
    const tasks = Array.from(this.tasks.values())

    return {
      total: tasks.length,
      pending: tasks.filter((t) => t.status === 'pending').length,
      running: tasks.filter((t) => t.status === 'running').length,
      completed: tasks.filter((t) => t.status === 'completed').length,
      failed: tasks.filter((t) => t.status === 'failed').length,
      cancelled: tasks.filter((t) => t.status === 'cancelled').length
    }
  }

  /**
   * Generate unique task ID
   */
  private generateTaskId(): string {
    return `task_${Date.now()}_${randomUUID().substring(0, 8)}`
  }

  /**
   * Start periodic cleanup of old tasks
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupOldTasks()
    }, this.config.cleanupInterval)
  }

  /**
   * Clean up old completed/failed/cancelled tasks
   */
  private cleanupOldTasks(): void {
    const tasks = Array.from(this.tasks.values())
    const finishedTasks = tasks.filter((task) =>
      ['completed', 'failed', 'cancelled'].includes(task.status)
    )

    // Keep only the most recent tasks up to maxTaskHistory
    if (finishedTasks.length > this.config.maxTaskHistory) {
      finishedTasks
        .sort((a, b) => (a.completedAt?.getTime() || 0) - (b.completedAt?.getTime() || 0))
        .slice(0, finishedTasks.length - this.config.maxTaskHistory)
        .forEach((task) => {
          this.tasks.delete(task.taskId)
        })

      this.logger.debug('Cleaned up old tasks', {
        removedCount: finishedTasks.length - this.config.maxTaskHistory,
        remainingCount: this.tasks.size
      })
    }

    // Also clean up tasks that have been running too long
    const now = new Date()
    const timedOutTasks = tasks.filter((task) => {
      if (task.status !== 'running' || !task.startedAt) return false
      return now.getTime() - task.startedAt.getTime() > this.config.taskTimeout
    })

    timedOutTasks.forEach((task) => {
      this.setTaskError(task.taskId, {
        message: 'Task timed out.',
        code: 'TASK_TIMEOUT',
        metadata: {
          taskId: task.taskId,
          runningTimeMs: now.getTime() - (task.startedAt?.getTime() || 0),
          timeoutMs: this.config.taskTimeout
        }
      })
      this.logger.warn('Task timed out and marked as failed', {
        taskId: task.taskId,
        runningTime: now.getTime() - (task.startedAt?.getTime() || 0)
      })
    })
  }

  /**
   * Dispose of the task manager
   */
  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = undefined
    }

    // Cancel all running tasks
    Array.from(this.runningTasks).forEach((taskId) => {
      this.cancelTask(taskId)
    })

    this.logger.info('TaskManager disposed', {
      totalTasks: this.tasks.size,
      cancelledTasks: this.runningTasks.size
    })

    this.tasks.clear()
    this.runningTasks.clear()
  }
}
