import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { createHash } from 'node:crypto'
import type { SecretsAuditLogger } from './types'

export interface AwsSecretFetchOptions {
  secretId: string
  region?: string
  endpoint?: string
  cacheTtlSeconds?: number
  auditLogger?: SecretsAuditLogger
}

interface CachedSecretEntry {
  value: string | undefined
  expiresAt: number
}

const clientCache = new Map<string, SecretsManagerClient>()
const secretCache = new Map<string, CachedSecretEntry>()
const inFlightLookups = new Map<string, Promise<string | undefined>>()

export class AwsSecretsManagerUnavailableError extends Error {
  public readonly retryAfter: number

  constructor(message: string, options: { retryAfter: number; cause?: unknown }) {
    super(message)
    this.name = 'AwsSecretsManagerUnavailableError'
    this.retryAfter = options.retryAfter
    if (options.cause) {
      this.cause = options.cause
    }
  }
}

function resolveClientKey(options: AwsSecretFetchOptions): string {
  return JSON.stringify({
    region: options.region ?? null,
    endpoint: options.endpoint ?? null
  })
}

function resolveSecretCacheKey(options: AwsSecretFetchOptions): string {
  return JSON.stringify({
    secretId: options.secretId,
    region: options.region ?? null,
    endpoint: options.endpoint ?? null
  })
}

function createClient(options: AwsSecretFetchOptions): SecretsManagerClient {
  const clientKey = resolveClientKey(options)

  const existing = clientCache.get(clientKey)
  if (existing) {
    return existing
  }

  const client = new SecretsManagerClient({
    region: options.region,
    endpoint: options.endpoint
  })

  clientCache.set(clientKey, client)
  return client
}

function hashIdentifier(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

function setCachedValue(key: string, value: string | undefined, ttlSeconds: number): void {
  const ttl = Math.max(1, ttlSeconds)
  secretCache.set(key, {
    value,
    expiresAt: Date.now() + ttl * 1000
  })
}

export async function fetchAwsSecretString(options: AwsSecretFetchOptions): Promise<string | undefined> {
  const cacheKey = resolveSecretCacheKey(options)
  const ttlSeconds = options.cacheTtlSeconds ?? 60
  const cached = secretCache.get(cacheKey)

  if (cached && cached.expiresAt > Date.now()) {
    options.auditLogger?.info('secrets_manager_cache_hit', {
      driver: 'aws-secrets-manager',
      secretIdHash: hashIdentifier(options.secretId)
    })
    return cached.value
  }

  const deduped = inFlightLookups.get(cacheKey)
  if (deduped) {
    return deduped
  }

  const lookup = (async () => {
    const identifierHash = hashIdentifier(options.secretId)

    try {
      const client = createClient(options)
      const result = await client.send(
        new GetSecretValueCommand({
          SecretId: options.secretId
        })
      )

      const value =
        result.SecretString ?? (result.SecretBinary ? Buffer.from(result.SecretBinary).toString('utf8') : undefined)

      setCachedValue(cacheKey, value, ttlSeconds)

      options.auditLogger?.info('secrets_manager_fetch_success', {
        driver: 'aws-secrets-manager',
        secretIdHash: identifierHash
      })

      return value
    } catch (error) {
      const retryAfterSeconds = Math.min(ttlSeconds, 30)
      setCachedValue(cacheKey, undefined, retryAfterSeconds)

      options.auditLogger?.error('secrets_manager_fetch_failed', {
        driver: 'aws-secrets-manager',
        secretIdHash: identifierHash,
        error
      })

      throw new AwsSecretsManagerUnavailableError('Unable to load secret from AWS Secrets Manager', {
        retryAfter: retryAfterSeconds,
        cause: error
      })
    } finally {
      inFlightLookups.delete(cacheKey)
    }
  })()

  inFlightLookups.set(cacheKey, lookup)
  return lookup
}

export function resetAwsSecretsCacheForTests(): void {
  secretCache.clear()
  inFlightLookups.clear()
}
