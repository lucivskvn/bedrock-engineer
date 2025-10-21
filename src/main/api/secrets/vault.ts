import { createHash } from 'node:crypto'
import type { SecretsAuditLogger } from './types'

type VaultAuthMount = string | undefined

interface VaultAuthBase {
  mount?: VaultAuthMount
}

interface VaultAppRoleAuthConfig extends VaultAuthBase {
  method: 'approle'
  roleId: string
  secretId: string
}

interface VaultJwtAuthConfig extends VaultAuthBase {
  method: 'jwt'
  role: string
  jwt: string
}

export type VaultAuthConfig = VaultAppRoleAuthConfig | VaultJwtAuthConfig

export interface VaultSecretFetchOptions {
  address: string
  namespace?: string
  secretPath: string
  cacheTtlSeconds?: number
  field?: string
  auditLogger?: SecretsAuditLogger
  renewWindowSeconds?: number
  auth: VaultAuthConfig
}

interface CachedSecretEntry {
  value: string | undefined
  expiresAt: number
}

interface CachedTokenEntry {
  token: string
  expiresAt: number
}

const tokenCache = new Map<string, CachedTokenEntry>()
const secretCache = new Map<string, CachedSecretEntry>()
const inFlightSecretLookups = new Map<string, Promise<string | undefined>>()

export class VaultUnavailableError extends Error {
  public readonly retryAfter: number

  constructor(message: string, options: { retryAfter: number; cause?: unknown }) {
    super(message)
    this.name = 'VaultUnavailableError'
    this.retryAfter = options.retryAfter
    if (options.cause) {
      this.cause = options.cause
    }
  }
}

function hashIdentifier(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

function resolveTokenCacheKey(options: VaultSecretFetchOptions): string {
  const baseKey = {
    address: options.address,
    namespace: options.namespace ?? null,
    auth: options.auth
  }
  return JSON.stringify(baseKey)
}

function resolveSecretCacheKey(options: VaultSecretFetchOptions): string {
  return JSON.stringify({
    address: options.address,
    namespace: options.namespace ?? null,
    secretPath: options.secretPath,
    field: options.field ?? null
  })
}

function resolveAuthMount(auth: VaultAuthConfig): string {
  if (auth.mount && auth.mount.trim().length > 0) {
    return auth.mount.trim().replace(/^\/+|\/+$/g, '')
  }

  return auth.method === 'approle' ? 'auth/approle' : 'auth/jwt'
}

async function authenticate(options: VaultSecretFetchOptions): Promise<string> {
  const cacheKey = resolveTokenCacheKey(options)
  const cached = tokenCache.get(cacheKey)
  const safetyWindow = (options.renewWindowSeconds ?? 60) * 1000

  if (cached && cached.expiresAt - safetyWindow > Date.now()) {
    return cached.token
  }

  const mount = resolveAuthMount(options.auth)
  const authPath = mount.startsWith('auth/') ? mount : `auth/${mount}`
  const url = new URL(`/v1/${authPath}/login`, options.address)

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json'
  }

  if (options.namespace) {
    headers['X-Vault-Namespace'] = options.namespace
  }

  let body: Record<string, unknown>
  if (options.auth.method === 'approle') {
    body = {
      role_id: options.auth.roleId,
      secret_id: options.auth.secretId
    }
  } else {
    body = {
      role: options.auth.role,
      jwt: options.auth.jwt
    }
  }

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    })
  } catch (error) {
    throw new VaultUnavailableError('Unable to authenticate with HashiCorp Vault', {
      retryAfter: 30,
      cause: error
    })
  }

  if (!response.ok) {
    throw new VaultUnavailableError('Vault authentication failed', {
      retryAfter: 30,
      cause: new Error(`unexpected_status_${response.status}`)
    })
  }

  const payload = (await response.json()) as { auth?: { client_token?: string; lease_duration?: number } }
  const token = payload.auth?.client_token
  const leaseDuration = payload.auth?.lease_duration ?? 60

  if (!token) {
    throw new VaultUnavailableError('Vault response did not include client token', {
      retryAfter: 30,
      cause: payload
    })
  }

  const ttlMs = Math.max(leaseDuration - 5, 1) * 1000
  tokenCache.set(cacheKey, {
    token,
    expiresAt: Date.now() + ttlMs
  })

  options.auditLogger?.info('vault_auth_success', {
    driver: 'hashicorp-vault',
    authMount: mount
  })

  return token
}

function extractSecretValue(payload: unknown, field: string | undefined): string | undefined {
  if (!payload) {
    return undefined
  }

  if (typeof payload === 'string' && !field) {
    return payload
  }

  if (typeof payload !== 'object') {
    return undefined
  }

  const dataSection = (payload as Record<string, unknown>).data

  if (field) {
    if (dataSection && typeof dataSection === 'object' && field in dataSection) {
      const candidate = (dataSection as Record<string, unknown>)[field]
      if (typeof candidate === 'string') {
        return candidate
      }
      if (candidate && typeof candidate === 'object') {
        return JSON.stringify(candidate)
      }
    }

    if (field in (payload as Record<string, unknown>)) {
      const candidate = (payload as Record<string, unknown>)[field]
      if (typeof candidate === 'string') {
        return candidate
      }
      if (candidate && typeof candidate === 'object') {
        return JSON.stringify(candidate)
      }
    }

    return undefined
  }

  if (dataSection && typeof dataSection === 'object') {
    return JSON.stringify(dataSection)
  }

  return JSON.stringify(payload)
}

export async function fetchVaultSecretString(options: VaultSecretFetchOptions): Promise<string | undefined> {
  const cacheKey = resolveSecretCacheKey(options)
  const ttlSeconds = options.cacheTtlSeconds ?? 60
  const cached = secretCache.get(cacheKey)

  if (cached && cached.expiresAt > Date.now()) {
    options.auditLogger?.info('vault_secret_cache_hit', {
      driver: 'hashicorp-vault',
      secretIdHash: hashIdentifier(options.secretPath)
    })
    return cached.value
  }

  const deduped = inFlightSecretLookups.get(cacheKey)
  if (deduped) {
    return deduped
  }

  const lookup = (async () => {
    const identifierHash = hashIdentifier(options.secretPath)

    try {
      const token = await authenticate(options)

      const url = new URL(`/v1/${options.secretPath}`, options.address)
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'X-Vault-Token': token
      }

      if (options.namespace) {
        headers['X-Vault-Namespace'] = options.namespace
      }

      const response = await fetch(url, { headers })

      if (!response.ok) {
        options.auditLogger?.error('vault_secret_fetch_failed', {
          driver: 'hashicorp-vault',
          secretIdHash: identifierHash,
          status: response.status
        })
        throw new VaultUnavailableError('Vault secret fetch failed', {
          retryAfter: 15,
          cause: new Error(`unexpected_status_${response.status}`)
        })
      }

      const payload = await response.json()
      const value = extractSecretValue(payload, options.field)

      setSecretCache(cacheKey, value, ttlSeconds)

      options.auditLogger?.info('vault_secret_fetch_success', {
        driver: 'hashicorp-vault',
        secretIdHash: identifierHash
      })

      return value
    } catch (error) {
      const retryAfterSeconds = Math.min(ttlSeconds, 30)
      setSecretCache(cacheKey, undefined, retryAfterSeconds)

      if (error instanceof VaultUnavailableError) {
        options.auditLogger?.error('vault_secret_fetch_error', {
          driver: 'hashicorp-vault',
          secretIdHash: hashIdentifier(options.secretPath),
          retryAfterSeconds: error.retryAfter
        })
        throw error
      }

      options.auditLogger?.error('vault_secret_fetch_error', {
        driver: 'hashicorp-vault',
        secretIdHash: hashIdentifier(options.secretPath),
        error
      })

      throw new VaultUnavailableError('Unexpected Vault error during secret retrieval', {
        retryAfter: retryAfterSeconds,
        cause: error
      })
    } finally {
      inFlightSecretLookups.delete(cacheKey)
    }
  })()

  inFlightSecretLookups.set(cacheKey, lookup)
  return lookup
}

function setSecretCache(key: string, value: string | undefined, ttlSeconds: number): void {
  const ttl = Math.max(1, ttlSeconds)
  secretCache.set(key, {
    value,
    expiresAt: Date.now() + ttl * 1000
  })
}

export function resetVaultSecretsCacheForTests(): void {
  tokenCache.clear()
  secretCache.clear()
  inFlightSecretLookups.clear()
}
