import { createBackgroundAgentError, BACKGROUND_AGENT_ERROR_MESSAGES } from '../errors'

describe('createBackgroundAgentError', () => {
  it('returns a structured error with static message and metadata snapshot', () => {
    const error = createBackgroundAgentError('background_agent_not_found', {
      agentId: 'agent-123',
      taskId: 'task-abc'
    })

    expect(error.name).toBe('BackgroundAgentError')
    expect(error.code).toBe('background_agent_not_found')
    expect(error.message).toBe(BACKGROUND_AGENT_ERROR_MESSAGES.background_agent_not_found)
    expect(error.metadata).toEqual({ agentId: 'agent-123', taskId: 'task-abc' })
  })

  it('omits metadata when none is provided', () => {
    const error = createBackgroundAgentError('background_execution_result_missing')

    expect(error.code).toBe('background_execution_result_missing')
    expect(error.message).toBe(
      BACKGROUND_AGENT_ERROR_MESSAGES.background_execution_result_missing
    )
    expect(error).not.toHaveProperty('metadata')
  })
})
