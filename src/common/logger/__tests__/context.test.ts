import { randomUUID } from 'node:crypto'
import { ensureLogContext, getLogContext, normalizeCorrelationId, runWithLogContext } from '../context'

describe('logger context', () => {
  it('normalizes correlation identifiers', () => {
    expect(normalizeCorrelationId(' 1234abcd ')).toBe('1234abcd')
    expect(normalizeCorrelationId('invalid id')).toBeUndefined()
    expect(normalizeCorrelationId(123 as unknown as string)).toBeUndefined()
  })

  it('creates a new context when none exists', () => {
    const context = ensureLogContext()
    expect(context.correlationId).toHaveLength(36)
    expect(getLogContext()).toBe(context)
  })

  it('reuses existing context within AsyncLocalStorage scope', async () => {
    const expectedId = randomUUID()

    await new Promise<void>((resolve) => {
      runWithLogContext({ correlationId: expectedId }, () => {
        const active = ensureLogContext({ traceId: 'trace' })
        expect(active.correlationId).toBe(expectedId)
        expect(active.traceId).toBe('trace')
        resolve()
      })
    })
  })
})
