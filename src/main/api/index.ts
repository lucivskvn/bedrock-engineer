import express, { Request, Response, ErrorRequestHandler } from 'express'
import cors, { CorsOptionsDelegate } from 'cors'
import compression from 'compression'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { RequestHandler, NextFunction } from 'express'
import { createNovaSonicClient } from './bedrock/client'
import { store, storeReady } from '../../preload/store'
import { getBedrockService } from './bedrock-service-registry'
import { createCategoryLogger } from '../../common/logger'
import { DEFAULT_NOVA_SONIC_REGION } from '../../common/sonic/regions'
import { Server } from 'socket.io'
import { SonicToolExecutor } from './sonic/tool-executor'
import { checkNovaSonicRegionSupport, testBedrockConnectivity } from './sonic/regionCheck'
import { RateLimiterMemory } from 'rate-limiter-flexible'
import {
  hasPrototypePollution,
  createSequentialTaskQueue,
  isFetchMetadataRequestSafe
} from './security-utils'
import { resolveTrustProxySetting } from './server-config'
import {
  validateConversePayload,
  ValidatedConversePayload,
  validateRetrieveAndGeneratePayload,
  ValidatedRetrieveAndGeneratePayload,
  validateRegionParam
} from './validation'
import { isOriginAllowed } from './cors-utils'
import { buildHealthReport } from './health/report'
import { hasConfiguredApiTokens, verifyApiToken } from './auth/api-token'
import { resolveProvidedToken } from './auth/token-utils'
import { API_PERMISSIONS, createPermissionMiddleware, ensurePermission } from './auth/rbac'
import { OVERALL_HEALTH_STATUS } from '../../common/health'
import { resolveAllowedOrigins as computeAllowedOrigins } from './origin-allowlist'
import {
  normalizeIpAddress,
  extractFirstIpFromForwardedHeader,
  createSocketProxyEvaluator
} from './network-utils'
import { createHardenedServer } from './server-hardening'
import { toCallConverseApiProps, toRetrieveAndGenerateInput } from './payload-normalizers'
import { describeError, sendApiErrorResponse, createApiError } from './api-error-response'
import { resolveRuntimeConfig } from './config/runtime-config'
import { createRequestContextMiddleware } from './middleware/request-context'
import { metricsHandler } from './observability/metrics'
import { buildReadinessReport } from './health/readiness'
import { initializeTracing } from '../../common/observability/tracing'
import { createCircuitBreaker, CircuitBreakerOpenError, executeWithRetry } from './resilience'

initializeTracing()

// Create category logger for API
const apiLogger = createCategoryLogger('api:express')
const bedrockLogger = createCategoryLogger('api:bedrock')

const {
  rateLimitWindowMs,
  rateLimitMax,
  maxRequestsPerSocket,
  socketMaxHttpBufferSize,
  socketPingTimeout,
  socketPingInterval,
  audioRateLimitWindowSeconds,
  audioRateLimitPoints,
  maxHeaderBytes,
  maxHeadersCount,
  maxAudioPayloadBytes,
  externalCallMaxRetries,
  externalCallBaseDelayMs,
  externalCallMaxDelayMs,
  circuitBreakerFailureThreshold,
  circuitBreakerCooldownMs,
  circuitBreakerHalfOpenMaxCalls
} = resolveRuntimeConfig({ env: process.env, logger: apiLogger })

interface PromiseRequestHandler {
  (req: Request, res: Response, next: NextFunction): Promise<unknown>
}

function wrap(fn: PromiseRequestHandler): RequestHandler {
  return (req, res, next) => fn(req, res, next).catch(next)
}

const createBedrockCircuitBreaker = (name: string) =>
  createCircuitBreaker({
    failureThreshold: circuitBreakerFailureThreshold,
    cooldownMs: circuitBreakerCooldownMs,
    halfOpenMaxCalls: circuitBreakerHalfOpenMaxCalls,
    logger: bedrockLogger,
    name
  })

const bedrockListModelsBreaker = createBedrockCircuitBreaker('bedrock:listModels')
const bedrockDiagnosticsBreaker = createBedrockCircuitBreaker('bedrock:diagnostics')

function resolveRequestClientIp(req: Request): string {
  const normalized = normalizeIpAddress(req.ip) ?? normalizeIpAddress(req.socket.remoteAddress)
  return normalized ?? 'unknown'
}

function resolveAudioProcessingReason(error: unknown): string {
  if (!(error instanceof Error) || typeof error.message !== 'string') {
    return 'unknown'
  }

  switch (error.message) {
    case 'Invalid base64 audio payload':
      return 'invalid_base64'
    case 'Unsupported audio payload type':
      return 'unsupported_payload'
    case 'Empty audio payload':
      return 'empty_payload'
    case 'Audio payload too large':
      return 'payload_too_large'
    default:
      return 'stream_audio_failed'
  }
}

// Error handling middleware
const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const referenceId = sendApiErrorResponse(res, 'internal_server_error')

  apiLogger.error('Express error', {
    referenceId,
    path: req.path,
    method: req.method,
    error: describeError(err)
  })
}

// アプリケーションで動作するようにdotenvを設定する
const api = express()
api.disable('x-powered-by')
api.set('etag', false)
api.set('query parser', 'simple')

const trustProxySetting = resolveTrustProxySetting(process.env)
api.set('trust proxy', trustProxySetting.value)
if (trustProxySetting.enabled) {
  apiLogger.info('Express trust proxy enabled', { trustProxyValue: trustProxySetting.value })
}

api.use(createRequestContextMiddleware({ logger: apiLogger }))

const rateLimitExceededHandler: RequestHandler = (_req, res) => {
  const retryAfterSeconds = Math.ceil(rateLimitWindowMs / 1000)
  res.setHeader('Retry-After', retryAfterSeconds.toString())
  sendApiErrorResponse(res, 'rate_limit_exceeded', {
    status: 429,
    metadata: { retryAfterSeconds }
  })
}

const socketProxyEvaluator = createSocketProxyEvaluator(
  process.env.TRUST_PROXY_FOR_SOCKETS,
  trustProxySetting,
  apiLogger
)

const sequentialAudioQueue = createSequentialTaskQueue()

const server = createHardenedServer(api, {
  maxHeaderBytes,
  maxHeadersCount,
  maxRequestsPerSocket,
  headersTimeoutMs: 10_000,
  requestTimeoutMs: 15_000,
  keepAliveTimeoutMs: 60_000,
  idleSocketTimeoutMs: 15_000
})
server.on('clientError', (err, socket) => {
  apiLogger.warn('Terminating connection after client error', {
    error: err instanceof Error ? err.message : String(err)
  })
  socket.end('HTTP/1.1 400 Bad Request\r\n\r\n')
})

const isDevelopment = process.env.NODE_ENV === 'development' || !!process.env.ELECTRON_RENDERER_URL

const allowHttpLocalhost = isDevelopment || process.env.ALLOW_HTTP_ORIGINS === 'true'

const allowedOrigins = computeAllowedOrigins({
  allowLoopbackHttp: allowHttpLocalhost,
  isDevelopment,
  env: process.env,
  log: apiLogger
})

const allowFileProtocol = !isDevelopment

const corsOptionsDelegate: CorsOptionsDelegate<Request> = (req, callback) => {
  const originHeader = req.header('Origin')
  if (isOriginAllowed(originHeader, allowedOrigins, allowFileProtocol, req.headers)) {
    callback(null, {
      origin: true,
      credentials: true,
      methods: ['GET', 'POST', 'OPTIONS']
    })
    return
  }

  callback(new Error('Origin not allowed by CORS policy'))
}

api.use(
  rateLimit({
    windowMs: rateLimitWindowMs,
    max: rateLimitMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => resolveRequestClientIp(req as Request),
    handler: rateLimitExceededHandler
  })
)

const io = new Server(server, {
  allowEIO3: false,
  maxHttpBufferSize: socketMaxHttpBufferSize,
  pingTimeout: socketPingTimeout,
  pingInterval: socketPingInterval,
  perMessageDeflate: {
    threshold: 32 * 1024
  },
  cors: {
    origin(origin, callback) {
      if (isOriginAllowed(origin, allowedOrigins, allowFileProtocol)) {
        callback(null, true)
        return
      }
      callback(new Error('Origin not allowed by CORS policy'))
    },
    methods: ['GET', 'POST'],
    credentials: true
  }
})

const connectionRateLimiter = new RateLimiterMemory({ points: 8, duration: 60 })
const audioRateLimiter = new RateLimiterMemory({
  points: audioRateLimitPoints,
  duration: audioRateLimitWindowSeconds
})

function getClientIp(socket: import('socket.io').Socket): string {
  const remoteAddress =
    normalizeIpAddress(socket.conn.remoteAddress) ||
    normalizeIpAddress(socket.handshake.address) ||
    'unknown'

  if (!socketProxyEvaluator.shouldTrustForwardedHeader) {
    return remoteAddress
  }

  if (!socketProxyEvaluator.isTrustedProxy(remoteAddress)) {
    return remoteAddress
  }

  const forwarded = extractFirstIpFromForwardedHeader(socket.handshake.headers['x-forwarded-for'])
  return forwarded ?? remoteAddress
}

function getSocketAuthToken(socket: import('socket.io').Socket): string {
  const authToken =
    socket.handshake.auth && typeof socket.handshake.auth.token === 'string'
      ? socket.handshake.auth.token.trim()
      : ''

  if (authToken) {
    return authToken
  }

  const headerToken = resolveProvidedToken({
    'x-api-key': socket.handshake.headers['x-api-key'] as string | string[] | undefined,
    authorization: socket.handshake.headers.authorization as string | string[] | undefined
  })

  return headerToken ?? ''
}

io.use(async (socket, next) => {
  if (
    !isOriginAllowed(
      socket.handshake.headers.origin,
      allowedOrigins,
      allowFileProtocol,
      socket.handshake.headers
    )
  ) {
    apiLogger.warn('Socket connection rejected due to disallowed origin', {
      origin: socket.handshake.headers.origin || 'undefined'
    })
    next(new Error('Origin not allowed'))
    return
  }

  const tokensAvailable = await hasConfiguredApiTokens()
  if (!tokensAvailable) {
    next(new Error('Server authentication token is not configured'))
    return
  }

  try {
    await connectionRateLimiter.consume(getClientIp(socket))
  } catch (error) {
    apiLogger.warn('Socket connection rate limit exceeded', {
      socketId: socket.id,
      error: describeError(error)
    })
    next(new Error('Too many connection attempts'))
    return
  }

  const providedToken = getSocketAuthToken(socket)

  if (!providedToken) {
    apiLogger.warn('Socket connection rejected without authentication token', {
      socketId: socket.id,
      origin: socket.handshake.headers.origin
    })
    next(new Error('Unauthorized'))
    return
  }

  const identity = await verifyApiToken(providedToken)
  if (!identity) {
    apiLogger.warn('Socket connection rejected due to invalid token', {
      socketId: socket.id,
      origin: socket.handshake.headers.origin
    })
    next(new Error('Unauthorized'))
    return
  }

  if (!ensurePermission(identity, API_PERMISSIONS.SONIC_STREAM_SESSION)) {
    apiLogger.warn('Socket connection rejected due to insufficient permissions', {
      socketId: socket.id,
      origin: socket.handshake.headers.origin,
      role: identity.role
    })
    next(new Error('Forbidden'))
    return
  }

  socket.data = {
    ...(socket.data || {}),
    authToken: providedToken,
    clientIp: getClientIp(socket),
    authIdentity: identity
  }

  next()
})

api.use(cors(corsOptionsDelegate))

api.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
  next()
})

api.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    next()
    return
  }

  const metadataResult = isFetchMetadataRequestSafe({
    method: req.method,
    origin: req.headers.origin,
    secFetchSite: req.headers['sec-fetch-site'],
    secFetchMode: req.headers['sec-fetch-mode'],
    secFetchDest: req.headers['sec-fetch-dest'],
    allowFileProtocol
  })

  if (!metadataResult.allowed) {
    apiLogger.warn('Rejected request due to fetch metadata policy', {
      path: req.path,
      method: req.method,
      reason: metadataResult.reason
    })
    sendApiErrorResponse(res, 'metadata_policy_blocked', {
      status: 403,
      metadata: { reason: metadataResult.reason }
    })
    return
  }

  next()
})
api.use(express.json({ limit: '10mb', type: ['application/json', 'application/*+json'] }))
api.use(express.urlencoded({ extended: true, limit: '10mb', parameterLimit: 1000 }))
api.use((req, res, next) => {
  if (hasPrototypePollution(req.body) || hasPrototypePollution(req.query)) {
    apiLogger.warn('Rejected request with prototype pollution payload', {
      path: req.path,
      method: req.method
    })
    sendApiErrorResponse(res, 'prototype_pollution_detected', {
      status: 400
    })
    return
  }
  next()
})
api.use(compression())
api.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    originAgentCluster: true
  })
)
api.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  next()
})

const requireApiKey: RequestHandler = (async (req, res, next) => {
  try {
    if (req.method === 'OPTIONS') {
      return next()
    }

    if (
      (req.path === '/healthz' || req.path === '/readyz') &&
      (req.method === 'GET' || req.method === 'HEAD')
    ) {
      return next()
    }

    const tokensAvailable = await hasConfiguredApiTokens()
    if (!tokensAvailable) {
      apiLogger.error('API auth token is not configured')
      sendApiErrorResponse(res, 'server_auth_not_configured', { status: 500 })
      return
    }

    const providedToken = resolveProvidedToken({
      'x-api-key': req.headers['x-api-key'],
      authorization: req.headers.authorization
    })

    if (!providedToken) {
      apiLogger.warn('Rejected request without authentication token', {
        path: req.path,
        method: req.method,
        origin: req.headers.origin
      })
      sendApiErrorResponse(res, 'unauthorized_request', { status: 401 })
      return
    }

    const identity = await verifyApiToken(providedToken)
    if (!identity) {
      apiLogger.warn('Rejected request with invalid API token', {
        path: req.path,
        method: req.method,
        origin: req.headers.origin
      })
      sendApiErrorResponse(res, 'unauthorized_request', { status: 401 })
      return
    }

    req.authIdentity = identity
    return next()
  } catch (error) {
    return next(error)
  }
}) as RequestHandler

api.use(requireApiKey)

function summarizeHealthComponents(report: Awaited<ReturnType<typeof buildHealthReport>>) {
  return Object.entries(report.components).map(([key, component]) => ({
    key,
    status: component.status,
    issueCount: component.issues?.length ?? 0
  }))
}

api.get(
  '/healthz',
  wrap(async (_req, res) => {
    const report = await buildHealthReport()
    const componentSummaries = summarizeHealthComponents(report)
    const statusCode = report.status === OVERALL_HEALTH_STATUS.ERROR ? 503 : 200

    if (report.status === OVERALL_HEALTH_STATUS.ERROR) {
      apiLogger.error('Health endpoint responded with error status', { components: componentSummaries })
    } else if (report.status === OVERALL_HEALTH_STATUS.DEGRADED) {
      apiLogger.warn('Health endpoint responded with degraded status', { components: componentSummaries })
    } else {
      apiLogger.debug('Health endpoint responded with ok status', { components: componentSummaries })
    }

    res.status(statusCode).json(report)
  }) as RequestHandler
)

api.get(
  '/readyz',
  wrap(async (_req, res) => {
    const readiness = await buildReadinessReport()
    const statusCode = readiness.status === 'ready' ? 200 : 503

    if (statusCode === 503) {
      apiLogger.warn('Readiness probe reported degraded state', {
        status: readiness.status,
        healthStatus: readiness.healthStatus
      })
    }

    res.status(statusCode).json(readiness)
  }) as RequestHandler
)

api.head(
  '/readyz',
  wrap(async (_req, res) => {
    const readiness = await buildReadinessReport()
    const statusCode = readiness.status === 'ready' ? 200 : 503
    if (statusCode === 503) {
      apiLogger.warn('Readiness probe reported degraded state', {
        status: readiness.status,
        healthStatus: readiness.healthStatus
      })
    }
    res.status(statusCode).end()
  }) as RequestHandler
)

api.get(
  '/metrics',
  createPermissionMiddleware({ permission: API_PERMISSIONS.MONITORING_READ, logger: apiLogger }),
  metricsHandler
)

api.head(
  '/healthz',
  wrap(async (_req, res) => {
    const report = await buildHealthReport()
    const componentSummaries = summarizeHealthComponents(report)
    const statusCode = report.status === OVERALL_HEALTH_STATUS.ERROR ? 503 : 200

    if (report.status === OVERALL_HEALTH_STATUS.ERROR) {
      apiLogger.error('Health endpoint responded with error status', { components: componentSummaries })
    } else if (report.status === OVERALL_HEALTH_STATUS.DEGRADED) {
      apiLogger.warn('Health endpoint responded with degraded status', { components: componentSummaries })
    } else {
      apiLogger.debug('Health endpoint responded with ok status', { components: componentSummaries })
    }

    res.status(statusCode).end()
  }) as RequestHandler
)

interface CustomRequest<T> extends Request {
  body: T
}

type ConverseStreamRequest = CustomRequest<ValidatedConversePayload>

api.post(
  '/converse/stream',
  createPermissionMiddleware({
    permission: API_PERMISSIONS.BEDROCK_CONVERSE_STREAM,
    logger: apiLogger
  }),
  wrap(async (req: ConverseStreamRequest, res) => {
    const validationResult = validateConversePayload(req.body)
    if (!validationResult.success) {
      const flattened = validationResult.error.flatten()
      apiLogger.warn('Rejected converse/stream request with invalid payload', {
        fieldErrorCount: Object.values(flattened.fieldErrors).reduce(
          (total, issues) => total + (issues?.length ?? 0),
          0
        ),
        formErrorCount: flattened.formErrors.length
      })
      sendApiErrorResponse(res, 'invalid_request_payload', {
        status: 400,
        metadata: { issues: flattened }
      })
      return
    }

    const safePayload = toCallConverseApiProps(validationResult.data)

    const bedrockService = await getBedrockService()
    res.setHeader('Content-Type', 'text/event-stream;charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('X-Accel-Buffering', 'no')

    try {
      const result = await bedrockService.converseStream(safePayload)

      if (!result.stream) {
        return res.end()
      }

      for await (const item of result.stream) {
        res.write(JSON.stringify(item) + '\n')
      }
    } catch (error: any) {
      const errorDescription = describeError(error)
      if (error.name === 'ValidationException') {
        sendApiErrorResponse(res, 'invalid_request_payload', {
          status: 400,
          metadata: {
            provider: 'bedrock',
            error: errorDescription
          }
        })
        bedrockLogger.warn('Stream conversation validation failed', {
          modelId: req.body.modelId,
          error: errorDescription
        })
        return
      }

      const referenceId = sendApiErrorResponse(res, 'internal_server_error', {
        metadata: { operation: 'converseStream' }
      })
      bedrockLogger.error('Stream conversation failed', {
        referenceId,
        error: errorDescription,
        modelId: req.body.modelId
      })
      return
    }

    return res.end()
  })
)

type ConverseRequest = CustomRequest<ValidatedConversePayload>

api.post(
  '/converse',
  wrap(async (req: ConverseRequest, res) => {
    const validationResult = validateConversePayload(req.body)
    if (!validationResult.success) {
      const flattened = validationResult.error.flatten()
      apiLogger.warn('Rejected converse request with invalid payload', {
        fieldErrorCount: Object.values(flattened.fieldErrors).reduce(
          (total, issues) => total + (issues?.length ?? 0),
          0
        ),
        formErrorCount: flattened.formErrors.length
      })
      sendApiErrorResponse(res, 'invalid_request_payload', {
        status: 400,
        metadata: { issues: flattened }
      })
      return
    }

    const safePayload = toCallConverseApiProps(validationResult.data)

    const bedrockService = await getBedrockService()
    res.setHeader('Content-Type', 'application/json')

    try {
      const result = await bedrockService.converse(safePayload)
      return res.json(result)
    } catch (error: any) {
      const errorDescription = describeError(error)
      const referenceId = sendApiErrorResponse(res, 'internal_server_error', {
        metadata: { operation: 'converse' }
      })
      bedrockLogger.error('Conversation failed', {
        referenceId,
        error: errorDescription,
        modelId: req.body.modelId
      })
      return
    }
  })
)

type RetrieveAndGenerateCommandInputRequest = CustomRequest<ValidatedRetrieveAndGeneratePayload>

api.post(
  '/retrieveAndGenerate',
  wrap(async (req: RetrieveAndGenerateCommandInputRequest, res) => {
    const validationResult = validateRetrieveAndGeneratePayload(req.body)
    if (!validationResult.success) {
      const flattened = validationResult.error.flatten()
      apiLogger.warn('Rejected retrieveAndGenerate request with invalid payload', {
        fieldErrorCount: Object.values(flattened.fieldErrors).reduce(
          (total, issues) => total + (issues?.length ?? 0),
          0
        ),
        formErrorCount: flattened.formErrors.length
      })
      sendApiErrorResponse(res, 'invalid_request_payload', {
        status: 400,
        metadata: { issues: flattened }
      })
      return
    }

    const bedrockService = await getBedrockService()
    res.setHeader('Content-Type', 'application/json')
    try {
      const safeInput = toRetrieveAndGenerateInput(validationResult.data)
      const result = await bedrockService.retrieveAndGenerate(safeInput)
      return res.json(result)
    } catch (error: any) {
      const knowledgeBaseId = (req.body as any).knowledgeBaseId || 'unknown'
      const errorDescription = describeError(error)
      if (error.name === 'ResourceNotFoundException') {
        sendApiErrorResponse(res, 'invalid_request_payload', {
          status: 404,
          metadata: {
            provider: 'bedrock',
            error: errorDescription,
            knowledgeBaseId
          }
        })
        bedrockLogger.warn('RetrieveAndGenerate resource not found', {
          knowledgeBaseId,
          error: errorDescription
        })
        return
      }

      const referenceId = sendApiErrorResponse(res, 'internal_server_error', {
        metadata: { operation: 'retrieveAndGenerate', knowledgeBaseId }
      })
      bedrockLogger.error('RetrieveAndGenerate failed', {
        referenceId,
        error: errorDescription,
        knowledgeBaseId
      })
      return
    }
  })
)

api.get(
  '/listModels',
  createPermissionMiddleware({
    permission: API_PERMISSIONS.BEDROCK_LIST_MODELS,
    logger: apiLogger
  }),
  wrap(async (_req: Request, res) => {
    const bedrockService = await getBedrockService()
    res.setHeader('Content-Type', 'application/json')
    try {
      const result = await bedrockListModelsBreaker.execute(() =>
        executeWithRetry(() => bedrockService.listModels(), {
          maxAttempts: externalCallMaxRetries,
          initialDelayMs: externalCallBaseDelayMs,
          maxDelayMs: externalCallMaxDelayMs,
          logger: bedrockLogger,
          operationName: 'bedrock:listModels'
        })
      )
      return res.json(result)
    } catch (error: any) {
      if (error instanceof CircuitBreakerOpenError) {
        const retryAfterMs = Math.max(0, error.retryAt - Date.now())
        const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000))
        res.setHeader('Retry-After', retryAfterSeconds.toString())
        const referenceId = sendApiErrorResponse(res, 'service_temporarily_unavailable', {
          status: 503,
          metadata: {
            operation: 'listModels',
            breakerName: error.breakerName ?? 'bedrock:listModels',
            retryAfterMs
          }
        })
        bedrockLogger.warn('ListModels short-circuited by circuit breaker', {
          referenceId,
          breakerName: error.breakerName ?? 'bedrock:listModels',
          retryAfterMs
        })
        return
      }

      const referenceId = sendApiErrorResponse(res, 'internal_server_error', {
        metadata: { operation: 'listModels' }
      })
      bedrockLogger.error('ListModels error', {
        referenceId,
        error: describeError(error)
      })
      return
    }
  })
)

// Nova Sonic region support check endpoint
api.get(
  '/nova-sonic/region-check',
  createPermissionMiddleware({
    permission: API_PERMISSIONS.BEDROCK_DIAGNOSTICS,
    logger: apiLogger
  }),
  wrap(async (req: Request, res) => {
    res.setHeader('Content-Type', 'application/json')
    try {
      const regionValidation = validateRegionParam(req.query.region)
      if (!regionValidation.success) {
        sendApiErrorResponse(res, 'invalid_region_parameter', { status: 400 })
        return
      }
      const result = await bedrockDiagnosticsBreaker.execute(() =>
        executeWithRetry(() => checkNovaSonicRegionSupport(regionValidation.data), {
          maxAttempts: externalCallMaxRetries,
          initialDelayMs: externalCallBaseDelayMs,
          maxDelayMs: externalCallMaxDelayMs,
          logger: apiLogger,
          operationName: 'bedrock:novaSonicRegionCheck'
        })
      )
      return res.json(result)
    } catch (error: any) {
      if (error instanceof CircuitBreakerOpenError) {
        const retryAfterMs = Math.max(0, error.retryAt - Date.now())
        const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000))
        res.setHeader('Retry-After', retryAfterSeconds.toString())
        const referenceId = sendApiErrorResponse(res, 'service_temporarily_unavailable', {
          status: 503,
          metadata: {
            operation: 'novaSonicRegionCheck',
            breakerName: error.breakerName ?? 'bedrock:diagnostics',
            retryAfterMs
          }
        })
        apiLogger.warn('Nova Sonic region check short-circuited by circuit breaker', {
          referenceId,
          breakerName: error.breakerName ?? 'bedrock:diagnostics',
          retryAfterMs
        })
        return
      }
      const referenceId = sendApiErrorResponse(res, 'nova_sonic_region_check_failed')
      apiLogger.error('Nova Sonic region check error', {
        referenceId,
        error: describeError(error)
      })
      return
    }
  })
)

// Bedrock connectivity test endpoint
api.get(
  '/bedrock/connectivity-test',
  createPermissionMiddleware({
    permission: API_PERMISSIONS.BEDROCK_DIAGNOSTICS,
    logger: apiLogger
  }),
  wrap(async (req: Request, res) => {
    res.setHeader('Content-Type', 'application/json')
    try {
      const regionValidation = validateRegionParam(req.query.region)
      if (!regionValidation.success) {
        sendApiErrorResponse(res, 'invalid_region_parameter', { status: 400 })
        return
      }
      const result = await bedrockDiagnosticsBreaker.execute(() =>
        executeWithRetry(() => testBedrockConnectivity(regionValidation.data), {
          maxAttempts: externalCallMaxRetries,
          initialDelayMs: externalCallBaseDelayMs,
          maxDelayMs: externalCallMaxDelayMs,
          logger: apiLogger,
          operationName: 'bedrock:connectivityTest'
        })
      )
      return res.json(result)
    } catch (error: any) {
      if (error instanceof CircuitBreakerOpenError) {
        const retryAfterMs = Math.max(0, error.retryAt - Date.now())
        const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000))
        res.setHeader('Retry-After', retryAfterSeconds.toString())
        const referenceId = sendApiErrorResponse(res, 'service_temporarily_unavailable', {
          status: 503,
          metadata: {
            operation: 'bedrockConnectivityTest',
            breakerName: error.breakerName ?? 'bedrock:diagnostics',
            retryAfterMs
          }
        })
        apiLogger.warn('Bedrock connectivity test short-circuited by circuit breaker', {
          referenceId,
          breakerName: error.breakerName ?? 'bedrock:diagnostics',
          retryAfterMs
        })
        return
      }
      const referenceId = sendApiErrorResponse(res, 'bedrock_connectivity_test_failed')
      apiLogger.error('Bedrock connectivity test error', {
        referenceId,
        error: describeError(error)
      })
      return
    }
  })
)

// Socket.IO connection handler
io.on('connection', (socket) => {
  void (async () => {
    await storeReady
  // storeからAWS設定を取得してNova Sonicクライアントを作成
    const awsConfig = store.get('aws')

    const sonicClient = createNovaSonicClient({
      region: awsConfig?.region || DEFAULT_NOVA_SONIC_REGION,
      accessKeyId: awsConfig?.accessKeyId || '',
      secretAccessKey: awsConfig?.secretAccessKey || '',
      sessionToken: awsConfig?.sessionToken,
      useProfile: awsConfig?.useProfile ?? true,
      profile: awsConfig?.profile || 'default'
    })

    // Initialize tool executor and connect it to the bedrock client
    const toolExecutor = new SonicToolExecutor(io)
    sonicClient.setToolExecutor(toolExecutor)

    // Register tool execution handlers for this socket
    toolExecutor.registerSocketHandlers(socket)

    // Create a unique session ID for this client
    const sessionId = socket.id

    try {
      // Create session with the new API (but don't initiate AWS stream yet)
      const session = sonicClient.createStreamSession(sessionId)

    // Track initialization state
    const sessionState = {
      promptStartSent: false,
      systemPromptSent: false,
      audioStartSent: false,
      initialized: false
    }

    // Function to check if all setup events are received and initiate session
    const checkAndInitializeSession = async () => {
      if (
        !sessionState.initialized &&
        sessionState.promptStartSent &&
        sessionState.systemPromptSent &&
        sessionState.audioStartSent
      ) {
        try {
          sessionState.initialized = true
          await sonicClient.initiateSession(sessionId)
        } catch (error) {
          const errorDescription = describeError(error)
          bedrockLogger.error('Error initiating session', {
            sessionId,
            error: errorDescription
          })
          socket.emit(
            'error',
            createApiError('socket_stream_initialization_failed', {
              reason: 'initiate_session_failed',
              sessionId,
              error: errorDescription
            })
          )
        }
      }
    }

    // Set up event handlers
    session.onEvent('contentStart', (data) => {
      socket.emit('contentStart', data)
    })

    session.onEvent('textOutput', (data) => {
      socket.emit('textOutput', data)
    })

    session.onEvent('audioOutput', (data) => {
      socket.emit('audioOutput', data)
    })

    session.onEvent('error', (data) => {
      bedrockLogger.error('Error in session', { data })
      socket.emit('error', data)
    })

    session.onEvent('toolUse', (data) => {
      socket.emit('toolUse', data)
    })

    session.onEvent('toolResult', (data) => {
      socket.emit('toolResult', data)
    })

    session.onEvent('contentEnd', (data) => {
      socket.emit('contentEnd', data)
    })

    session.onEvent('streamComplete', () => {
      socket.emit('streamComplete')
    })

    socket.on('audioInput', async (audioData) => {
      const limiterKey = `${socket.data?.clientIp ?? getClientIp(socket)}:${socket.data?.authToken ?? ''}`
      try {
        await audioRateLimiter.consume(limiterKey)
      } catch (error) {
        bedrockLogger.warn('Audio input rate limit exceeded', {
          socketId: socket.id,
          error: describeError(error)
        })
        socket.emit(
          'error',
          createApiError('socket_audio_rate_limit_exceeded', {
            socketId: socket.id
          })
        )
        return
      }

      try {
        let audioBuffer: Buffer
        if (typeof audioData === 'string') {
          try {
            audioBuffer = Buffer.from(audioData, 'base64')
          } catch {
            throw new Error('Invalid base64 audio payload')
          }
        } else if (audioData instanceof ArrayBuffer) {
          audioBuffer = Buffer.from(audioData)
        } else if (Buffer.isBuffer(audioData)) {
          audioBuffer = audioData
        } else {
          throw new Error('Unsupported audio payload type')
        }

        if (audioBuffer.length === 0) {
          throw new Error('Empty audio payload')
        }

        if (audioBuffer.length > maxAudioPayloadBytes) {
          throw new Error('Audio payload too large')
        }

        await sequentialAudioQueue.enqueue(socket.id, async () => {
          await session.streamAudio(audioBuffer)
        })
      } catch (error) {
        const errorDescription = describeError(error)
        const reason = resolveAudioProcessingReason(error)
        bedrockLogger.error('Error processing audio', {
          reason,
          error: errorDescription
        })
        socket.emit(
          'error',
          createApiError('socket_audio_processing_failed', {
            reason,
            error: errorDescription
          })
        )
      }
    })

    socket.on('promptStart', async (data) => {
      try {
        await session.setupPromptStart(data?.tools, data?.voiceId)
        sessionState.promptStartSent = true
        await checkAndInitializeSession()
      } catch (error) {
        const errorDescription = describeError(error)
        bedrockLogger.error('Error processing prompt start', {
          error: errorDescription
        })
        socket.emit(
          'error',
          createApiError('socket_prompt_processing_failed', {
            reason: 'prompt_start_failed',
            error: errorDescription
          })
        )
      }
    })

    socket.on('systemPrompt', async (data) => {
      try {
        await session.setupSystemPrompt(undefined, data)
        sessionState.systemPromptSent = true
        await checkAndInitializeSession()
      } catch (error) {
        const errorDescription = describeError(error)
        bedrockLogger.error('Error processing system prompt', {
          error: errorDescription
        })
        socket.emit(
          'error',
          createApiError('socket_system_prompt_failed', {
            reason: 'system_prompt_failed',
            error: errorDescription
          })
        )
      }
    })

    socket.on('audioStart', async (_data) => {
      try {
        await session.setupStartAudio()
        sessionState.audioStartSent = true
        await checkAndInitializeSession()
      } catch (error) {
        const errorDescription = describeError(error)
        bedrockLogger.error('Error processing audio start', {
          error: errorDescription
        })
        socket.emit(
          'error',
          createApiError('socket_audio_start_failed', {
            reason: 'audio_start_failed',
            error: errorDescription
          })
        )
      }
    })

    socket.on('stopAudio', async () => {
      try {
        // Chain the closing sequence
        await Promise.all([
          session
            .endAudioContent()
            .then(() => session.endPrompt())
            .then(() => session.close())
        ])
      } catch (error) {
        const errorDescription = describeError(error)
        bedrockLogger.error('Error processing streaming end events', {
          error: errorDescription
        })
        socket.emit(
          'error',
          createApiError('socket_stream_end_failed', {
            reason: 'stream_cleanup_failed',
            error: errorDescription
          })
        )
      }
    })

    // Handle disconnection
    socket.on('disconnect', async () => {
      sequentialAudioQueue.clear(socket.id)
      if (sonicClient.isSessionActive(sessionId)) {
        try {
          // Add explicit timeouts to avoid hanging promises
          const cleanupPromise = Promise.race([
            (async () => {
              await session.endAudioContent()
              await session.endPrompt()
              await session.close()
            })(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Session cleanup timeout')), 3000)
            )
          ])

          await cleanupPromise
        } catch (error) {
          const errorDescription = describeError(error)
          bedrockLogger.error('Error cleaning up session after disconnect', {
            sessionId: socket.id,
            error: errorDescription
          })
          try {
            sonicClient.forceCloseSession(sessionId)
          } catch (e) {
            bedrockLogger.error('Failed force close for session', {
              sessionId,
              error: describeError(e)
            })
          }
        } finally {
          // Make sure socket is fully closed in all cases
          if (socket.connected) {
            socket.disconnect(true)
          }
        }
      }
    })
    } catch (error) {
      const errorDescription = describeError(error)
      bedrockLogger.error('Error creating session', {
        error: errorDescription
      })
      socket.emit(
        'error',
        createApiError('socket_session_initialization_failed', {
          reason: 'create_stream_session_failed',
          error: errorDescription
        })
      )
      socket.disconnect()
    }
  })().catch((error) => {
    const errorDescription = describeError(error)
    bedrockLogger.error('Unhandled error setting up socket connection', {
      error: errorDescription
    })
    socket.emit('error', createApiError('socket_internal_error', { error: errorDescription }))
    socket.disconnect(true)
  })
})

// Add error handling middleware last
api.use(errorHandler)

export { server, api }
