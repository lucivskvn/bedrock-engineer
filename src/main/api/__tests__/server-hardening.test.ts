const connectionHandlers: Array<(socket: { setTimeout: (ms: number) => void }) => void> = []

jest.mock('http', () => {
  const handlers = connectionHandlers
  const createServer = jest.fn((options: { maxHeaderSize: number }, _listener: any) => {
    const server: any = {
      maxHeadersCount: 0,
      maxRequestsPerSocket: 0,
      headersTimeout: 0,
      requestTimeout: 0,
      keepAliveTimeout: 0,
      on: jest.fn((event: string, handler: any) => {
        if (event === 'connection') {
          handlers.push(handler)
        }
        return server
      }),
      listeners: jest.fn((event: string) => (event === 'connection' ? handlers : []))
    }
    server.__options = options
    return server
  })

  return {
    __esModule: true,
    default: { createServer },
    createServer
  }
})

import http from 'http'
import { createHardenedServer } from '../server-hardening'

describe('createHardenedServer', () => {
  beforeEach(() => {
    connectionHandlers.length = 0
    ;(http.createServer as jest.Mock).mockClear()
  })

  it('configures header limits and connection handlers', () => {
    const createServer = http.createServer as jest.Mock

    const server = createHardenedServer((_: unknown, res: { statusCode: number; end: () => void }) => {
      res.statusCode = 204
      res.end()
    }, {
      maxHeaderBytes: 8 * 1024,
      maxHeadersCount: 200,
      maxRequestsPerSocket: 120,
      headersTimeoutMs: 10_000,
      requestTimeoutMs: 15_000,
      keepAliveTimeoutMs: 60_000,
      idleSocketTimeoutMs: 12_500
    }) as any

    expect(createServer).toHaveBeenCalledWith({ maxHeaderSize: 8 * 1024 }, expect.any(Function))
    expect(server.maxHeadersCount).toBe(200)
    expect(server.maxRequestsPerSocket).toBe(120)
    expect(server.headersTimeout).toBe(10_000)
    expect(server.requestTimeout).toBe(15_000)
    expect(server.keepAliveTimeout).toBe(60_000)

    const [connectionListener] = connectionHandlers
    expect(connectionListener).toBeDefined()

    const mockSocket = { setTimeout: jest.fn() }
    connectionListener!(mockSocket)
    expect(mockSocket.setTimeout).toHaveBeenCalledWith(12_500)
  })
})
