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
import { Server } from 'socket.io'
import { SonicToolExecutor } from './sonic/tool-executor'
import { checkNovaSonicRegionSupport, testBedrockConnectivity } from './sonic/regionCheck'
import { RateLimiterMemory } from 'rate-limiter-flexible'
import { timingSafeEqual } from 'crypto'
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
import { normalizeApiToken, MIN_API_TOKEN_LENGTH } from '../../common/security'
import { resolveAllowedOrigins as computeAllowedOrigins } from './origin-allowlist'
import {
  normalizeIpAddress,
  extractFirstIpFromForwardedHeader,
  createSocketProxyEvaluator
} from './network-utils'
import { createHardenedServer } from './server-hardening'
import { toCallConverseApiProps, toRetrieveAndGenerateInput } from './payload-normalizers'
import { describeError, sendApiErrorResponse, createApiError } from './api-error-response'

// Create category logger for API
const apiLogger = createCategoryLogger('api:express')
const bedrockLogger = createCategoryLogger('api:bedrock')

let envTokenWarningEmitted = false
let storedTokenWarningEmitted = false

type ClampOptions = {
  min?: number
  max?: number
}

function parsePositiveIntEnv(
  envKey: string,
  fallback: number,
  options: ClampOptions = {}
): number {
  const rawValue = process.env[envKey]
  if (!rawValue) {
    return fallback
  }

  const parsed = Number.parseInt(rawValue, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    apiLogger.warn('Ignoring invalid numeric environment override', {
      envKey,
      rawValue
    })
    return fallback
  }

  const { min, max } = options
  let normalized = parsed

  if (typeof min === 'number' && normalized < min) {
    apiLogger.warn('Clamping numeric environment override below minimum', {
      envKey,
      rawValue: parsed,
      min
    })
    normalized = min
  }

  if (typeof max === 'number' && normalized > max) {
    apiLogger.warn('Clamping numeric environment override above maximum', {
      envKey,
      rawValue: parsed,
      max
    })
    normalized = max
  }

  return normalized
}

interface PromiseRequestHandler {
  (req: Request, res: Response, next: NextFunction): Promise<unknown>
}

function wrap(fn: PromiseRequestHandler): RequestHandler {
  return (req, res, next) => fn(req, res, next).catch(next)
}

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

const rateLimitWindowMs = parsePositiveIntEnv('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000, {
  min: 5_000,
  max: 60 * 60 * 1000
})
const rateLimitMax = parsePositiveIntEnv('RATE_LIMIT_MAX', 100, {
  min: 10,
  max: 1000
})
const maxRequestsPerSocket = parsePositiveIntEnv('MAX_REQUESTS_PER_SOCKET', 100, {
  min: 10,
  max: 500
})
const socketMaxHttpBufferSize = parsePositiveIntEnv('SOCKET_MAX_HTTP_BUFFER_SIZE', 1024 * 1024, {
  min: 32 * 1024,
  max: 4 * 1024 * 1024
})
const socketPingTimeout = parsePositiveIntEnv('SOCKET_PING_TIMEOUT_MS', 20_000, {
  min: 5_000,
  max: 60_000
})
const socketPingInterval = parsePositiveIntEnv('SOCKET_PING_INTERVAL_MS', 25_000, {
  min: 5_000,
  max: 60_000
})
const audioRateLimitWindowSeconds = parsePositiveIntEnv('AUDIO_RATE_LIMIT_WINDOW_SEC', 60, {
  min: 10,
  max: 600
})
const audioRateLimitPoints = parsePositiveIntEnv('AUDIO_RATE_LIMIT_POINTS', 120, {
  min: 10,
  max: 600
})
const maxHeaderBytes = parsePositiveIntEnv('API_MAX_HEADER_BYTES', 8 * 1024, {
  min: 2 * 1024,
  max: 64 * 1024
})
const maxHeadersCount = parsePositiveIntEnv('API_MAX_HEADERS_COUNT', 200, {
  min: 20,
  max: 1000
})

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

async function getApiAuthToken(): Promise<string | null> {
  const envToken = normalizeApiToken(process.env.API_AUTH_TOKEN)
  if (envToken) {
    return envToken
  }

  if (process.env.API_AUTH_TOKEN && !envTokenWarningEmitted) {
    apiLogger.warn('Ignoring weak API_AUTH_TOKEN value from environment', {
      minLength: MIN_API_TOKEN_LENGTH
    })
    envTokenWarningEmitted = true
  }

  await storeReady

  const storedToken = normalizeApiToken(store.get('apiAuthToken'))
  if (storedToken) {
    return storedToken
  }

  const rawStoredToken = store.get('apiAuthToken')
  if (!storedTokenWarningEmitted && typeof rawStoredToken === 'string' && rawStoredToken.trim().length > 0) {
    apiLogger.warn('Stored API token failed strength validation; a new token will be issued')
    storedTokenWarningEmitted = true
  }
  return null
}


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
const MAX_AUDIO_PAYLOAD_BYTES = parsePositiveIntEnv('MAX_AUDIO_PAYLOAD_BYTES', 1024 * 1024, {
  min: 32 * 1024,
  max: 4 * 1024 * 1024
})

function tokensMatch(expected: string, provided: string): boolean {
  const expectedBuffer = Buffer.from(expected)
  const providedBuffer = Buffer.from(provided)

  if (expectedBuffer.length !== providedBuffer.length) {
    return false
  }

  return timingSafeEqual(expectedBuffer, providedBuffer)
}

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
      ? socket.handshake.auth.token
      : undefined
  const headerToken =
    typeof socket.handshake.headers['x-api-key'] === 'string'
      ? (socket.handshake.headers['x-api-key'] as string)
      : undefined
  return (authToken || headerToken || '').trim()
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

  const token = await getApiAuthToken()
  if (!token) {
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

  if (!providedToken || !tokensMatch(token, providedToken)) {
    apiLogger.warn('Socket connection rejected due to invalid token', {
      socketId: socket.id,
      origin: socket.handshake.headers.origin
    })
    next(new Error('Unauthorized'))
    return
  }

  socket.data = {
    ...(socket.data || {}),
    authToken: providedToken,
    clientIp: getClientIp(socket)
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

    if (req.path === '/' && req.method === 'GET') {
      return next()
    }

    const token = await getApiAuthToken()
    if (!token) {
      apiLogger.error('API auth token is not configured')
      sendApiErrorResponse(res, 'server_auth_not_configured', { status: 500 })
      return
    }

    const providedToken =
      (req.headers['x-api-key'] as string | undefined) ||
      (typeof req.headers.authorization === 'string' &&
      req.headers.authorization.toLowerCase().startsWith('bearer ')
        ? req.headers.authorization.slice(7).trim()
        : undefined)

    if (!providedToken || !tokensMatch(token, providedToken.trim())) {
      apiLogger.warn('Rejected request with invalid API token', {
        path: req.path,
        method: req.method,
        origin: req.headers.origin
      })
      sendApiErrorResponse(res, 'unauthorized_request', { status: 401 })
      return
    }

    return next()
  } catch (error) {
    return next(error)
  }
}) as RequestHandler

// Add request logging
api.use((req, res, next) => {
  const start = Date.now()

  // Log when response is finished
  res.on('finish', () => {
    const duration = Date.now() - start
    apiLogger.debug(`${req.method} ${req.path}`, {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`
    })
  })

  next()
})

api.use(requireApiKey)

api.get('/', (_req: Request, res: Response) => {
  res.send('Hello World')
})

interface CustomRequest<T> extends Request {
  body: T
}

type ConverseStreamRequest = CustomRequest<ValidatedConversePayload>

api.post(
  '/converse/stream',
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
  wrap(async (_req: Request, res) => {
    const bedrockService = await getBedrockService()
    res.setHeader('Content-Type', 'application/json')
    try {
      const result = await bedrockService.listModels()
      return res.json(result)
    } catch (error: any) {
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
  wrap(async (req: Request, res) => {
    res.setHeader('Content-Type', 'application/json')
    try {
      const regionValidation = validateRegionParam(req.query.region)
      if (!regionValidation.success) {
        sendApiErrorResponse(res, 'invalid_region_parameter', { status: 400 })
        return
      }
      const result = await checkNovaSonicRegionSupport(regionValidation.data)
      return res.json(result)
    } catch (error: any) {
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
  wrap(async (req: Request, res) => {
    res.setHeader('Content-Type', 'application/json')
    try {
      const regionValidation = validateRegionParam(req.query.region)
      if (!regionValidation.success) {
        sendApiErrorResponse(res, 'invalid_region_parameter', { status: 400 })
        return
      }
      const result = await testBedrockConnectivity(regionValidation.data)
      return res.json(result)
    } catch (error: any) {
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
      region: awsConfig?.region || 'us-east-1',
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

        if (audioBuffer.length > MAX_AUDIO_PAYLOAD_BYTES) {
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
