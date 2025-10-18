import type { Request, RequestHandler, Response } from 'express'
import { randomUUID } from 'node:crypto'
import { context, propagation, Span, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api'
import { CategoryLogger } from '../../../common/logger'
import { ensureLogContext, normalizeCorrelationId } from '../../../common/logger/context'
import { getTracer } from '../../../common/observability/tracing'
import { recordHttpRequestMetrics } from '../observability/metrics'

const CORRELATION_HEADER = 'x-request-id'

const readHeaderValue = (value: string | string[] | undefined): string | undefined => {
  if (!value) {
    return undefined
  }

  if (Array.isArray(value)) {
    const [first] = value
    return typeof first === 'string' ? first.trim() : undefined
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }

  return undefined
}

const resolveRouteName = (req: Request, res: Response): string => {
  const path = req.route?.path as string | string[] | undefined
  const baseUrl = req.baseUrl ?? ''

  if (typeof path === 'string' && path.length > 0) {
    return `${baseUrl}${path}`
  }

  if (Array.isArray(path) && path.length > 0) {
    return `${baseUrl}${path[0]}`
  }

  const stored = res.locals?.routePath
  if (typeof stored === 'string' && stored.length > 0) {
    return stored
  }

  const originalUrl = req.originalUrl || req.url || req.path
  const withoutQuery = originalUrl.split('?')[0]
  return withoutQuery.length > 0 ? withoutQuery : req.path
}

const finaliseSpan = (
  req: Request,
  res: Response,
  span: Span,
  startedAt: bigint,
  logger: CategoryLogger
) => {
  const durationNs = process.hrtime.bigint() - startedAt
  const durationMs = Number(durationNs) / 1_000_000
  const route = resolveRouteName(req, res)
  const statusCode = res.statusCode || 0

  recordHttpRequestMetrics({
    method: req.method,
    route,
    statusCode,
    durationMs
  })

  const otelSpan = trace.getSpan(context.active())
  const activeSpan = otelSpan ?? span

  activeSpan.setAttributes({
    'http.request.method': req.method,
    'http.response.status_code': statusCode,
    'http.route': route,
    'http.target': req.originalUrl || req.url,
    'http.client_ip': req.ip || req.socket.remoteAddress || 'unknown'
  })

  if (statusCode >= 500) {
    activeSpan.setStatus({ code: SpanStatusCode.ERROR })
  } else {
    activeSpan.setStatus({ code: SpanStatusCode.OK })
  }

  activeSpan.end()

  logger.info('Handled HTTP request', {
    method: req.method,
    route,
    path: req.path,
    statusCode: String(statusCode),
    durationMs: `${durationMs.toFixed(2)}ms`
  })
}

export interface RequestContextMiddlewareOptions {
  logger: CategoryLogger
}

export const createRequestContextMiddleware = ({
  logger
}: RequestContextMiddlewareOptions): RequestHandler => {
  return (req, res, next) => {
    const providedCorrelation = readHeaderValue(req.headers[CORRELATION_HEADER])
    const correlationId = normalizeCorrelationId(providedCorrelation) ?? randomUUID()

    res.setHeader(CORRELATION_HEADER, correlationId)

    const propagationContext = propagation.extract(context.active(), req.headers as Record<string, string>)

    const tracer = getTracer()
    const span = tracer.startSpan('http.request', {
      kind: SpanKind.SERVER,
      attributes: {
        'http.request.method': req.method,
        'http.target': req.originalUrl || req.url
      }
    }, propagationContext)

    const spanContext = trace.setSpan(propagationContext, span)
    const start = process.hrtime.bigint()
    let completed = false

    const finalizeOnce = () => {
      if (completed) {
        return
      }
      completed = true
      context.with(spanContext, () => finaliseSpan(req, res, span, start, logger))
    }

    res.once('finish', finalizeOnce)
    res.once('close', finalizeOnce)

    context.with(spanContext, () => {
      ensureLogContext({
        correlationId,
        traceId: span.spanContext().traceId,
        spanId: span.spanContext().spanId,
        attributes: {
          httpMethod: req.method,
          url: req.originalUrl || req.url
        }
      })
      next()
    })
  }
}
