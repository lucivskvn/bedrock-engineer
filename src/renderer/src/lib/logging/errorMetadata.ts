export type ErrorMetadata = {
  errorName: string
  errorMessage: string
  errorCause?: unknown
}

const DEFAULT_ERROR_NAME = 'UnknownError'
const DEFAULT_ERROR_MESSAGE = 'Unknown error occurred.'
const DEFAULT_MAX_LENGTH = 200

/**
 * Truncate a value for safe logging.
 */
export const truncateForLogging = (
  value: string | null | undefined,
  maxLength: number = DEFAULT_MAX_LENGTH
): string | undefined => {
  if (!value) {
    return undefined
  }

  const normalized = value.trim()
  if (!normalized) {
    return undefined
  }

  if (normalized.length <= maxLength) {
    return normalized
  }

  return `${normalized.slice(0, maxLength)}…`
}

const MAX_CAUSE_DEPTH = 2
const MAX_CAUSE_ARRAY_LENGTH = 10
const MAX_CAUSE_OBJECT_ENTRIES = 25
const MAX_CAUSE_TYPED_ARRAY_LENGTH = 20

const sanitizeCauseValue = (
  value: unknown,
  depth: number,
  seen: WeakSet<object>
): unknown => {
  if (depth > MAX_CAUSE_DEPTH) {
    return '[Truncated]'
  }

  if (typeof value === 'string') {
    return truncateForLogging(value)
  }

  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value
  }

  if (typeof value === 'bigint') {
    return value.toString()
  }

  if (typeof value === 'symbol') {
    return value.toString()
  }

  if (typeof value === 'function') {
    return `[Function ${value.name || 'anonymous'}]`
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return '[Circular]'
    }
    seen.add(value)
    try {
      return value
        .slice(0, MAX_CAUSE_ARRAY_LENGTH)
        .map((item) => sanitizeCauseValue(item, depth + 1, seen))
    } finally {
      seen.delete(value)
    }
  }

  if (ArrayBuffer.isView(value)) {
    if (value instanceof DataView) {
      return `[DataView byteLength=${value.byteLength}]`
    }

    const typedArray = value as ArrayBufferView & { length: number }
    if (seen.has(typedArray)) {
      return '[Circular]'
    }
    seen.add(typedArray)
    try {
      const values = Array.from(typedArray as unknown as Array<unknown>)
        .slice(0, MAX_CAUSE_TYPED_ARRAY_LENGTH)
        .map((item) => sanitizeCauseValue(item, depth + 1, seen))

      if (typedArray.length > MAX_CAUSE_TYPED_ARRAY_LENGTH) {
        values.push('[Truncated]')
      }

      return values
    } finally {
      seen.delete(typedArray)
    }
  }

  if (value instanceof ArrayBuffer) {
    return `[ArrayBuffer byteLength=${value.byteLength}]`
  }

  if (value instanceof Set) {
    if (seen.has(value)) {
      return '[Circular]'
    }
    seen.add(value)
    try {
      return Array.from(value)
        .slice(0, MAX_CAUSE_ARRAY_LENGTH)
        .map((item) => sanitizeCauseValue(item, depth + 1, seen))
    } finally {
      seen.delete(value)
    }
  }

  if (value instanceof WeakSet) {
    return '[WeakSet]'
  }

  if (value instanceof Map) {
    if (seen.has(value)) {
      return '[Circular]'
    }
    seen.add(value)
    try {
      return Array.from(value.entries())
        .slice(0, MAX_CAUSE_ARRAY_LENGTH)
        .map(([key, entryValue]) => [
          sanitizeCauseValue(key, depth + 1, seen),
          sanitizeCauseValue(entryValue, depth + 1, seen)
        ])
    } finally {
      seen.delete(value)
    }
  }

  if (value instanceof WeakMap) {
    return '[WeakMap]'
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (value instanceof URL) {
    return truncateForLogging(value.toString())
  }

  if (value instanceof Error) {
    if (seen.has(value)) {
      return '[Circular]'
    }
    seen.add(value)
    try {
      const sanitized: Record<string, unknown> = {
        errorName: value.name || DEFAULT_ERROR_NAME,
        errorMessage: truncateForLogging(value.message) ?? DEFAULT_ERROR_MESSAGE
      }

      const nestedCause = sanitizeCauseValue(
        (value as Error & { cause?: unknown }).cause,
        depth + 1,
        seen
      )

      if (nestedCause !== undefined) {
        sanitized.errorCause = nestedCause
      }

      return sanitized
    } finally {
      seen.delete(value)
    }
  }

  if (value instanceof RegExp) {
    return value.toString()
  }

  if (value instanceof Promise) {
    return '[Promise]'
  }

  if (value && typeof value === 'object') {
    if (seen.has(value)) {
      return '[Circular]'
    }
    seen.add(value)
    try {
      const entries = Object.entries(value as Record<string, unknown>)
      if (entries.length === 0) {
        return undefined
      }

      const result = entries
        .slice(0, MAX_CAUSE_OBJECT_ENTRIES)
        .reduce<Record<string, unknown>>((acc, [key, entryValue]) => {
          const sanitized = sanitizeCauseValue(entryValue, depth + 1, seen)
          if (sanitized !== undefined) {
            acc[key] = sanitized
          }
          return acc
        }, {})

      if (entries.length > MAX_CAUSE_OBJECT_ENTRIES) {
        result.__truncated__ = `[Truncated ${entries.length - MAX_CAUSE_OBJECT_ENTRIES} entries]`
      }

      return Object.keys(result).length > 0 ? result : undefined
    } finally {
      seen.delete(value)
    }
  }

  return undefined
}

const sanitizeErrorCause = (error: unknown): unknown => {
  if (!error || typeof error !== 'object') {
    return undefined
  }

  const cause = (error as { cause?: unknown }).cause
  if (cause === undefined) {
    return undefined
  }

  return sanitizeCauseValue(cause, 0, new WeakSet())
}

/**
 * Extract normalized error metadata for logging without exposing sensitive details.
 */
export const extractErrorMetadata = (error: unknown): ErrorMetadata => {
  const sanitizedCause = sanitizeErrorCause(error)

  if (error instanceof Error) {
    const metadata: ErrorMetadata = {
      errorName: error.name || DEFAULT_ERROR_NAME,
      errorMessage: truncateForLogging(error.message) ?? DEFAULT_ERROR_MESSAGE
    }

    if (sanitizedCause !== undefined) {
      metadata.errorCause = sanitizedCause
    }

    return metadata
  }

  if (typeof error === 'string') {
    return {
      errorName: 'Error',
      errorMessage: truncateForLogging(error) ?? DEFAULT_ERROR_MESSAGE
    }
  }

  if (error && typeof error === 'object' && 'message' in error && typeof (error as any).message === 'string') {
    const metadata: ErrorMetadata = {
      errorName: 'Error',
      errorMessage: truncateForLogging((error as { message: string }).message) ?? DEFAULT_ERROR_MESSAGE
    }

    if (sanitizedCause !== undefined) {
      metadata.errorCause = sanitizedCause
    }

    return metadata
  }

  const metadata: ErrorMetadata = {
    errorName: DEFAULT_ERROR_NAME,
    errorMessage: truncateForLogging(String(error)) ?? DEFAULT_ERROR_MESSAGE
  }

  if (sanitizedCause !== undefined) {
    metadata.errorCause = sanitizedCause
  }

  return metadata
}
