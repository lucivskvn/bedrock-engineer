import { afterEach, beforeEach, describe, expect, test } from '@jest/globals'
import { getTrustedApiEndpoint, resolveTrustedApiEndpoint } from '../apiEndpoint'

describe('resolveTrustedApiEndpoint', () => {
  test('returns canonical https endpoint', () => {
    expect(resolveTrustedApiEndpoint('https://Example.com/')).toBe('https://example.com')
  })

  test('allows loopback http endpoints', () => {
    expect(resolveTrustedApiEndpoint('http://127.0.0.1:3000/')).toBe('http://127.0.0.1:3000')
    expect(resolveTrustedApiEndpoint('http://[::1]:4555')).toBe('http://[::1]:4555')
  })

  test('rejects unsafe endpoints', () => {
    expect(() => resolveTrustedApiEndpoint('http://evil.example.com')).toThrow('Endpoint must use HTTPS or loopback HTTP')
    expect(() => resolveTrustedApiEndpoint('javascript:alert(1)')).toThrow('Endpoint must not include path segments')
  })
})

describe('getTrustedApiEndpoint', () => {
  const originalWindow = (global as any).window

  beforeEach(() => {
    ;(global as any).window = { store: { get: jest.fn() } }
  })

  afterEach(() => {
    ;(global as any).window = originalWindow
  })

  test('normalises endpoint from window store', () => {
    ;(global as any).window.store.get = jest.fn().mockReturnValue('HTTPS://Example.com/')
    expect(getTrustedApiEndpoint()).toBe('https://example.com')
  })

  test('throws when endpoint is missing', () => {
    ;(global as any).window.store.get = jest.fn().mockReturnValue(undefined)
    expect(() => getTrustedApiEndpoint()).toThrow('API endpoint is not configured')
  })

  test('throws when endpoint is unsafe', () => {
    ;(global as any).window.store.get = jest.fn().mockReturnValue('http://evil.example.com')
    expect(() => getTrustedApiEndpoint()).toThrow('Endpoint must use HTTPS or loopback HTTP')
  })
})
