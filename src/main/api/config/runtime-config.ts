import type { CategoryLogger } from '../../../common/logger'

export interface NumericClamp {
  min?: number
  max?: number
}

export interface RuntimeConfigDependencies {
  env: NodeJS.ProcessEnv
  logger: Pick<CategoryLogger, 'warn'>
}

export interface RuntimeConfig {
  rateLimitWindowMs: number
  rateLimitMax: number
  maxRequestsPerSocket: number
  socketMaxHttpBufferSize: number
  socketPingTimeout: number
  socketPingInterval: number
  audioRateLimitWindowSeconds: number
  audioRateLimitPoints: number
  maxHeaderBytes: number
  maxHeadersCount: number
  maxAudioPayloadBytes: number
  externalCallMaxRetries: number
  externalCallBaseDelayMs: number
  externalCallMaxDelayMs: number
  circuitBreakerFailureThreshold: number
  circuitBreakerCooldownMs: number
  circuitBreakerHalfOpenMaxCalls: number
}

export interface ParsePositiveIntegerOptions extends RuntimeConfigDependencies {
  key: string
  fallback: number
  clamp?: NumericClamp
}

/**
 * Parses a positive integer environment variable while enforcing optional
 * minimum and maximum bounds. Invalid inputs fall back to the provided default
 * and emit a structured warning via the supplied logger.
 */
export function parsePositiveIntegerEnv({
  env,
  logger,
  key,
  fallback,
  clamp = {}
}: ParsePositiveIntegerOptions): number {
  const rawValue = env[key]

  if (!rawValue) {
    return fallback
  }

  const parsed = Number.parseInt(rawValue, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    logger.warn('Ignoring invalid numeric environment override', {
      envKey: key,
      rawValue
    })
    return fallback
  }

  const { min, max } = clamp
  let normalised = parsed

  if (typeof min === 'number' && normalised < min) {
    logger.warn('Clamping numeric environment override below minimum', {
      envKey: key,
      rawValue: parsed,
      min
    })
    normalised = min
  }

  if (typeof max === 'number' && normalised > max) {
    logger.warn('Clamping numeric environment override above maximum', {
      envKey: key,
      rawValue: parsed,
      max
    })
    normalised = max
  }

  return normalised
}

/**
 * Resolves all runtime configuration values derived from environment variables
 * and applies defensive defaults for production safety. Each numeric override
 * is parsed through {@link parsePositiveIntegerEnv} so misconfigured values are
 * rejected deterministically while surfacing actionable warnings to operators.
 */
export function resolveRuntimeConfig({ env, logger }: RuntimeConfigDependencies): RuntimeConfig {
  const parse = (
    key: string,
    fallback: number,
    clamp: NumericClamp = {}
  ) =>
    parsePositiveIntegerEnv({ env, logger, key, fallback, clamp })

  return {
    rateLimitWindowMs: parse('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000, {
      min: 5_000,
      max: 60 * 60 * 1000
    }),
    rateLimitMax: parse('RATE_LIMIT_MAX', 100, { min: 10, max: 1000 }),
    maxRequestsPerSocket: parse('MAX_REQUESTS_PER_SOCKET', 100, {
      min: 10,
      max: 500
    }),
    socketMaxHttpBufferSize: parse('SOCKET_MAX_HTTP_BUFFER_SIZE', 1024 * 1024, {
      min: 32 * 1024,
      max: 4 * 1024 * 1024
    }),
    socketPingTimeout: parse('SOCKET_PING_TIMEOUT_MS', 20_000, {
      min: 5_000,
      max: 60_000
    }),
    socketPingInterval: parse('SOCKET_PING_INTERVAL_MS', 25_000, {
      min: 5_000,
      max: 60_000
    }),
    audioRateLimitWindowSeconds: parse('AUDIO_RATE_LIMIT_WINDOW_SEC', 60, {
      min: 10,
      max: 600
    }),
    audioRateLimitPoints: parse('AUDIO_RATE_LIMIT_POINTS', 120, {
      min: 10,
      max: 600
    }),
    maxHeaderBytes: parse('API_MAX_HEADER_BYTES', 8 * 1024, {
      min: 2 * 1024,
      max: 64 * 1024
    }),
    maxHeadersCount: parse('API_MAX_HEADERS_COUNT', 200, {
      min: 20,
      max: 1000
    }),
    maxAudioPayloadBytes: parse('MAX_AUDIO_PAYLOAD_BYTES', 1024 * 1024, {
      min: 32 * 1024,
      max: 4 * 1024 * 1024
    }),
    externalCallMaxRetries: parse('EXTERNAL_CALL_MAX_RETRIES', 3, {
      min: 1,
      max: 10
    }),
    externalCallBaseDelayMs: parse('EXTERNAL_CALL_BASE_DELAY_MS', 200, {
      min: 50,
      max: 5_000
    }),
    externalCallMaxDelayMs: parse('EXTERNAL_CALL_MAX_DELAY_MS', 2_000, {
      min: 200,
      max: 20_000
    }),
    circuitBreakerFailureThreshold: parse('CIRCUIT_BREAKER_FAILURE_THRESHOLD', 5, {
      min: 1,
      max: 20
    }),
    circuitBreakerCooldownMs: parse('CIRCUIT_BREAKER_COOLDOWN_MS', 30_000, {
      min: 1_000,
      max: 10 * 60 * 1000
    }),
    circuitBreakerHalfOpenMaxCalls: parse('CIRCUIT_BREAKER_HALF_OPEN_MAX_CALLS', 1, {
      min: 1,
      max: 5
    })
  }
}
