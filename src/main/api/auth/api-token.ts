import { createHash, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { createCategoryLogger } from '../../../common/logger'
import { HEALTH_COMPONENT_KEYS, HEALTH_ISSUES, HEALTH_STATUS } from '../../../common/health'
import type { HealthComponentReport, HealthStatus } from '../../../common/health'
import {
  MIN_API_TOKEN_LENGTH,
  normalizeApiToken,
  parseSha256Digest,
  SHA256_DIGEST_PATTERN
} from '../../../common/security'
import { store, storeReady } from '../../../preload/store'
import { describeError } from '../api-error-response'
import type { ApiPermission, ApiRole, AuthorisedIdentitySummary } from './rbac'
import { resolvePermissionsForRole } from './rbac'
import {
  fetchSecretString,
  SecretProviderUnavailableError,
  type SecretsDriver,
  type VaultAuthConfig,
  type VaultSecretProviderOptions
} from '../secrets/manager'
import { recordSecretProviderFailure } from '../observability/metrics'

const authLogger = createCategoryLogger('api:auth')

export type ApiAuthTokenSource = 'env' | 'store' | 'secret'
type StoreAvailability = 'ok' | 'error' | 'skipped'
type SecretAvailability = 'ok' | 'error' | 'skipped'

type HealthIssueCode = (typeof HEALTH_ISSUES)[keyof typeof HEALTH_ISSUES]

interface TokenRecord {
  fingerprint: string
  role: ApiRole
  permissions: Set<ApiPermission>
  source: ApiAuthTokenSource
  exposeValue?: string
  matches(candidate: string): boolean
}

interface TokenResolution {
  tokens: TokenRecord[]
  weakSources: ApiAuthTokenSource[]
  storeStatus: StoreAvailability
  secretStatus: SecretAvailability
  secretDriver: SecretsDriver | null
  suggestedSecretDriver: SecretsDriver | null
  suggestedSecretDriverReason?: DetectedSecretsDriverReason
  storeError?: Record<string, unknown>
  secretError?: Record<string, unknown>
  issues: Set<HealthIssueCode>
  unknownRoles: string[]
  unknownPermissions: string[]
  resolvedAt: number
}

const TOKEN_CACHE_TTL_MS = 5_000

let lastResolution: TokenResolution | null = null
let envTokenWarningEmitted = false
let storedTokenWarningEmitted = false
let storeErrorLogged = false
let secretPayloadWarningEmitted = false
let envTokenDigestWarningEmitted = false
let storedTokenDigestOverrideWarningEmitted = false
let secretsDriverMissingLogged = false
let secretsDriverSuggestionLogged = false
const vaultConfigErrorReasons = new Set<string>()

function normaliseSecretsDriver(value: string | undefined): string | null {
  if (!value) {
    return null
  }

  const normalised = value.trim().toLowerCase()
  return normalised.length > 0 ? normalised : null
}

type DetectedSecretsDriverReason = 'vault_configuration_detected' | 'aws_configuration_detected'

interface DetectedSecretsDriver {
  driver: SecretsDriver
  reason: DetectedSecretsDriverReason
}

function getTrimmedEnv(name: string): string | null {
  const value = process.env[name]
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function detectSecretsDriverFromEnvironment(): DetectedSecretsDriver | null {
  const vaultSignals = [
    getTrimmedEnv('SECRETS_VAULT_ADDR'),
    getTrimmedEnv('VAULT_ADDR'),
    getTrimmedEnv('SECRETS_VAULT_NAMESPACE'),
    getTrimmedEnv('SECRETS_VAULT_APPROLE_ROLE_ID'),
    getTrimmedEnv('SECRETS_VAULT_APPROLE_SECRET_ID'),
    getTrimmedEnv('SECRETS_VAULT_JWT_ROLE'),
    getTrimmedEnv('SECRETS_VAULT_JWT'),
    getTrimmedEnv('SECRETS_VAULT_JWT_FILE')
  ]

  if (vaultSignals.some(Boolean)) {
    return { driver: 'hashicorp-vault', reason: 'vault_configuration_detected' }
  }

  const awsSignals = [
    getTrimmedEnv('API_AUTH_SECRET_REGION'),
    getTrimmedEnv('API_AUTH_SECRET_ENDPOINT'),
    getTrimmedEnv('AWS_REGION'),
    getTrimmedEnv('AWS_ROLE_TO_ASSUME'),
    getTrimmedEnv('AWS_ACCESS_KEY_ID'),
    getTrimmedEnv('AWS_SECRET_ACCESS_KEY'),
    getTrimmedEnv('AWS_SESSION_TOKEN')
  ]

  if (awsSignals.some(Boolean)) {
    return { driver: 'aws-secrets-manager', reason: 'aws_configuration_detected' }
  }

  const secretId = getTrimmedEnv('API_AUTH_SECRET_ID')
  if (!secretId) {
    return null
  }

  if (secretId.startsWith('arn:aws:')) {
    return { driver: 'aws-secrets-manager', reason: 'aws_configuration_detected' }
  }

  const segments = secretId
    .toLowerCase()
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]

    if (segment.startsWith('kv')) {
      return { driver: 'hashicorp-vault', reason: 'vault_configuration_detected' }
    }

    if (segment === 'cubbyhole' || segment === 'sys' || segment === 'database' || segment === 'transit') {
      return { driver: 'hashicorp-vault', reason: 'vault_configuration_detected' }
    }

    if (
      segment === 'secret' &&
      index + 1 < segments.length &&
      (segments[index + 1] === 'data' || segments[index + 1] === 'metadata')
    ) {
      return { driver: 'hashicorp-vault', reason: 'vault_configuration_detected' }
    }
  }

  return { driver: 'aws-secrets-manager', reason: 'aws_configuration_detected' }
}

function resolveSecretsDriver(value: string | null): SecretsDriver | null {
  if (!value) {
    return null
  }

  if (value === 'aws-secrets-manager' || value === 'aws') {
    return 'aws-secrets-manager'
  }

  if (value === 'hashicorp-vault' || value === 'vault') {
    return 'hashicorp-vault'
  }

  return null
}

const SecretTokenEntrySchema = z
  .object({
    token: z
      .string()
      .min(MIN_API_TOKEN_LENGTH)
      .transform((value) => value.trim())
      .optional(),
    sha256: z
      .string()
      .regex(SHA256_DIGEST_PATTERN)
      .transform((value) => value.toLowerCase())
      .optional(),
    role: z
      .string()
      .min(1)
      .transform((value) => value.trim()),
    permissions: z.array(z.string().min(1)).optional()
  })
  .refine((value) => !!value.token || !!value.sha256, {
    message: 'token or sha256 is required'
  })

const SecretPayloadSchema = z.object({
  tokens: z.array(SecretTokenEntrySchema).min(1),
  roles: z.record(z.string().min(1), z.array(z.string().min(1))).optional()
})
function computeFingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function isWeakTokenCandidate(value: unknown): value is string {
  return typeof value === 'string'
}

function addWeakSource(target: ApiAuthTokenSource[], source: ApiAuthTokenSource): void {
  if (!target.includes(source)) {
    target.push(source)
  }
}

function sanitisePermissions(values: ReadonlyArray<string> | undefined): string[] {
  if (!values) {
    return []
  }

  return values
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}

function sanitiseRoleOverrides(
  overrides: Record<string, ReadonlyArray<string>> | undefined
): Record<string, ReadonlyArray<string>> | undefined {
  if (!overrides) {
    return undefined
  }

  const result: Record<string, ReadonlyArray<string>> = {}
  for (const [rawRole, permissions] of Object.entries(overrides)) {
    const role = rawRole.trim()
    const cleaned = sanitisePermissions(permissions)
    if (role.length === 0 || cleaned.length === 0) {
      continue
    }
    result[role] = cleaned
  }

  return Object.keys(result).length > 0 ? result : undefined
}

interface SecretTokenResolution {
  records: TokenRecord[]
  status: SecretAvailability
  driver: SecretsDriver | null
  suggestedDriver: SecretsDriver | null
  suggestedDriverReason?: DetectedSecretsDriverReason
  issues: Set<HealthIssueCode>
  secretError?: Record<string, unknown>
  unknownRoles: string[]
  unknownPermissions: string[]
}

function parseSecretCacheTtl(): number | undefined {
  const raw = process.env.API_AUTH_SECRET_CACHE_SECONDS
  if (!raw) {
    return undefined
  }

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    authLogger.warn('Ignoring invalid API_AUTH_SECRET_CACHE_SECONDS override', {
      rawValue: raw
    })
    return undefined
  }

  return Math.min(parsed, 3600)
}

async function loadVaultJwtToken(): Promise<string | null> {
  const inline = process.env.SECRETS_VAULT_JWT?.trim()
  if (inline) {
    return inline
  }

  const filePath = process.env.SECRETS_VAULT_JWT_FILE?.trim()
  if (!filePath) {
    return null
  }

  try {
    const contents = await readFile(filePath, 'utf8')
    const token = contents.trim()
    return token.length > 0 ? token : null
  } catch (error) {
    logVaultConfigError('vault_jwt_file_read_failed', { filePath, error: describeError(error) })
    return null
  }
}

function logVaultConfigError(reason: string, metadata: Record<string, unknown>): void {
  if (vaultConfigErrorReasons.has(reason)) {
    return
  }
  vaultConfigErrorReasons.add(reason)
  authLogger.error('Vault secrets configuration invalid for API auth tokens', {
    reason,
    ...metadata
  })
}

async function resolveVaultAuthConfig(): Promise<VaultAuthConfig | null> {
  const authMethod = normaliseSecretsDriver(process.env.SECRETS_VAULT_AUTH_METHOD) ?? 'approle'

  if (authMethod === 'approle') {
    const roleId = process.env.SECRETS_VAULT_APPROLE_ROLE_ID?.trim()
    const secretId = process.env.SECRETS_VAULT_APPROLE_SECRET_ID?.trim()

    if (!roleId || !secretId) {
      logVaultConfigError('vault_approle_missing_credentials', {})
      return null
    }

    return {
      method: 'approle',
      roleId,
      secretId,
      mount: process.env.SECRETS_VAULT_AUTH_MOUNT?.trim()
    }
  }

  if (authMethod === 'jwt') {
    const role = process.env.SECRETS_VAULT_JWT_ROLE?.trim()
    const jwt = await loadVaultJwtToken()

    if (!role || !jwt) {
      logVaultConfigError('vault_jwt_missing_credentials', { hasRole: Boolean(role), hasJwt: Boolean(jwt) })
      return null
    }

    return {
      method: 'jwt',
      role,
      jwt,
      mount: process.env.SECRETS_VAULT_AUTH_MOUNT?.trim()
    }
  }

  logVaultConfigError('vault_unknown_auth_method', { configured: authMethod })
  return null
}

async function resolveVaultSecretOptions(
  secretPath: string,
  cacheTtlSeconds: number | undefined
): Promise<VaultSecretProviderOptions | null> {
  const address = (process.env.SECRETS_VAULT_ADDR ?? process.env.VAULT_ADDR)?.trim()
  if (!address) {
    logVaultConfigError('vault_address_missing', {})
    return null
  }

  const auth = await resolveVaultAuthConfig()
  if (!auth) {
    return null
  }

  return {
    driver: 'hashicorp-vault',
    address,
    namespace: process.env.SECRETS_VAULT_NAMESPACE?.trim() || undefined,
    secretPath,
    field: process.env.API_AUTH_SECRET_FIELD?.trim() || undefined,
    cacheTtlSeconds,
    renewWindowSeconds: process.env.SECRETS_VAULT_TOKEN_RENEW_WINDOW_SECONDS
      ? Number.parseInt(process.env.SECRETS_VAULT_TOKEN_RENEW_WINDOW_SECONDS, 10) || undefined
      : undefined,
    auth
  }
}

function createPlainTokenRecord(options: {
  token: string
  source: ApiAuthTokenSource
  role: ApiRole
  permissions: Set<ApiPermission>
  exposeValue?: string
}): TokenRecord {
  const expectedBuffer = Buffer.from(options.token, 'utf8')
  const fingerprint = computeFingerprint(options.token)

  return {
    fingerprint,
    role: options.role,
    permissions: new Set(options.permissions),
    source: options.source,
    exposeValue: options.exposeValue,
    matches(candidate: string) {
      const candidateBuffer = Buffer.from(candidate, 'utf8')
      if (candidateBuffer.length !== expectedBuffer.length) {
        return false
      }
      return timingSafeEqual(candidateBuffer, expectedBuffer)
    }
  }
}

function createSha256TokenRecord(options: {
  digest: string
  source: ApiAuthTokenSource
  role: ApiRole
  permissions: Set<ApiPermission>
}): TokenRecord {
  const digestBuffer = Buffer.from(options.digest, 'hex')
  const fingerprint = computeFingerprint(options.digest)

  return {
    fingerprint,
    role: options.role,
    permissions: new Set(options.permissions),
    source: options.source,
    matches(candidate: string) {
      const candidateDigest = createHash('sha256').update(candidate).digest()
      if (candidateDigest.length !== digestBuffer.length) {
        return false
      }
      return timingSafeEqual(candidateDigest, digestBuffer)
    }
  }
}
async function loadSecretTokens(): Promise<SecretTokenResolution> {
  const secretId = process.env.API_AUTH_SECRET_ID
  if (!secretId) {
    return {
      records: [],
      status: 'skipped',
      driver: null,
      suggestedDriver: null,
      issues: new Set(),
      unknownRoles: [],
      unknownPermissions: []
    }
  }

  const explicitDriver = resolveSecretsDriver(normaliseSecretsDriver(process.env.SECRETS_DRIVER))
  const secretIdHash = computeFingerprint(secretId).slice(0, 16)

  const configuredDriver: SecretsDriver | null = explicitDriver
  let autodetectedDriver: DetectedSecretsDriver | null = null

  if (!configuredDriver) {
    autodetectedDriver = detectSecretsDriverFromEnvironment()

    if (!secretsDriverMissingLogged) {
      authLogger.error('Secrets driver not configured for API auth token retrieval', {
        secretIdHash
      })
      secretsDriverMissingLogged = true
    }

    if (autodetectedDriver && !secretsDriverSuggestionLogged) {
      authLogger.warn('Secrets driver not configured; detected potential secret manager configuration', {
        detectedDriver: autodetectedDriver.driver,
        detectionReason: autodetectedDriver.reason,
        secretIdHash
      })
      secretsDriverSuggestionLogged = true
    }

    return {
      records: [],
      status: 'error',
      driver: null,
      suggestedDriver: autodetectedDriver?.driver ?? null,
      suggestedDriverReason: autodetectedDriver?.reason,
      issues: new Set([
        HEALTH_ISSUES.API_AUTH_TOKEN_SECRET_DRIVER_MISSING,
        HEALTH_ISSUES.API_AUTH_TOKEN_SECRET_UNAVAILABLE
      ]),
      secretError: { reason: 'driver_missing' },
      unknownRoles: [],
      unknownPermissions: []
    }
  }

  const cacheTtlSeconds = parseSecretCacheTtl()

  let secretString: string | undefined
  try {
    if (configuredDriver === 'aws-secrets-manager') {
      secretString = await fetchSecretString({
        driver: 'aws-secrets-manager',
        secretId,
        region: process.env.API_AUTH_SECRET_REGION,
        endpoint: process.env.API_AUTH_SECRET_ENDPOINT,
        cacheTtlSeconds
      })
    } else {
      const vaultOptions = await resolveVaultSecretOptions(secretId, cacheTtlSeconds)
      if (!vaultOptions) {
        recordSecretProviderFailure('hashicorp-vault', 'configuration_invalid')
        return {
          records: [],
          status: 'error',
          driver: 'hashicorp-vault',
          suggestedDriver: null,
          issues: new Set([
            HEALTH_ISSUES.API_AUTH_TOKEN_SECRET_CONFIGURATION_INVALID,
            HEALTH_ISSUES.API_AUTH_TOKEN_SECRET_UNAVAILABLE
          ]),
          secretError: { reason: 'vault_configuration_invalid' },
          unknownRoles: [],
          unknownPermissions: []
        }
      }

      secretString = await fetchSecretString(vaultOptions)
    }
  } catch (error) {
    if (error instanceof SecretProviderUnavailableError) {
      return {
        records: [],
        status: 'error',
        driver: configuredDriver,
        suggestedDriver: null,
        issues: new Set([HEALTH_ISSUES.API_AUTH_TOKEN_SECRET_UNAVAILABLE]),
        secretError: { retryAfterSeconds: error.retryAfter },
        unknownRoles: [],
        unknownPermissions: []
      }
    }

    authLogger.error('Secret provider threw unexpected error during API auth token load', {
      driver: configuredDriver,
      error: describeError(error)
    })

    return {
      records: [],
      status: 'error',
      driver: configuredDriver,
      suggestedDriver: null,
      issues: new Set([HEALTH_ISSUES.API_AUTH_TOKEN_SECRET_UNAVAILABLE]),
      secretError: describeError(error),
      unknownRoles: [],
      unknownPermissions: []
    }
  }

  if (!secretString) {
    if (!secretPayloadWarningEmitted) {
      authLogger.warn('Secret provider returned empty payload for API auth token secret', {
        driver: configuredDriver,
        secretIdHash
      })
      secretPayloadWarningEmitted = true
    }
    return {
      records: [],
      status: 'error',
      driver: configuredDriver,
      suggestedDriver: null,
      issues: new Set([HEALTH_ISSUES.API_AUTH_TOKEN_SECRET_UNAVAILABLE]),
      unknownRoles: [],
      unknownPermissions: []
    }
  }

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(secretString)
  } catch (error) {
    if (!secretPayloadWarningEmitted) {
      authLogger.error('Failed to parse API authentication secret payload', {
        driver: configuredDriver,
        secretIdHash,
        error: describeError(error)
      })
      secretPayloadWarningEmitted = true
    }
    return {
      records: [],
      status: 'error',
      driver: configuredDriver,
      suggestedDriver: null,
      issues: new Set([HEALTH_ISSUES.API_AUTH_TOKEN_SECRET_UNAVAILABLE]),
      unknownRoles: [],
      unknownPermissions: []
    }
  }

  const parsed = SecretPayloadSchema.safeParse(parsedJson)
  if (!parsed.success) {
    if (!secretPayloadWarningEmitted) {
      authLogger.error('Secret payload validation failed for API authentication tokens', {
        driver: configuredDriver,
        secretIdHash,
        validationIssues: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.') || '<root>',
          code: issue.code
        }))
      })
      secretPayloadWarningEmitted = true
    }
    return {
      records: [],
      status: 'error',
      driver: configuredDriver,
      suggestedDriver: null,
      issues: new Set([HEALTH_ISSUES.API_AUTH_TOKEN_SECRET_UNAVAILABLE]),
      unknownRoles: [],
      unknownPermissions: []
    }
  }

  const roleOverrides = sanitiseRoleOverrides(parsed.data.roles)
  const records: TokenRecord[] = []
  const issues = new Set<HealthIssueCode>()
  const unknownRoles: string[] = []
  const unknownPermissions: string[] = []

  for (const entry of parsed.data.tokens) {
    const explicitPermissions = sanitisePermissions(entry.permissions)
    const permissionResolution = resolvePermissionsForRole({
      role: entry.role as ApiRole,
      roleOverrides,
      explicitPermissions,
      logger: authLogger
    })

    if (permissionResolution.roleIsUnknown) {
      issues.add(HEALTH_ISSUES.API_AUTH_TOKEN_ROLE_INVALID)
      unknownRoles.push(entry.role)
    }

    if (permissionResolution.unknownPermissions.length > 0) {
      issues.add(HEALTH_ISSUES.API_AUTH_TOKEN_PERMISSIONS_INVALID)
      unknownPermissions.push(...permissionResolution.unknownPermissions)
    }

    if (entry.token) {
      records.push(
        createPlainTokenRecord({
          token: entry.token,
          source: 'secret',
          role: entry.role as ApiRole,
          permissions: permissionResolution.permissions
        })
      )
      continue
    }

    if (entry.sha256) {
      records.push(
        createSha256TokenRecord({
          digest: entry.sha256,
          source: 'secret',
          role: entry.role as ApiRole,
          permissions: permissionResolution.permissions
        })
      )
    }
  }

  return {
    records,
    status: 'ok',
    driver: configuredDriver,
    suggestedDriver: null,
    issues,
    unknownRoles,
    unknownPermissions
  }
}

async function resolveTokenRegistry(): Promise<TokenResolution> {
  const now = Date.now()
  if (lastResolution && now - lastResolution.resolvedAt < TOKEN_CACHE_TTL_MS) {
    return lastResolution
  }

  const tokens: TokenRecord[] = []
  const weakSources: ApiAuthTokenSource[] = []
  let storeStatus: StoreAvailability = 'skipped'
  let secretStatus: SecretAvailability = 'skipped'
  let storeError: Record<string, unknown> | undefined
  const issues = new Set<HealthIssueCode>()
  const unknownRoles: string[] = []
  const unknownPermissions: string[] = []

  const envValue = process.env.API_AUTH_TOKEN
  const envRole = (process.env.API_AUTH_TOKEN_ROLE ?? 'admin').trim() || 'admin'
  const envExplicitPermissions = sanitisePermissions(
    process.env.API_AUTH_TOKEN_PERMISSIONS
      ? process.env.API_AUTH_TOKEN_PERMISSIONS.split(',')
      : undefined
  )
  const envDigest = parseSha256Digest(process.env.API_AUTH_TOKEN_SHA256)
  const normalisedEnvToken = normalizeApiToken(envValue)
  let envTokenDigest: string | null = null
  let exposableEnvToken: string | null = normalisedEnvToken

  if (envDigest) {
    if ('digest' in envDigest) {
      envTokenDigest = envDigest.digest
      exposableEnvToken = null
    } else {
      addWeakSource(weakSources, 'env')
      if (!envTokenDigestWarningEmitted) {
        const metadata: Record<string, unknown> = { expectedFormat: 'hex_sha256' }
        if (typeof envDigest.rawLength === 'number') {
          metadata.providedLength = envDigest.rawLength
        }
        authLogger.warn('Rejected invalid API auth token digest from environment', metadata)
        envTokenDigestWarningEmitted = true
      }
    }
  }

  if (envTokenDigest || exposableEnvToken) {
    const permissionResolution = resolvePermissionsForRole({
      role: envRole as ApiRole,
      explicitPermissions: envExplicitPermissions,
      logger: authLogger
    })

    if (permissionResolution.roleIsUnknown) {
      issues.add(HEALTH_ISSUES.API_AUTH_TOKEN_ROLE_INVALID)
      unknownRoles.push(envRole)
    }

    if (permissionResolution.unknownPermissions.length > 0) {
      issues.add(HEALTH_ISSUES.API_AUTH_TOKEN_PERMISSIONS_INVALID)
      unknownPermissions.push(...permissionResolution.unknownPermissions)
    }

    if (envTokenDigest) {
      tokens.push(
        createSha256TokenRecord({
          digest: envTokenDigest,
          source: 'env',
          role: envRole as ApiRole,
          permissions: permissionResolution.permissions
        })
      )
    }

    if (exposableEnvToken) {
      tokens.push(
        createPlainTokenRecord({
          token: exposableEnvToken,
          source: 'env',
          role: envRole as ApiRole,
          permissions: permissionResolution.permissions,
          exposeValue: exposableEnvToken
        })
      )
    }
  } else if (isWeakTokenCandidate(envValue)) {
    addWeakSource(weakSources, 'env')
    if (!envTokenWarningEmitted) {
      authLogger.warn('Rejected weak API auth token from environment', {
        minLength: MIN_API_TOKEN_LENGTH
      })
      envTokenWarningEmitted = true
    }
  }

  try {
    await storeReady
    storeStatus = 'ok'

    const storedValue = store.get('apiAuthToken')
    const normalisedStoredToken = normalizeApiToken(storedValue)
    const storeRole = (process.env.API_AUTH_STORE_ROLE ?? 'admin').trim() || 'admin'
    const storeExplicitPermissions = sanitisePermissions(
      process.env.API_AUTH_STORE_PERMISSIONS
        ? process.env.API_AUTH_STORE_PERMISSIONS.split(',')
        : undefined
    )

    if (normalisedStoredToken) {
      if (envTokenDigest) {
        addWeakSource(weakSources, 'store')
        if (!storedTokenDigestOverrideWarningEmitted) {
          authLogger.warn('Stored API auth token ignored due to environment digest override', {
            action: 'remove_store_secret'
          })
          storedTokenDigestOverrideWarningEmitted = true
        }
      } else {
        const permissionResolution = resolvePermissionsForRole({
          role: storeRole as ApiRole,
          explicitPermissions: storeExplicitPermissions,
          logger: authLogger
        })

        if (permissionResolution.roleIsUnknown) {
          issues.add(HEALTH_ISSUES.API_AUTH_TOKEN_ROLE_INVALID)
          unknownRoles.push(storeRole)
        }

        if (permissionResolution.unknownPermissions.length > 0) {
          issues.add(HEALTH_ISSUES.API_AUTH_TOKEN_PERMISSIONS_INVALID)
          unknownPermissions.push(...permissionResolution.unknownPermissions)
        }

        tokens.push(
          createPlainTokenRecord({
            token: normalisedStoredToken,
            source: 'store',
            role: storeRole as ApiRole,
            permissions: permissionResolution.permissions,
            exposeValue: normalisedStoredToken
          })
        )
      }
    } else if (isWeakTokenCandidate(storedValue)) {
      addWeakSource(weakSources, 'store')
      if (!storedTokenWarningEmitted) {
        authLogger.warn('Stored API auth token failed strength validation', {
          action: 'issue_new_token'
        })
        storedTokenWarningEmitted = true
      }
    }
  } catch (error) {
    storeStatus = 'error'
    storeError = describeError(error)
    if (!storeErrorLogged) {
      authLogger.error('API auth token unavailable due to store error', {
        error: storeError
      })
      storeErrorLogged = true
    }
  }

  const secretResolution = await loadSecretTokens()
  tokens.push(...secretResolution.records)
  secretStatus = secretResolution.status
  const secretError = secretResolution.secretError
  secretResolution.issues.forEach((issue) => issues.add(issue))
  unknownRoles.push(...secretResolution.unknownRoles)
  unknownPermissions.push(...secretResolution.unknownPermissions)

  lastResolution = {
    tokens,
    weakSources,
    storeStatus,
    secretStatus,
    secretDriver: secretResolution.driver,
    suggestedSecretDriver: secretResolution.suggestedDriver,
    suggestedSecretDriverReason: secretResolution.suggestedDriverReason,
    storeError,
    secretError,
    issues,
    unknownRoles,
    unknownPermissions,
    resolvedAt: now
  }

  return lastResolution
}
export async function hasConfiguredApiTokens(): Promise<boolean> {
  const resolution = await resolveTokenRegistry()
  return resolution.tokens.length > 0
}

export interface ApiAuthIdentity extends AuthorisedIdentitySummary {
  source: ApiAuthTokenSource
  issuedAt: number
}

export async function verifyApiToken(providedToken: string): Promise<ApiAuthIdentity | null> {
  if (!providedToken) {
    return null
  }

  const resolution = await resolveTokenRegistry()
  for (const record of resolution.tokens) {
    if (record.matches(providedToken)) {
      return {
        role: record.role,
        permissions: new Set(record.permissions),
        source: record.source,
        tokenFingerprint: record.fingerprint,
        issuedAt: Date.now()
      }
    }
  }

  return null
}

export async function getApiAuthToken(): Promise<string | null> {
  const resolution = await resolveTokenRegistry()

  if (resolution.storeStatus === 'error') {
    return null
  }

  const exposable = resolution.tokens.find((record) => record.exposeValue)
  return exposable?.exposeValue ?? null
}

export async function getApiAuthTokenHealthComponent(): Promise<HealthComponentReport> {
  const resolution = await resolveTokenRegistry()
  const issues = new Set<HealthIssueCode>(resolution.issues)

  if (resolution.tokens.length === 0) {
    issues.add(HEALTH_ISSUES.API_AUTH_TOKEN_MISSING)
  }

  if (resolution.weakSources.length > 0) {
    issues.add(HEALTH_ISSUES.API_AUTH_TOKEN_WEAK)
  }

  if (resolution.storeStatus === 'error') {
    issues.add(HEALTH_ISSUES.API_AUTH_TOKEN_STORE_UNAVAILABLE)
  }

  if (resolution.secretStatus === 'error') {
    issues.add(HEALTH_ISSUES.API_AUTH_TOKEN_SECRET_UNAVAILABLE)
  }

  let status: HealthStatus = HEALTH_STATUS.OK

  if (issues.has(HEALTH_ISSUES.API_AUTH_TOKEN_STORE_UNAVAILABLE) || issues.has(HEALTH_ISSUES.API_AUTH_TOKEN_SECRET_UNAVAILABLE)) {
    status = HEALTH_STATUS.ERROR
  } else if (issues.size > 0) {
    status = HEALTH_STATUS.DEGRADED
  }

  const metadata: Record<string, unknown> = {
    sources: resolution.tokens.map((record) => record.source),
    weakSources: resolution.weakSources,
    storeStatus: resolution.storeStatus,
    secretStatus: resolution.secretStatus,
    secretDriver: resolution.secretDriver,
    suggestedSecretDriver: resolution.suggestedSecretDriver,
    suggestedSecretDriverReason: resolution.suggestedSecretDriverReason,
    tokenCount: resolution.tokens.length
  }

  if (resolution.storeError) {
    metadata.storeError = resolution.storeError
  }

  if (resolution.secretError) {
    metadata.secretError = resolution.secretError
  }

  if (resolution.unknownRoles.length > 0) {
    metadata.unknownRoles = Array.from(new Set(resolution.unknownRoles))
  }

  if (resolution.unknownPermissions.length > 0) {
    metadata.unknownPermissions = Array.from(new Set(resolution.unknownPermissions))
  }

  return {
    status,
    issues: issues.size > 0 ? Array.from(issues) : undefined,
    metadata
  }
}

export function resetApiAuthTokenCacheForTests(): void {
  lastResolution = null
  envTokenWarningEmitted = false
  storedTokenWarningEmitted = false
  storeErrorLogged = false
  secretPayloadWarningEmitted = false
  envTokenDigestWarningEmitted = false
  storedTokenDigestOverrideWarningEmitted = false
  secretsDriverMissingLogged = false
  secretsDriverSuggestionLogged = false
  vaultConfigErrorReasons.clear()
}

export const API_AUTH_COMPONENT_KEY = HEALTH_COMPONENT_KEYS.API_AUTH_TOKEN
