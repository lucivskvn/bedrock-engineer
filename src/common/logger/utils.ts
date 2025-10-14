import { LOG_LEVELS, type LogLevel } from './config'

const PLACEHOLDER_PATTERN = /^\[[A-Za-z]+[^\]]*\]$/
const MAX_DEPTH = 3
const ARRAY_PREVIEW_LIMIT = 3
const RESERVED_STRING_KEYS = new Set(['category', 'process'])

const formatSummary = (
  label: string,
  metrics: Record<string, number | boolean | undefined>
): string => {
  const details = Object.entries(metrics)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${value}`)
  return details.length > 0 ? `[${label} ${details.join(' ')}]` : `[${label}]`
}

const summarizeString = (value: string): string => {
  return formatSummary('string', { length: value.length })
}

const summarizeStack = (value: string): string => {
  const lines = value.split(/\r?\n/).length
  return formatSummary('stack', { length: value.length, lines })
}

const summarizeArray = (
  value: unknown[],
  seen: WeakSet<object>,
  depth: number
): Record<string, unknown> => {
  if (depth >= MAX_DEPTH) {
    return { summary: formatSummary('array', { length: value.length }) }
  }

  const previewValues = value.slice(0, ARRAY_PREVIEW_LIMIT).map((entry) => {
    return sanitizeLogValue(entry, seen, depth + 1)
  })

  const remaining = Math.max(0, value.length - previewValues.length)

  const payload: Record<string, unknown> = {
    type: 'array',
    length: value.length
  }

  if (previewValues.length > 0) {
    payload.preview = previewValues
  }

  if (remaining > 0) {
    payload.truncated = remaining
  }

  return payload
}

const sanitizeError = (
  value: Error & { code?: unknown; cause?: unknown },
  seen: WeakSet<object>,
  depth: number
): Record<string, unknown> => {
  const errorPayload: Record<string, unknown> = {
    type: 'Error',
    name: value.name || 'Error'
  }

  if (typeof value.message === 'string' && value.message.length > 0) {
    errorPayload.message = summarizeString(value.message)
  }

  if (typeof value.code === 'string' && value.code.length > 0) {
    errorPayload.code = summarizeString(value.code)
  }

  if (typeof value.stack === 'string' && value.stack.length > 0) {
    errorPayload.stack = summarizeStack(value.stack)
  }

  if (
    Object.prototype.hasOwnProperty.call(value, 'cause') &&
    value.cause !== undefined
  ) {
    errorPayload.cause = sanitizeLogValue(value.cause, seen, depth + 1)
  }

  for (const [key, propValue] of Object.entries(value)) {
    if (['name', 'message', 'stack', 'cause', 'code'].includes(key)) {
      continue
    }

    errorPayload[key] = sanitizeLogValue(propValue, seen, depth + 1)
  }

  return errorPayload
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return Object.prototype.toString.call(value) === '[object Object]'
}

const createUniqueKeyAssigner = () => {
  const usedKeys = new Set<string>()

  return (preferredKey: string): string => {
    let key = preferredKey
    let counter = 1

    while (usedKeys.has(key)) {
      key = `${preferredKey}_${counter}`
      counter += 1
    }

    usedKeys.add(key)
    return key
  }
}

const sanitizeLogValue = (
  value: unknown,
  seen: WeakSet<object>,
  depth = 0
): unknown => {
  if (value === null) {
    return '[null]'
  }

  if (value === undefined) {
    return '[undefined]'
  }

  if (typeof value === 'string') {
    if (PLACEHOLDER_PATTERN.test(value)) {
      return value
    }
    return summarizeString(value)
  }

  if (typeof value === 'number') {
    return '[number]'
  }

  if (typeof value === 'boolean') {
    return '[boolean]'
  }

  if (typeof value === 'bigint') {
    return '[bigint]'
  }

  if (typeof value === 'symbol') {
    return '[symbol]'
  }

  if (typeof value === 'function') {
    return `[function${value.name ? `:${value.name}` : ''}]`
  }

  if (value instanceof Error) {
    return sanitizeError(value, seen, depth)
  }

  if (value instanceof Date) {
    return '[date]'
  }

  if (value instanceof RegExp) {
    return formatSummary('RegExp', {
      length: value.source.length,
      flagCount: value.flags.length
    })
  }

  if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) {
    return formatSummary('ArrayBuffer', { bytes: value.byteLength })
  }

  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value)) {
    return formatSummary(value.constructor.name, { bytes: (value as ArrayBufferView).byteLength })
  }

  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return formatSummary('buffer', { length: value.length })
  }

  if (value instanceof Map) {
    return formatSummary('Map', { size: value.size })
  }

  if (value instanceof Set) {
    return formatSummary('Set', { size: value.size })
  }

  if (Array.isArray(value)) {
    return summarizeArray(value, seen, depth)
  }

  if (typeof (value as Promise<unknown>)?.then === 'function') {
    return '[Promise]'
  }

  if (typeof value === 'object') {
    const objectValue = value as object

    if (seen.has(objectValue)) {
      return '[circular]'
    }

    if (depth >= MAX_DEPTH) {
      return '[object depth-exceeded]'
    }

    seen.add(objectValue)
    const entries = Object.entries(objectValue as Record<string, unknown>)
    const sanitizedEntries: Record<string, unknown> = {}

    for (const [key, nestedValue] of entries) {
      sanitizedEntries[key] = sanitizeLogValue(nestedValue, seen, depth + 1)
    }

    seen.delete(objectValue)
    return sanitizedEntries
  }

  return '[unknown]'
}

export interface PrepareLogMetadataOptions {
  excludeKeys?: string[]
  preserveKeys?: string[]
}

export const prepareLogMetadata = (
  meta: unknown[],
  options?: PrepareLogMetadataOptions
): Record<string, unknown> | undefined => {
  if (!meta || meta.length === 0) {
    return undefined
  }

  const exclude = new Set(options?.excludeKeys ?? [])
  const preserve = new Set([...(options?.preserveKeys ?? []), ...RESERVED_STRING_KEYS])
  const seen = new WeakSet<object>()
  const assignKey = createUniqueKeyAssigner()
  const sanitized: Record<string, unknown> = {}

  meta.forEach((entry, index) => {
    if (isPlainObject(entry)) {
      Object.entries(entry).forEach(([key, value]) => {
        if (exclude.has(key)) {
          return
        }

        const sanitizedKey = assignKey(key)

        if (preserve.has(key) && typeof value === 'string') {
          sanitized[sanitizedKey] = value
        } else {
          sanitized[sanitizedKey] = sanitizeLogValue(value, seen)
        }
      })
      return
    }

    sanitized[assignKey(`meta_${index}`)] = sanitizeLogValue(entry, seen)
  })

  return Object.keys(sanitized).length > 0 ? sanitized : undefined
}

export const sanitizeMetadataRecord = (
  record: Record<string, unknown>
): Record<string, unknown> => {
  const seen = new WeakSet<object>()
  const sanitized: Record<string, unknown> = {}

  Object.entries(record).forEach(([key, value]) => {
    sanitized[key] = sanitizeLogValue(value, seen)
  })

  return sanitized
}

export const formatConsoleLogMessage = (
  level: LogLevel,
  message: string,
  sanitizedMeta?: Record<string, unknown>,
  category?: string
): string => {
  const levelTag = level.toUpperCase()
  const categoryPrefix = category ? `[${category}] ` : ''
  const metaSuffix =
    sanitizedMeta && Object.keys(sanitizedMeta).length > 0
      ? ` ${JSON.stringify(sanitizedMeta)}`
      : ''

  return `[${levelTag}] ${categoryPrefix}${message}${metaSuffix}`
}

export interface ConsoleLogEntry {
  level: LogLevel
  message: string
  sanitizedMeta?: Record<string, unknown>
  category?: string
  formatted: string
}

export type ConsoleWriter = (
  level: LogLevel,
  message: string,
  sanitizedMeta?: Record<string, unknown>,
  category?: string
) => void

const defaultConsoleWriter: ConsoleWriter = (
  level,
  message,
  sanitizedMeta,
  category
) => {
  const formatted = formatConsoleLogMessage(level, message, sanitizedMeta, category)

  switch (level) {
    case LOG_LEVELS.ERROR:
      console.error(formatted)
      break
    case LOG_LEVELS.WARN:
      console.warn(formatted)
      break
    case LOG_LEVELS.INFO:
      console.info(formatted)
      break
    case LOG_LEVELS.DEBUG:
      console.debug(formatted)
      break
    default:
      console.log(formatted)
  }
}

let activeConsoleWriter: ConsoleWriter = defaultConsoleWriter

export const setConsoleWriter = (writer?: ConsoleWriter): void => {
  activeConsoleWriter = writer ?? defaultConsoleWriter
}

export interface BufferedConsoleWriter {
  entries: ConsoleLogEntry[]
  write: ConsoleWriter
  clear: () => void
  snapshot: () => ConsoleLogEntry[]
}

export const createBufferedConsoleWriter = (): BufferedConsoleWriter => {
  const entries: ConsoleLogEntry[] = []

  const write: ConsoleWriter = (level, message, sanitizedMeta, category) => {
    entries.push({
      level,
      message,
      sanitizedMeta,
      category,
      formatted: formatConsoleLogMessage(level, message, sanitizedMeta, category)
    })
  }

  const clear = () => {
    entries.length = 0
  }

  const snapshot = () =>
    entries.map((entry) => ({
      ...entry,
      sanitizedMeta: entry.sanitizedMeta
        ? JSON.parse(JSON.stringify(entry.sanitizedMeta))
        : undefined
    }))

  return { entries, write, clear, snapshot }
}

export const writeConsoleLog = (
  level: LogLevel,
  message: string,
  sanitizedMeta?: Record<string, unknown>,
  category?: string
): void => {
  activeConsoleWriter(level, message, sanitizedMeta, category)
}

export type { LogLevel }
