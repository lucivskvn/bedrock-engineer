import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals'

import { TaskManager } from './TaskManager'
import { TaskErrorInfo } from './types'

const createMockLogger = () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  verbose: jest.fn()
})

describe('TaskManager.setTaskError', () => {
  let logger: ReturnType<typeof createMockLogger>
  let manager: TaskManager

  beforeEach(() => {
    logger = createMockLogger()
    manager = new TaskManager(logger)
  })

  afterEach(() => {
    manager.dispose()
  })

  it('stores structured error details when provided', () => {
    const task = manager.createTask('print(1)')
    const errorInfo: TaskErrorInfo = {
      message: 'Task execution failed.',
      code: 'UNIT_TEST',
      metadata: { reason: 'unit-test' }
    }

    const result = manager.setTaskError(task.taskId, errorInfo)

    expect(result).toBe(true)

    const storedTask = manager.getTask(task.taskId)
    expect(storedTask?.error).toBe('Task execution failed.')
    expect(storedTask?.errorInfo).toEqual(errorInfo)
    expect(logger.error).toHaveBeenCalledWith('Task error set', {
      taskId: task.taskId,
      errorCode: 'UNIT_TEST',
      hasMetadata: true
    })
  })

  it('wraps string errors into structured info', () => {
    const task = manager.createTask('print(2)')

    const result = manager.setTaskError(task.taskId, 'Task failed during test.')

    expect(result).toBe(true)

    const storedTask = manager.getTask(task.taskId)
    expect(storedTask?.error).toBe('Task failed during test.')
    expect(storedTask?.errorInfo).toEqual({ message: 'Task failed during test.' })
    expect(logger.error).toHaveBeenCalledWith('Task error set', {
      taskId: task.taskId,
      errorCode: undefined,
      hasMetadata: false
    })
  })
})
