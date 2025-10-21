import { randomUUID } from 'node:crypto'
import type { Response } from 'express'

const REQUEST_ID_HEADER = 'X-Request-Id'
const CACHE_CONTROL_VALUE = 'no-store, no-cache, must-revalidate'

function normaliseRequestIdHeaderValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value || undefined
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === 'string' && entry) {
        return entry
      }
    }
    return undefined
  }

  return undefined
}

export const API_ERROR_MESSAGES = {
  internal_server_error: 'Internal server error',
  invalid_request_payload: 'Invalid request payload',
  rate_limit_exceeded: 'Too many requests',
  metadata_policy_blocked: 'Request blocked by browser metadata policy',
  prototype_pollution_detected: 'Invalid request payload',
  server_auth_not_configured: 'Server authentication is not configured',
  unauthorized_request: 'Unauthorized',
  forbidden_request: 'Forbidden',
  invalid_region_parameter: 'Invalid region parameter',
  nova_sonic_region_check_failed: 'Nova Sonic region check failed',
  bedrock_connectivity_test_failed: 'Bedrock connectivity test failed',
  service_temporarily_unavailable: 'Service temporarily unavailable',
  socket_origin_not_allowed: 'Origin not allowed',
  socket_connection_rate_limited: 'Too many connection attempts',
  socket_authentication_failed: 'Invalid authentication token',
  socket_stream_initialization_failed: 'Failed to initialize AWS streaming session',
  socket_audio_rate_limit_exceeded: 'Audio input rate limit exceeded',
  socket_audio_processing_failed: 'Error processing audio',
  socket_prompt_processing_failed: 'Error processing prompt start',
  socket_system_prompt_failed: 'Error processing system prompt',
  socket_audio_start_failed: 'Error processing audio start',
  socket_stream_end_failed: 'Error processing streaming end events',
  socket_session_initialization_failed: 'Failed to initialize session',
  socket_internal_error: 'Internal server error'
} as const

export type ApiErrorCode = keyof typeof API_ERROR_MESSAGES

export interface ApiErrorPayload {
  code: ApiErrorCode
  message: (typeof API_ERROR_MESSAGES)[ApiErrorCode]
  referenceId?: string
  metadata?: Record<string, unknown>
}

export interface ApiErrorResponseOptions {
  status?: number
  metadata?: Record<string, unknown>
  referenceId?: string
}

export function createApiError(
  code: ApiErrorCode,
  metadata?: Record<string, unknown>,
  referenceId?: string
): ApiErrorPayload {
  const payload: ApiErrorPayload = {
    code,
    message: API_ERROR_MESSAGES[code]
  }

  if (referenceId) {
    payload.referenceId = referenceId
  }

  if (metadata && Object.keys(metadata).length > 0) {
    payload.metadata = metadata
  }

  return payload
}

export function sendApiErrorResponse(
  res: Response,
  code: ApiErrorCode,
  options: ApiErrorResponseOptions = {}
): string {
  const existingHeaderValue =
    typeof res.getHeader === 'function' ? normaliseRequestIdHeaderValue(res.getHeader(REQUEST_ID_HEADER)) : undefined

  const referenceId = options.referenceId ?? existingHeaderValue ?? randomUUID()
  const payload = createApiError(code, options.metadata, referenceId)

  if (typeof res.setHeader === 'function') {
    res.setHeader('Cache-Control', CACHE_CONTROL_VALUE)
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('Expires', '0')
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader(REQUEST_ID_HEADER, referenceId)
  }

  res.status(options.status ?? 500).json({ error: payload })
  return referenceId
}

export function describeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const description: Record<string, unknown> = {
      name: error.name || 'Error'
    }

    if ('code' in error && typeof (error as { code?: unknown }).code === 'string') {
      description.code = (error as { code: string }).code
    }

    if (typeof error.message === 'string' && error.message.length > 0) {
      description.messageLength = error.message.length
    }

    if (typeof error.stack === 'string' && error.stack.length > 0) {
      description.stackLength = error.stack.length
      description.stackFrames = error.stack.split(/\r?\n/).length
    }

    if (
      'metadata' in error &&
      error.metadata &&
      typeof error.metadata === 'object' &&
      !Array.isArray(error.metadata)
    ) {
      description.metadataKeys = Object.keys(error.metadata as Record<string, unknown>).sort()
    }

    return description
  }

  if (error === null) {
    return { type: 'null' }
  }

  return { type: typeof error }
}
