import http, { type RequestListener, type Server } from 'http'

/**
 * Options that control low-level HTTP server resource limits. These values are
 * derived from environment variables and validated before reaching this module
 * so the server always starts with safe defaults.
 */
export interface ServerHardeningOptions {
  maxHeaderBytes: number
  maxHeadersCount: number
  maxRequestsPerSocket: number
  headersTimeoutMs: number
  requestTimeoutMs: number
  keepAliveTimeoutMs: number
  idleSocketTimeoutMs: number
}

/**
 * Creates a Node.js HTTP server pre-configured with defensive socket limits to
 * reduce the blast radius of slow-loris style attacks and misbehaving clients.
 */
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
