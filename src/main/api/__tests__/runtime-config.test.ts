import { parsePositiveIntegerEnv, resolveRuntimeConfig } from '../config/runtime-config'

describe('runtime configuration', () => {
  const createLoggerStub = () => {
    return {
      warn: jest.fn()
    }
  }

  it('uses defensive defaults when overrides are not provided', () => {
    const logger = createLoggerStub()
    const config = resolveRuntimeConfig({ env: {} as NodeJS.ProcessEnv, logger })

    expect(config).toEqual({
      rateLimitWindowMs: 15 * 60 * 1000,
      rateLimitMax: 100,
      maxRequestsPerSocket: 100,
      socketMaxHttpBufferSize: 1024 * 1024,
      socketPingTimeout: 20_000,
      socketPingInterval: 25_000,
      audioRateLimitWindowSeconds: 60,
      audioRateLimitPoints: 120,
      maxHeaderBytes: 8 * 1024,
      maxHeadersCount: 200,
      maxAudioPayloadBytes: 1024 * 1024,
      externalCallMaxRetries: 3,
      externalCallBaseDelayMs: 200,
      externalCallMaxDelayMs: 2_000,
      circuitBreakerFailureThreshold: 5,
      circuitBreakerCooldownMs: 30_000,
      circuitBreakerHalfOpenMaxCalls: 1
    })

    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('logs a warning and falls back when the override is invalid', () => {
    const logger = createLoggerStub()
    const value = parsePositiveIntegerEnv({
      env: { RATE_LIMIT_MAX: 'not-a-number' } as NodeJS.ProcessEnv,
      logger,
      key: 'RATE_LIMIT_MAX',
      fallback: 100
    })

    expect(value).toBe(100)
    expect(logger.warn).toHaveBeenCalledWith('Ignoring invalid numeric environment override', {
      envKey: 'RATE_LIMIT_MAX',
      rawValue: 'not-a-number'
    })
  })

  it('clamps values below the minimum bound', () => {
    const logger = createLoggerStub()
    const value = parsePositiveIntegerEnv({
      env: { RATE_LIMIT_MAX: '5' } as NodeJS.ProcessEnv,
      logger,
      key: 'RATE_LIMIT_MAX',
      fallback: 100,
      clamp: { min: 10 }
    })

    expect(value).toBe(10)
    expect(logger.warn).toHaveBeenCalledWith('Clamping numeric environment override below minimum', {
      envKey: 'RATE_LIMIT_MAX',
      rawValue: 5,
      min: 10
    })
  })

  it('clamps values above the maximum bound', () => {
    const logger = createLoggerStub()
    const value = parsePositiveIntegerEnv({
      env: { RATE_LIMIT_MAX: '9999' } as NodeJS.ProcessEnv,
      logger,
      key: 'RATE_LIMIT_MAX',
      fallback: 100,
      clamp: { max: 1000 }
    })

    expect(value).toBe(1000)
    expect(logger.warn).toHaveBeenCalledWith('Clamping numeric environment override above maximum', {
      envKey: 'RATE_LIMIT_MAX',
      rawValue: 9999,
      max: 1000
    })
  })
})
