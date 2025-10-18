import type { RequestHandler } from 'express'
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client'

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS' | 'TRACE'

const registry = new Registry()

collectDefaultMetrics({
  register: registry,
  prefix: 'bedrock_engineer_'
})

const httpRequestDurationSeconds = new Histogram({
  name: 'bedrock_engineer_http_request_duration_seconds',
  help: 'Time spent handling HTTP requests',
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
  labelNames: ['method', 'route', 'status', 'outcome'],
  registers: [registry]
})

const httpRequestTotal = new Counter({
  name: 'bedrock_engineer_http_requests_total',
  help: 'Total number of HTTP requests processed by the API',
  labelNames: ['method', 'route', 'status', 'outcome'],
  registers: [registry]
})

const secretProviderFailures = new Counter({
  name: 'bedrock_engineer_secret_provider_failures_total',
  help: 'Total number of external secret provider failures',
  labelNames: ['driver', 'reason'],
  registers: [registry]
})

export interface HttpRequestMetricsPayload {
  method: string
  route: string
  statusCode: number
  durationMs: number
}

const normaliseMethod = (method: string): HttpMethod => {
  const upper = method.toUpperCase()
  if (['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'TRACE'].includes(upper)) {
    return upper as HttpMethod
  }
  return 'GET'
}

const resolveOutcome = (statusCode: number): 'success' | 'client_error' | 'server_error' => {
  if (statusCode >= 500) {
    return 'server_error'
  }
  if (statusCode >= 400) {
    return 'client_error'
  }
  return 'success'
}

export const recordHttpRequestMetrics = (payload: HttpRequestMetricsPayload): void => {
  const method = normaliseMethod(payload.method)
  const route = payload.route || 'unresolved'
  const status = String(payload.statusCode)
  const outcome = resolveOutcome(payload.statusCode)
  const durationSeconds = Math.max(payload.durationMs, 0) / 1000

  httpRequestTotal.inc({ method, route, status, outcome })
  httpRequestDurationSeconds.observe({ method, route, status, outcome }, durationSeconds)
}

export const metricsHandler: RequestHandler = async (_req, res) => {
  res.set('Content-Type', registry.contentType)
  res.set('Cache-Control', 'no-store, max-age=0')
  res.status(200).send(await registry.metrics())
}

export const resetMetricsForTests = (): void => {
  registry.resetMetrics()
}

export const getMetricsRegistry = () => registry

export const recordSecretProviderFailure = (driver: string, reason: string): void => {
  secretProviderFailures.inc({ driver, reason })
}
