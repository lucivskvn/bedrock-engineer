import { ExecutionError } from '../../base/errors'

interface FileExecutionErrorOptions {
  toolName: string
  reason: string
  error: unknown
  metadata?: Record<string, unknown>
}

/**
 * Produce a stable summary string for unknown error inputs.
 */
export function summarizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name || 'Unknown error'
  }

  if (typeof error === 'string') {
    return error
  }

  if (error === undefined) {
    return 'undefined'
  }

  if (error === null) {
    return 'null'
  }

  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

/**
 * Create a structured ExecutionError for filesystem tools with a static message.
 */
export function createFileExecutionError({
  toolName,
  reason,
  error,
  metadata
}: FileExecutionErrorOptions): ExecutionError {
  const detailMessage = summarizeError(error)
  const cause = error instanceof Error ? error : undefined

  const structuredMetadata: Record<string, unknown> = {
    reason,
    detailMessage,
    ...metadata
  }

  if (!cause && error !== undefined) {
    structuredMetadata.originalError = error
  }

  return new ExecutionError('Tool execution failed.', toolName, cause, structuredMetadata)
}
