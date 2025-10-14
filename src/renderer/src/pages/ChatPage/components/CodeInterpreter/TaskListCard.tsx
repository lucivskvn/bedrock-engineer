import React, { useState } from 'react'
import { FaList, FaClock, FaDocker, FaCheck, FaTimes } from 'react-icons/fa'
import { MdCancel } from 'react-icons/md'
import { AsyncTaskCard, TaskStatus } from './AsyncTaskCard'

export interface TaskErrorInfo {
  message: string
  code?: string
  metadata?: Record<string, unknown>
}

export interface TaskListResult {
  success: boolean
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
  result?: {
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

export interface TaskInfo {
  taskId: string
  status: TaskStatus
  createdAt: Date
  startedAt?: Date
  completedAt?: Date
  code: string
  environment: 'basic' | 'datascience'
  inputFiles?: Array<{ path: string }>
  result?: any
  error?: string
  errorInfo?: TaskErrorInfo
  progress?: number
}

interface TaskListCardProps {
  result: TaskListResult
}

const statusIcons = {
  pending: { icon: FaClock, color: 'text-yellow-500' },
  running: { icon: FaDocker, color: 'text-blue-500' },
  completed: { icon: FaCheck, color: 'text-green-500' },
  failed: { icon: FaTimes, color: 'text-red-500' },
  cancelled: { icon: MdCancel, color: 'text-gray-500' }
}

export const TaskListCard: React.FC<TaskListCardProps> = ({ result }) => {
  const [filterStatus, setFilterStatus] = useState<TaskStatus | 'all'>('all')
  const [isExpanded, setIsExpanded] = useState(true)

  // Filter tasks based on selected status
  const filteredTasks =
    filterStatus === 'all'
      ? result.tasks
      : result.tasks.filter((task) => task.status === filterStatus)

  // Convert TaskInfo to AsyncTaskInfo format for AsyncTaskCard
  const convertToAsyncTaskInfo = (task: TaskInfo) => ({
    taskId: task.taskId,
    status: task.status,
    message: `Task ${task.status}`,
    progress: task.progress,
    createdAt: task.createdAt.toISOString(),
    startedAt: task.startedAt?.toISOString(),
    completedAt: task.completedAt?.toISOString(),
    executionResult: task.result
  })

  if (!result.success) {
    const errorInfo = result.result?.errorInfo
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 p-4 mb-2">
        <div className="flex items-center gap-3 mb-2">
          <FaTimes className="w-5 h-5 text-red-500" />
          <span className="font-medium text-sm dark:text-gray-200">
            Code Interpreter Task List - Error
          </span>
        </div>
        <div className="text-sm text-red-700 dark:text-red-300">{result.message}</div>
        {errorInfo && (
          <div className="mt-2 text-xs text-red-600 dark:text-red-200 space-y-1">
            {errorInfo.code && <div>Code: {errorInfo.code}</div>}
            {errorInfo.metadata && Object.keys(errorInfo.metadata).length > 0 && (
              <pre className="whitespace-pre-wrap break-words bg-red-100/60 dark:bg-red-900/40 p-2 rounded border border-red-200 dark:border-red-700">
                {JSON.stringify(errorInfo.metadata, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 mb-2">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <FaList className="w-5 h-5 text-blue-500" />
          <div>
            <span className="font-medium text-sm dark:text-gray-200">
              Code Interpreter Task List
            </span>
            <div className="text-xs text-gray-500 dark:text-gray-400">{result.message}</div>
          </div>
        </div>

        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          {isExpanded ? '▼' : '▶'} {isExpanded ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {/* Summary Stats - Clickable Filters */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-4 text-xs">
        {Object.entries(result.summary).map(([status, count]) => {
          const statusKey = status as keyof typeof statusIcons
          const statusConfig = statusIcons[statusKey]
          if (!statusConfig || status === 'total') return null

          const StatusIcon = statusConfig.icon
          const isActive = filterStatus === status
          return (
            <button
              key={status}
              onClick={() => setFilterStatus(status as TaskStatus)}
              className={`flex items-center gap-1 px-2 py-1 rounded transition-colors cursor-pointer hover:shadow-sm ${
                isActive
                  ? 'bg-blue-100 dark:bg-blue-900/40 ring-1 ring-blue-300 dark:ring-blue-600'
                  : 'bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600'
              }`}
            >
              <StatusIcon className={`w-3 h-3 ${statusConfig.color}`} />
              <span className="capitalize text-gray-700 dark:text-gray-300">{status}</span>
              <span className="font-medium text-gray-900 dark:text-gray-100">{count}</span>
            </button>
          )
        })}
        <button
          onClick={() => setFilterStatus('all')}
          className={`flex items-center gap-1 px-2 py-1 rounded transition-colors cursor-pointer hover:shadow-sm ${
            filterStatus === 'all'
              ? 'bg-blue-100 dark:bg-blue-900/40 ring-1 ring-blue-300 dark:ring-blue-600'
              : 'bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30'
          }`}
        >
          <span className="text-blue-700 dark:text-blue-300">Total</span>
          <span className="font-medium text-blue-900 dark:text-blue-100">
            {result.summary.total}
          </span>
        </button>
      </div>

      {isExpanded && (
        <>
          {/* Task List */}
          {filteredTasks.length === 0 ? (
            <div className="text-center py-6 text-gray-500 dark:text-gray-400">
              <FaList className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <div className="text-sm">No tasks found</div>
              {filterStatus !== 'all' && (
                <button
                  onClick={() => setFilterStatus('all')}
                  className="text-xs text-blue-500 hover:text-blue-700 mt-1"
                >
                  Show all tasks
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {filteredTasks.map((task) => (
                <AsyncTaskCard key={task.taskId} taskInfo={convertToAsyncTaskInfo(task)} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
