import http, { type RequestListener, type Server } from 'http'

export interface ServerHardeningOptions {
  maxHeaderBytes: number
  maxHeadersCount: number
  maxRequestsPerSocket: number
  headersTimeoutMs: number
  requestTimeoutMs: number
  keepAliveTimeoutMs: number
  idleSocketTimeoutMs: number
}

export function createHardenedServer(
  listener: RequestListener,
  options: ServerHardeningOptions
): Server {
  const server = http.createServer({ maxHeaderSize: options.maxHeaderBytes }, listener)

  server.maxHeadersCount = options.maxHeadersCount
  server.maxRequestsPerSocket = options.maxRequestsPerSocket
  server.headersTimeout = options.headersTimeoutMs
  server.requestTimeout = options.requestTimeoutMs
  server.keepAliveTimeout = options.keepAliveTimeoutMs

  server.on('connection', (socket) => {
    socket.setTimeout(options.idleSocketTimeoutMs)
  })

  return server
}
