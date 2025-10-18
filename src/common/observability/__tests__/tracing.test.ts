import { initializeTracing, shutdownTracing, getTracer } from '../tracing'

describe('tracing initialization', () => {
  afterEach(async () => {
    await shutdownTracing()
  })

  it('initializes a tracer provider with default configuration', () => {
    const provider = initializeTracing({ enabled: true })
    expect(provider).toBeDefined()
    const tracer = getTracer()
    expect(tracer).toBeDefined()
  })

  it('respects disabled flag', async () => {
    await shutdownTracing()
    const provider = initializeTracing({ enabled: false })
    expect(provider).toBeUndefined()
  })
})
