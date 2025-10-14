import { createStructuredError } from '../../../../../common/errors'

export const BACKGROUND_AGENT_ERROR_MESSAGES = {
  background_session_write_failed: 'Failed to write background session file',
  background_session_create_failed: 'Failed to create background session for message',
  background_session_message_persist_failed: 'Failed to persist background session message',
  background_agent_not_found: 'Background agent not found',
  background_task_not_found: 'Background task not found',
  background_cron_expression_invalid: 'Invalid cron expression for background task',
  background_execution_result_missing: 'No execution result found for background task',
  background_user_message_persist_failed:
    'Failed to persist user message to background session',
  background_assistant_message_persist_failed:
    'Failed to persist assistant response to background session'
} as const

export type BackgroundAgentErrorCode = keyof typeof BACKGROUND_AGENT_ERROR_MESSAGES

export const createBackgroundAgentError = (
  code: BackgroundAgentErrorCode,
  metadata?: Record<string, unknown>
) =>
  createStructuredError({
    name: 'BackgroundAgentError',
    message: BACKGROUND_AGENT_ERROR_MESSAGES[code],
    code,
    metadata
  })
