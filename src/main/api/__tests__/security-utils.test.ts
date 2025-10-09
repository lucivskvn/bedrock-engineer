import {
  createSequentialTaskQueue,
  flushMicrotasks,
  hasPrototypePollution,
  isFetchMetadataRequestSafe
} from '../security-utils'

describe('hasPrototypePollution', () => {
  it('detects direct pollution keys', () => {
    expect(hasPrototypePollution({ __proto__: { polluted: true } })).toBe(true)
  })

  it('detects nested pollution keys inside arrays', () => {
    const payload = { safe: [{ constructor: { prototype: {} } }] }
    expect(hasPrototypePollution(payload)).toBe(true)
  })

  it('returns false for safe objects', () => {
    expect(hasPrototypePollution({ foo: 'bar', nested: { baz: 1 } })).toBe(false)
    expect(hasPrototypePollution(['a', 'b', { c: 'd' }])).toBe(false)
  })
})

describe('createSequentialTaskQueue', () => {
  it('runs tasks sequentially for the same key', async () => {
    const queue = createSequentialTaskQueue()
    const executionOrder: number[] = []

    const first = queue.enqueue('socket-1', async () => {
      executionOrder.push(1)
      await flushMicrotasks()
    })

    const second = queue.enqueue('socket-1', async () => {
      executionOrder.push(2)
    })

    await first
    await second

    expect(executionOrder).toEqual([1, 2])
  })

})

describe('isFetchMetadataRequestSafe', () => {
  it('allows safe metadata combinations', () => {
    expect(
      isFetchMetadataRequestSafe({
        method: 'POST',
        origin: 'https://app.local',
        secFetchSite: 'same-origin',
        secFetchMode: 'cors',
        secFetchDest: 'empty',
        allowFileProtocol: false
      }).allowed
    ).toBe(true)
  })

  it('rejects unsupported fetch modes', () => {
    const result = isFetchMetadataRequestSafe({
      method: 'POST',
      origin: 'https://app.local',
      secFetchSite: 'same-origin',
      secFetchMode: 'no-cors',
      secFetchDest: 'empty',
      allowFileProtocol: false
    })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('mode')
  })

  it('rejects unsafe destinations for null origins', () => {
    const result = isFetchMetadataRequestSafe({
      method: 'POST',
      origin: 'null',
      secFetchSite: 'none',
      secFetchMode: 'cors',
      secFetchDest: 'document',
      allowFileProtocol: true
    })
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('destination')
  })

  it('allows OPTIONS preflight requests', () => {
    expect(
      isFetchMetadataRequestSafe({
        method: 'OPTIONS',
        origin: 'null',
        secFetchSite: 'same-origin',
        secFetchMode: 'cors',
        secFetchDest: 'empty',
        allowFileProtocol: true
      }).allowed
    ).toBe(true)
  })
})
