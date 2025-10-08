const MIN_FETCH_TIMEOUT_MS = 1000
const MAX_FETCH_TIMEOUT_MS = 15_000
export const DEFAULT_FETCH_TIMEOUT_MS = 10_000
export const MAX_FETCH_BODY_BYTES = 5 * 1024 * 1024
const DISALLOWED_HEADERS = new Set(['host', 'connection', 'proxy-connection', 'content-length'])

export function clampFetchTimeout(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(Math.max(Math.trunc(value), MIN_FETCH_TIMEOUT_MS), MAX_FETCH_TIMEOUT_MS)
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) {
      return Math.min(Math.max(parsed, MIN_FETCH_TIMEOUT_MS), MAX_FETCH_TIMEOUT_MS)
    }
  }

  return DEFAULT_FETCH_TIMEOUT_MS
}

export function sanitizeRequestHeaders(headers: unknown): Record<string, string> {
  if (!headers || typeof headers !== 'object') {
    return {}
  }

  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (typeof key !== 'string') {
      continue
    }
    const lowerKey = key.toLowerCase()
    if (DISALLOWED_HEADERS.has(lowerKey)) {
      continue
    }
    if (typeof value === 'string') {
      result[key] = value
    } else if (Array.isArray(value) && typeof value[0] === 'string') {
      result[key] = value[0] as string
    }
  }
  return result
}

export function sanitizeRequestBody(body: unknown): string | Buffer | undefined {
  if (typeof body === 'string') {
    if (Buffer.byteLength(body, 'utf8') > MAX_FETCH_BODY_BYTES) {
      throw new Error('Request body too large')
    }
    return body
  }

  if (body instanceof ArrayBuffer) {
    const buffer = Buffer.from(body)
    if (buffer.length > MAX_FETCH_BODY_BYTES) {
      throw new Error('Request body too large')
    }
    return buffer
  }

  if (Buffer.isBuffer(body)) {
    if (body.length > MAX_FETCH_BODY_BYTES) {
      throw new Error('Request body too large')
    }
    return body
  }

  if (body === undefined || body === null) {
    return undefined
  }

  throw new Error('Unsupported request body type')
}
