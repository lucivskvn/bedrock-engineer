import { ExecutionError, RateLimitError, ToolNotFoundError, wrapError } from '../errors'

describe('tool error utilities', () => {
  it('emits a static message for ToolNotFoundError', () => {
    const error = new ToolNotFoundError('missing-tool')

    expect(error).toBeInstanceOf(ToolNotFoundError)
    expect(error.message).toBe('Tool not found.')
    expect(error.metadata).toEqual(
      expect.objectContaining({ toolName: 'missing-tool' })
    )
  })

  it('wraps generic errors with a static execution message', () => {
    const cause = new Error('socket disconnected')
    cause.name = 'NetworkFailure'

    const wrapped = wrapError(cause, 'example-tool')

    expect(wrapped).toBeInstanceOf(ExecutionError)
    expect(wrapped.message).toBe('Tool execution failed.')
    expect(wrapped.metadata).toEqual(
      expect.objectContaining({
        toolName: 'example-tool',
        causeName: 'NetworkFailure',
        causeMessage: 'socket disconnected'
      })
    )
  })

  it('wraps throttling errors as RateLimitError with static messaging', () => {
    const throttled = new Error('too many requests')
    throttled.name = 'ThrottlingException'

    const wrapped = wrapError(throttled, 'example-tool')

    expect(wrapped).toBeInstanceOf(RateLimitError)
    expect(wrapped.message).toBe('Tool rate limit exceeded.')
    expect(wrapped.metadata).toEqual(
      expect.objectContaining({
        toolName: 'example-tool',
        detailMessage: 'too many requests'
      })
    )
  })

  it('wraps non-error values with static execution messaging', () => {
    const wrapped = wrapError({ reason: 'boom' }, 'example-tool')

    expect(wrapped).toBeInstanceOf(ExecutionError)
    expect(wrapped.message).toBe('Tool execution failed.')
    expect(wrapped.metadata).toEqual(
      expect.objectContaining({
        toolName: 'example-tool',
        originalError: { reason: 'boom' }
      })
    )
  })

  it('stores rate limit details without leaking into the message', () => {
    const error = new RateLimitError('service limit exceeded', 'example-tool', ['retry'])

    expect(error.message).toBe('Tool rate limit exceeded.')
    expect(error.metadata).toEqual(
      expect.objectContaining({
        toolName: 'example-tool',
        suggestedAlternatives: ['retry'],
        detailMessage: 'service limit exceeded'
      })
    )
  })
})
