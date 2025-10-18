import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

export interface LogContext {
  correlationId: string
  traceId?: string
  spanId?: string
  attributes?: Record<string, unknown>
}

const CORRELATION_ID_PATTERN = /^[A-Za-z0-9_.-]{8,128}$/

const storage = new AsyncLocalStorage<LogContext>()

export const getLogContext = (): LogContext | undefined => {
  return storage.getStore()
}

export const runWithLogContext = <T>(context: LogContext, callback: () => T): T => {
  return storage.run(context, callback)
}

export const ensureLogContext = (partial?: Partial<LogContext>): LogContext => {
  const existing = storage.getStore()
  if (existing) {
    if (partial) {
      Object.assign(existing, partial)
    }
    return existing
  }

  const correlationId = normalizeCorrelationId(partial?.correlationId) ?? randomUUID()
  const context: LogContext = { correlationId }

  if (partial) {
    Object.assign(context, partial)
  }

  storage.enterWith(context)
  return context
}

export const normalizeCorrelationId = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()
  if (!CORRELATION_ID_PATTERN.test(trimmed)) {
    return undefined
  }

  return trimmed
}

export const bindLogContext = (partial: Partial<LogContext>): LogContext => {
  const existing = storage.getStore()
  if (existing) {
    Object.assign(existing, partial)
    return existing
  }

  const correlationId = normalizeCorrelationId(partial.correlationId) ?? randomUUID()
  const context: LogContext = { correlationId, ...partial }
  storage.enterWith(context)
  return context
}
