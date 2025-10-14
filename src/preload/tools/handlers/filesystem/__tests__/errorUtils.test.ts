import { createFileExecutionError, summarizeError } from '../errorUtils'
import { isExecutionError } from '../../../base/errors'

describe('summarizeError', () => {
  it('returns meaningful summaries for common inputs', () => {
    expect(summarizeError(new Error('boom'))).toBe('boom')
    expect(summarizeError('failure')).toBe('failure')
    expect(summarizeError(undefined)).toBe('undefined')
    expect(summarizeError(null)).toBe('null')
  })
})

describe('createFileExecutionError', () => {
  it('wraps errors with static message and structured metadata', () => {
    const baseError = new Error('Permission denied')

    const executionError = createFileExecutionError({
      toolName: 'readFiles',
      reason: 'READ_FILE_FAILED',
      error: baseError,
      metadata: { requestedPath: '/tmp/example.txt' }
    })

    expect(isExecutionError(executionError)).toBe(true)
    expect(executionError.message).toBe('Tool execution failed.')
    expect(executionError.metadata).toMatchObject({
      reason: 'READ_FILE_FAILED',
      detailMessage: 'Permission denied',
      requestedPath: '/tmp/example.txt'
    })
    expect(executionError.metadata).not.toHaveProperty('originalError')
  })

  it('preserves original non-error values for diagnostics', () => {
    const executionError = createFileExecutionError({
      toolName: 'listFiles',
      reason: 'LIST_FILES_FAILED',
      error: { status: 500 },
      metadata: { dirPath: '/tmp/project' }
    })

    expect(executionError.metadata).toMatchObject({
      reason: 'LIST_FILES_FAILED',
      detailMessage: '{"status":500}',
      dirPath: '/tmp/project',
      originalError: { status: 500 }
    })
  })
})
