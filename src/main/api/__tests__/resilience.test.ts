import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals'
import { CircuitBreakerOpenError, createCircuitBreaker, executeWithRetry } from '../resilience'

describe('executeWithRetry', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.clearAllMocks()
  })

  test('retries the operation after a transient failure and logs the retry attempt', async () => {
    const operation = jest.fn<() => Promise<string>>()
    operation.mockRejectedValueOnce(new Error('transient'))
    operation.mockResolvedValueOnce('success')

    const logger = {
      warn: jest.fn(),
      debug: jest.fn()
    }

    const resultPromise = executeWithRetry(operation, {
      maxAttempts: 3,
      initialDelayMs: 25,
      maxDelayMs: 200,
      jitterFactor: 0,
      logger,
      operationName: 'test-operation'
    })

    await jest.advanceTimersByTimeAsync(25)

    await expect(resultPromise).resolves.toBe('success')
    expect(operation).toHaveBeenCalledTimes(2)
    expect(logger.warn).toHaveBeenCalledWith('Retrying external operation after transient failure', {
      attempt: 1,
      delayMs: 25,
      error: expect.any(Object),
      maxAttempts: 3,
      operationName: 'test-operation'
    })
  })

  test('throws the underlying error after exhausting retry attempts', async () => {
    const operation = jest.fn<() => Promise<never>>()
    operation.mockRejectedValue(new Error('permanent failure'))

    const resultPromise = executeWithRetry(operation, {
      maxAttempts: 2,
      initialDelayMs: 20,
      maxDelayMs: 20,
      jitterFactor: 0
    })

    await jest.advanceTimersByTimeAsync(20)

    await expect(resultPromise).rejects.toThrow('permanent failure')
    expect(operation).toHaveBeenCalledTimes(2)
  })
})

describe('createCircuitBreaker', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  test('opens after consecutive failures and recovers after the cooldown window', async () => {
    const logger = {
      warn: jest.fn(),
      info: jest.fn()
    }

    let currentTime = 0
    const clock = () => currentTime

    const breaker = createCircuitBreaker({
      failureThreshold: 2,
      cooldownMs: 1_000,
      clock,
      logger,
      name: 'test-breaker'
    })

    const failure = new Error('remote failure')

    await expect(
      breaker.execute(async () => {
        throw failure
      })
    ).rejects.toThrow(failure)

    await expect(
      breaker.execute(async () => {
        throw failure
      })
    ).rejects.toThrow(failure)

    expect(logger.warn).toHaveBeenCalledWith('Circuit breaker opened', {
      breakerName: 'test-breaker',
      error: expect.any(Object),
      failureCount: 2,
      retryAt: 1_000,
      state: 'open'
    })

    await expect(
      breaker.execute(async () => 'should-not-run')
    ).rejects.toBeInstanceOf(CircuitBreakerOpenError)

    currentTime = 1_100

    await expect(
      breaker.execute(async () => 'recovered-value')
    ).resolves.toBe('recovered-value')

    expect(breaker.getState()).toEqual({
      state: 'closed',
      failureCount: 0,
      nextAttemptAt: 1_000
    })
  })

  test('returns to the open state when a half-open probe fails', async () => {
    const logger = {
      warn: jest.fn(),
      info: jest.fn()
    }

    let currentTime = 0
    const clock = () => currentTime

    const breaker = createCircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 500,
      clock,
      logger,
      name: 'half-open-breaker'
    })

    await expect(breaker.execute(async () => {
      throw new Error('initial failure')
    })).rejects.toThrow('initial failure')

    currentTime = 600

    await expect(
      breaker.execute(async () => {
        throw new Error('half-open failure')
      })
    ).rejects.toThrow('half-open failure')

    const snapshot = breaker.getState()
    expect(snapshot.state).toBe('open')
    expect(snapshot.nextAttemptAt).toBe(1_100)
    expect(logger.warn).toHaveBeenLastCalledWith(
      'Circuit breaker opened',
      expect.objectContaining({
        breakerName: 'half-open-breaker',
        error: expect.any(Object),
        failureCount: 2,
        retryAt: 1_100,
        state: 'open'
      })
    )
  })
})
