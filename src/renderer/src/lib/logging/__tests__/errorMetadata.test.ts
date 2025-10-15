import { extractErrorMetadata, truncateForLogging } from '../errorMetadata'

describe('truncateForLogging', () => {
  it('returns undefined for empty-like values', () => {
    expect(truncateForLogging('')).toBeUndefined()
    expect(truncateForLogging(null)).toBeUndefined()
    expect(truncateForLogging(undefined)).toBeUndefined()
  })

  it('returns undefined for whitespace-only values after trimming', () => {
    expect(truncateForLogging('   ')).toBeUndefined()
    expect(truncateForLogging('\n\t')).toBeUndefined()
  })

  it('truncates long strings and appends an ellipsis', () => {
    const input = 'a'.repeat(205)
    const result = truncateForLogging(input)

    expect(result).toHaveLength(201)
    expect(result?.endsWith('…')).toBe(true)
  })
})

describe('extractErrorMetadata', () => {
  it('extracts name and truncated message from Error instances', () => {
    const error = new Error('A'.repeat(300))
    error.name = 'SampleError'

    const metadata = extractErrorMetadata(error)

    expect(metadata.errorName).toBe('SampleError')
    expect(metadata.errorMessage.length).toBeLessThanOrEqual(201)
    expect(metadata.errorMessage.endsWith('…')).toBe(true)
  })

  it('handles string errors by returning a generic name', () => {
    const metadata = extractErrorMetadata('simple failure')

    expect(metadata).toEqual({
      errorName: 'Error',
      errorMessage: 'simple failure'
    })
  })

  it('falls back to default metadata when input is unstructured', () => {
    const metadata = extractErrorMetadata(42)

    expect(metadata).toEqual({
      errorName: 'UnknownError',
      errorMessage: '42'
    })
  })

  it('captures sanitized cause metadata when present', () => {
    const error = new Error('Operation failed') as Error & { cause?: unknown }
    error.cause = {
      path: '/tmp/secret.txt',
      attempts: 3,
      nested: {
        detail: 'Sensitive information that should be truncated because it is overly verbose and possibly unsafe.'.repeat(2)
      },
      list: ['short', 'a'.repeat(400)]
    }

    const metadata = extractErrorMetadata(error)

    expect(metadata.errorCause).toEqual({
      path: '/tmp/secret.txt',
      attempts: 3,
      nested: {
        detail: expect.stringContaining('Sensitive information')
      },
      list: ['short', expect.stringContaining('aaa')]
    })
  })

  it('handles circular structures without throwing', () => {
    const circular: { name: string; self?: unknown } = { name: 'root' }
    circular.self = circular

    const error = new Error('Failed') as Error & { cause?: unknown }
    error.cause = circular

    const metadata = extractErrorMetadata(error)

    expect(metadata.errorCause).toEqual({
      name: 'root',
      self: '[Circular]'
    })
  })

  it('serializes built-in collections and special types safely', () => {
    const error = new Error('Failure') as Error & { cause?: unknown }
    error.cause = {
      set: new Set(['alpha', 'beta']),
      map: new Map<string, unknown>([
        ['first', 'value'],
        ['second', 2]
      ]),
      createdAt: new Date('2025-01-02T03:04:05.000Z'),
      count: BigInt(42),
      endpoint: new URL('https://example.com/path?secret=1'),
      pattern: /test/i,
      promise: Promise.resolve()
    }

    const metadata = extractErrorMetadata(error)

    expect(metadata.errorCause).toEqual({
      set: ['alpha', 'beta'],
      map: [
        ['first', 'value'],
        ['second', 2]
      ],
      createdAt: '2025-01-02T03:04:05.000Z',
      count: '42',
      endpoint: 'https://example.com/path?secret=1',
      pattern: '/test/i',
      promise: '[Promise]'
    })
  })

  it('limits typed array size and indicates truncation', () => {
    const error = new Error('Failure') as Error & { cause?: unknown }
    error.cause = {
      payload: new Uint8Array(Array.from({ length: 25 }, (_, index) => index))
    }

    const metadata = extractErrorMetadata(error)
    const payload = (metadata.errorCause as Record<string, unknown>).payload as unknown[]

    expect(Array.isArray(payload)).toBe(true)
    expect(payload.length).toBe(21)
    expect(payload.at(-1)).toBe('[Truncated]')
  })

  it('limits object entry traversal and appends truncation marker', () => {
    const cause: Record<string, number> = {}
    for (let index = 0; index < 30; index += 1) {
      cause[`key${index}`] = index
    }

    const error = new Error('Failure') as Error & { cause?: unknown }
    error.cause = cause

    const metadata = extractErrorMetadata(error)
    const sanitized = metadata.errorCause as Record<string, unknown>

    expect(Object.keys(sanitized).length).toBeGreaterThan(0)
    expect(sanitized.__truncated__).toBe('[Truncated 5 entries]')
  })

  it('captures nested error causes recursively without leaking loops', () => {
    const inner = new Error('Inner failure')
    inner.cause = new Error('Hidden failure')

    const outer = new Error('Outer failure')
    outer.cause = inner

    const metadata = extractErrorMetadata(outer)
    const errorCause = metadata.errorCause as Record<string, unknown>

    expect(errorCause.errorName).toBe('Error')
    expect(errorCause.errorCause).toEqual({
      errorName: 'Error',
      errorMessage: 'Hidden failure'
    })
  })

  it('marks weak collection causes with placeholders', () => {
    const error = new Error('Failure') as Error & { cause?: unknown }
    error.cause = {
      weakMap: new WeakMap(),
      weakSet: new WeakSet()
    }

    const metadata = extractErrorMetadata(error)

    expect(metadata.errorCause).toEqual({
      weakMap: '[WeakMap]',
      weakSet: '[WeakSet]'
    })
  })
})
