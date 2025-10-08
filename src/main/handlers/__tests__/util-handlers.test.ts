import {
  clampFetchTimeout,
  sanitizeRequestHeaders,
  sanitizeRequestBody,
  MAX_FETCH_BODY_BYTES
} from '../fetch-guards'

describe('clampFetchTimeout', () => {
  it('clamps numeric values within range', () => {
    expect(clampFetchTimeout(500)).toBe(1000)
    expect(clampFetchTimeout(2000)).toBe(2000)
    expect(clampFetchTimeout(60000)).toBe(15000)
  })

  it('parses string values', () => {
    expect(clampFetchTimeout('2500')).toBe(2500)
  })

  it('falls back to default for invalid inputs', () => {
    expect(clampFetchTimeout('invalid')).toBe(10000)
    expect(clampFetchTimeout(undefined)).toBe(10000)
  })
})

describe('sanitizeRequestHeaders', () => {
  it('filters out disallowed headers and keeps first value from arrays', () => {
    const sanitized = sanitizeRequestHeaders({
      Host: 'example.com',
      Accept: 'application/json',
      'X-Custom': ['value', 'ignored'],
      Connection: 'keep-alive'
    })

    expect(sanitized).toEqual({
      Accept: 'application/json',
      'X-Custom': 'value'
    })
  })
})

describe('sanitizeRequestBody', () => {
  it('accepts strings within the size limit', () => {
    expect(sanitizeRequestBody('test')).toBe('test')
  })

  it('rejects oversized payloads', () => {
    const large = 'a'.repeat(MAX_FETCH_BODY_BYTES + 1)
    expect(() => sanitizeRequestBody(large)).toThrow('Request body too large')
  })

  it('rejects unsupported types', () => {
    expect(() => sanitizeRequestBody({})).toThrow('Unsupported request body type')
  })
})
