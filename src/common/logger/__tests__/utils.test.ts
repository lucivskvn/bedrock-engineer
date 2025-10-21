import {
  prepareLogMetadata,
  sanitizeMetadataRecord,
  formatConsoleLogMessage,
  createBufferedConsoleWriter,
  setConsoleWriter,
  writeConsoleLog
} from '../utils'

describe('logger utils metadata sanitisation', () => {
  it('redacts primitive values while retaining structural hints', () => {
    const meta = prepareLogMetadata(['hello world', 42, false])

    expect(meta).toEqual({
      meta_0: '[string length=11]',
      meta_1: '[number]',
      meta_2: '[boolean]'
    })
  })

  it('preserves registered placeholder strings', () => {
    const meta = prepareLogMetadata(['[USER_ID]'])

    expect(meta).toEqual({
      meta_0: '[USER_ID]'
    })
  })

  it('summarises arrays with previews and truncation counts', () => {
    const meta = prepareLogMetadata([
      ['alpha', 'beta', 'gamma', 'delta']
    ])

    expect(meta).toEqual({
      meta_0: {
        type: 'array',
        length: 4,
        preview: ['[string length=5]', '[string length=4]', '[string length=5]'],
        truncated: 1
      }
    })
  })

  it('sanitises nested records while retaining preserved keys', () => {
    const meta = prepareLogMetadata([
      {
        category: 'strands-converter',
        error: new Error('fail'),
        details: { code: 'E_FAIL', count: 12 }
      }
    ])

    expect(meta).toBeDefined()
    expect(meta?.category).toBe('strands-converter')
    expect(meta?.details).toEqual({ code: '[string length=6]', count: '[number]' })

    const error = meta?.error as Record<string, unknown>
    expect(error).toMatchObject({ type: 'Error', name: 'Error' })
    expect(error.message).toBe('[string length=4]')
    expect(typeof error.stack).toBe('string')
    expect((error.stack as string).startsWith('[stack')).toBe(true)
  })

  it('sanitises standalone metadata records consistently', () => {
    const sanitized = sanitizeMetadataRecord({
      request: { method: 'GET', retries: 3 },
      tags: new Set(['a', 'b'])
    })

    expect(sanitized.request).toEqual({ method: '[string length=3]', retries: '[number]' })
    expect(sanitized.tags).toBe('[Set size=2]')
  })

  it('formats console log messages with compact JSON payloads', () => {
    const payload = {
      category: 'scheduler',
      detail: '[string length=6]'
    }
    const formatted = formatConsoleLogMessage({
      level: 'error',
      message: 'Operation failed',
      payload
    })

    expect(() => JSON.parse(formatted)).not.toThrow()
    const parsed = JSON.parse(formatted)
    expect(parsed).toMatchObject({
      level: 'error',
      message: 'Operation failed',
      category: 'scheduler',
      detail: '[string length=6]'
    })
  })

  it('supports swapping the console writer for buffered assertions', () => {
    const buffer = createBufferedConsoleWriter()
    setConsoleWriter(buffer.write)

    try {
      writeConsoleLog('warn', 'Action skipped', {
        reason: '[string length=4]',
        category: 'tests'
      })

      expect(buffer.entries).toHaveLength(1)
      expect(buffer.entries[0]).toMatchObject({
        level: 'warn',
        message: 'Action skipped'
      })
      expect(buffer.entries[0].payload).toEqual({
        reason: '[string length=4]',
        category: 'tests'
      })

      buffer.clear()
      expect(buffer.entries).toHaveLength(0)

      const snapshot = buffer.snapshot()
      expect(snapshot).toEqual([])
    } finally {
      setConsoleWriter()
    }
  })
})
