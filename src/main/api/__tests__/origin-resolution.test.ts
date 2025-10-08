import { describe, expect, it, jest } from '@jest/globals'
import { resolveAllowedOrigins } from '../origin-allowlist'

const createLogger = () => ({
  warn: jest.fn()
})

describe('resolveAllowedOrigins', () => {
  it('includes renderer URL when provided and valid', () => {
    const env = {
      NODE_ENV: 'production',
      ELECTRON_RENDERER_URL: 'https://app.example.com'
    } as NodeJS.ProcessEnv

    const logger = createLogger()
    const origins = resolveAllowedOrigins({
      allowLoopbackHttp: false,
      isDevelopment: true,
      env,
      log: logger
    })

    expect(origins).toContain('https://app.example.com')
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('filters out invalid renderer URLs', () => {
    const env = {
      NODE_ENV: 'production',
      ELECTRON_RENDERER_URL: 'http://malicious.test'
    } as NodeJS.ProcessEnv

    const logger = createLogger()
    const origins = resolveAllowedOrigins({
      allowLoopbackHttp: false,
      isDevelopment: true,
      env,
      log: logger
    })

    expect(origins).not.toContain('http://malicious.test')
    expect(logger.warn).toHaveBeenCalledWith(
      'Ignoring invalid ELECTRON_RENDERER_URL for allowed origins',
      { rendererUrl: 'http://malicious.test' }
    )
  })

  it('honours ALLOWED_ORIGINS configuration', () => {
    const env = {
      NODE_ENV: 'production',
      ALLOWED_ORIGINS: 'https://example.com, https://another.test'
    } as NodeJS.ProcessEnv

    const logger = createLogger()
    const origins = resolveAllowedOrigins({
      allowLoopbackHttp: false,
      isDevelopment: false,
      env,
      log: logger
    })

    expect(origins).toEqual(
      expect.arrayContaining(['https://example.com', 'https://another.test'])
    )
    expect(logger.warn).not.toHaveBeenCalled()
  })
})
