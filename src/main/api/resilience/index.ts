import { setTimeout as delay } from 'node:timers/promises'
import type { CategoryLogger } from '../../../common/logger'
import { describeError } from '../api-error-response'

export interface RetryPolicyOptions {
  maxAttempts: number
  initialDelayMs: number
  maxDelayMs: number
  jitterFactor?: number
  logger?: Pick<CategoryLogger, 'warn' | 'debug'>
  operationName?: string
}

export async function executeWithRetry<T>(
  operation: () => Promise<T>,
  {
    maxAttempts,
    initialDelayMs,
    maxDelayMs,
    jitterFactor = 0.2,
    logger,
    operationName
  }: RetryPolicyOptions
): Promise<T> {
  let attempt = 0
  let delayMs = Math.max(0, initialDelayMs)

  while (attempt < maxAttempts) {
    try {
      return await operation()
    } catch (error) {
      attempt += 1
      if (attempt >= maxAttempts) {
        throw error
      }

      const jitter = delayMs * jitterFactor * Math.random()
      const sleepFor = Math.min(delayMs + jitter, maxDelayMs)

      if (logger) {
        logger.warn('Retrying external operation after transient failure', {
          attempt,
          maxAttempts,
          delayMs: Math.round(sleepFor),
          operationName,
          error: describeError(error)
        })
      }

      await delay(Math.round(sleepFor))
      delayMs = Math.min(delayMs * 2, maxDelayMs)
    }
  }

  throw new Error('Retry policy exhausted without executing operation')
}

type CircuitBreakerState = 'closed' | 'open' | 'half-open'

export class CircuitBreakerOpenError extends Error {
  public readonly retryAt: number
  public readonly breakerName?: string

  constructor(message: string, options: { retryAt: number; breakerName?: string }) {
    super(message)
    this.name = 'CircuitBreakerOpenError'
    this.retryAt = options.retryAt
    this.breakerName = options.breakerName
  }
}

export interface CircuitBreakerOptions {
  failureThreshold: number
  cooldownMs: number
  halfOpenMaxCalls?: number
  halfOpenSuccessThreshold?: number
  clock?: () => number
  logger?: Pick<CategoryLogger, 'warn' | 'info'>
  name?: string
}

interface CircuitBreakerStateSnapshot {
  state: CircuitBreakerState
  failureCount: number
  nextAttemptAt: number
}

export interface CircuitBreaker {
  execute<T>(operation: () => Promise<T>): Promise<T>
  getState(): CircuitBreakerStateSnapshot
}

export function createCircuitBreaker({
  failureThreshold,
  cooldownMs,
  halfOpenMaxCalls = 1,
  halfOpenSuccessThreshold = 1,
  clock = () => Date.now(),
  logger,
  name
}: CircuitBreakerOptions): CircuitBreaker {
  let state: CircuitBreakerState = 'closed'
  let failureCount = 0
  let successCount = 0
  let nextAttemptAt = 0
  let halfOpenCalls = 0

  const updateState = (nextState: CircuitBreakerState, metadata?: Record<string, unknown>) => {
    state = nextState
    if (logger) {
      const payload: Record<string, unknown> = {
        breakerName: name,
        state: nextState
      }
      if (metadata) {
        Object.assign(payload, metadata)
      }
      if (nextState === 'open') {
        logger.warn('Circuit breaker opened', payload)
      } else {
        logger.info?.('Circuit breaker state changed', payload)
      }
    }
  }

  const getSnapshot = (): CircuitBreakerStateSnapshot => ({
    state,
    failureCount,
    nextAttemptAt
  })

  const execute = async <T>(operation: () => Promise<T>): Promise<T> => {
    const now = clock()

    if (state === 'open') {
      if (now < nextAttemptAt) {
        throw new CircuitBreakerOpenError('Circuit breaker is open', {
          retryAt: nextAttemptAt,
          breakerName: name
        })
      }

      state = 'half-open'
      halfOpenCalls = 0
      successCount = 0
    }

    if (state === 'half-open') {
      if (halfOpenCalls >= halfOpenMaxCalls) {
        throw new CircuitBreakerOpenError('Circuit breaker half-open trial limit reached', {
          retryAt: nextAttemptAt,
          breakerName: name
        })
      }
      halfOpenCalls += 1
    }

    try {
      const result = await operation()
      failureCount = 0

      if (state === 'half-open') {
        successCount += 1
        if (successCount >= halfOpenSuccessThreshold) {
          updateState('closed', { reason: 'success_threshold_met' })
          successCount = 0
          halfOpenCalls = 0
        }
      }

      return result
    } catch (error) {
      failureCount += 1
      if (state === 'half-open' || failureCount >= failureThreshold) {
        state = 'open'
        nextAttemptAt = now + cooldownMs
        updateState('open', {
          failureCount,
          retryAt: nextAttemptAt,
          error: describeError(error)
        })
      }
      throw error
    }
  }

  return { execute, getState: getSnapshot }
}
