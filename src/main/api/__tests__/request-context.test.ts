import { EventEmitter } from 'node:events'
import { createRequestContextMiddleware } from '../middleware/request-context'
import { getLogContext } from '../../../common/logger/context'
import { resetMetricsForTests } from '../observability/metrics'

class MockResponse extends EventEmitter {
  public headers: Record<string, string> = {}
  public statusCode = 200

  setHeader(key: string, value: string): void {
    this.headers[key.toLowerCase()] = value
  }
}

describe('request context middleware', () => {
  beforeEach(() => {
    resetMetricsForTests()
  })

  it('assigns correlation identifiers and records metrics', () => {
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      verbose: jest.fn()
    }

    const middleware = createRequestContextMiddleware({ logger })

    const req: any = {
      method: 'GET',
      headers: {},
      path: '/healthz',
      originalUrl: '/healthz',
      baseUrl: '',
      route: { path: '/healthz' },
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' }
    }

    const res = new MockResponse()

    let contextDuringNext
    const next = jest.fn(() => {
      contextDuringNext = getLogContext()
    })

    middleware(req, res as any, next)

    expect(next).toHaveBeenCalled()
    expect(contextDuringNext?.correlationId).toBeDefined()

    const header = res.headers['x-request-id']
    expect(header).toMatch(/^[a-f0-9-]{36}$/)

    res.emit('finish')

    expect(logger.info).toHaveBeenCalledWith('Handled HTTP request', expect.any(Object))
  })
})
