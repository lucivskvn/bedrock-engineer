import { describe, expect, test } from '@jest/globals'
import { isLoopbackHostname, normalizeHttpOrigin, normalizeNetworkEndpoint } from '../../security/urlGuards'

describe('normalizeNetworkEndpoint', () => {
  test('normalizes https endpoints', () => {
    expect(normalizeNetworkEndpoint('https://Example.com/')).toBe('https://example.com')
  })

  test('allows loopback http when enabled', () => {
    expect(
      normalizeNetworkEndpoint('http://127.0.0.1:1234/', { allowLoopbackHttp: true })
    ).toBe('http://127.0.0.1:1234')
  })

  test('rejects loopback http when not allowed', () => {
    expect(() => normalizeNetworkEndpoint('http://127.0.0.1:1234/')).toThrow(
      'Endpoint must use HTTPS or loopback HTTP'
    )
  })

  test('rejects non-loopback http even when option enabled', () => {
    expect(() =>
      normalizeNetworkEndpoint('http://example.com', { allowLoopbackHttp: true })
    ).toThrow('Endpoint must use HTTPS or loopback HTTP')
  })

  test('rejects endpoints with credentials, path, search, or hash', () => {
    expect(() => normalizeNetworkEndpoint('https://user:pass@example.com')).toThrow(
      'Endpoint must not include embedded credentials'
    )
    expect(() => normalizeNetworkEndpoint('https://example.com/path')).toThrow(
      'Endpoint must not include path segments'
    )
    expect(() => normalizeNetworkEndpoint('https://example.com/?q=1')).toThrow(
      'Endpoint must not include search parameters'
    )
    expect(() => normalizeNetworkEndpoint('https://example.com/#hash')).toThrow(
      'Endpoint must not include hash fragments'
    )
  })
})

describe('normalizeHttpOrigin', () => {
  test('normalizes https origins', () => {
    expect(normalizeHttpOrigin('HTTPS://Example.com')).toBe('https://example.com')
  })

  test('normalizes loopback ipv6 http origins when allowed', () => {
    expect(
      normalizeHttpOrigin('http://[::1]:5173', { allowLoopbackHttp: true })
    ).toBe('http://[::1]:5173')
  })

  test('rejects unsafe origins', () => {
    expect(() => normalizeHttpOrigin('ftp://example.com')).toThrow('Endpoint must use HTTPS or loopback HTTP')
    expect(() => normalizeHttpOrigin('javascript:alert(1)')).toThrow('Endpoint must not include path segments')
  })
})

describe('isLoopbackHostname', () => {
  test('identifies loopback hostnames', () => {
    expect(isLoopbackHostname('127.0.0.1')).toBe(true)
    expect(isLoopbackHostname('::1')).toBe(true)
    expect(isLoopbackHostname('localhost')).toBe(true)
  })

  test('rejects non-loopback hostnames', () => {
    expect(isLoopbackHostname('example.com')).toBe(false)
  })
})
