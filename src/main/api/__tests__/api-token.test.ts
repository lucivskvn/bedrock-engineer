import { beforeEach, describe, expect, jest, test } from '@jest/globals'
import { createHash } from 'node:crypto'
import { HEALTH_ISSUES, HEALTH_STATUS } from '../../../common/health'
import { API_PERMISSIONS } from '../auth/rbac'

const mockLogger = {
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn()
}

type StoreMock = {
  get: jest.MockedFunction<(key: string) => unknown>
}

const strongToken = 'A'.repeat(64)

function createStoreMock(initialValue: unknown): StoreMock {
  const getter = jest.fn((key: string) => {
    if (key === 'apiAuthToken') {
      return initialValue
    }
    return undefined
  }) as jest.MockedFunction<(key: string) => unknown>
  return { get: getter }
}

const mockFetchSecretString = jest.fn<(options: unknown) => Promise<string | undefined>>()
const mockRecordSecretProviderFailure = jest.fn()

jest.mock('../../../common/logger', () => ({
  createCategoryLogger: () => mockLogger
}))

jest.mock('../observability/metrics', () => ({
  recordSecretProviderFailure: (...args: unknown[]) => mockRecordSecretProviderFailure(...args)
}))

function mockStoreModule(storeValue: unknown, storeReadyPromise: Promise<void>) {
  jest.doMock('../../../preload/store', () => ({
    store: createStoreMock(storeValue),
    storeReady: storeReadyPromise
  }))
}

jest.mock('../secrets/manager', () => {
  const actual = jest.requireActual('../secrets/manager') as Record<string, unknown>
  return {
    ...actual,
    fetchSecretString: mockFetchSecretString,
    resetSecretProviderCachesForTests: jest.fn()
  }
})

function resetEnv() {
  delete process.env.API_AUTH_TOKEN
  delete process.env.API_AUTH_TOKEN_SHA256
  delete process.env.API_AUTH_TOKEN_ROLE
  delete process.env.API_AUTH_TOKEN_PERMISSIONS
  delete process.env.API_AUTH_STORE_ROLE
  delete process.env.API_AUTH_STORE_PERMISSIONS
  delete process.env.API_AUTH_SECRET_ID
  delete process.env.API_AUTH_SECRET_REGION
  delete process.env.API_AUTH_SECRET_CACHE_SECONDS
  delete process.env.SECRETS_DRIVER
  delete process.env.API_AUTH_SECRET_FIELD
  delete process.env.SECRETS_VAULT_ADDR
  delete process.env.VAULT_ADDR
  delete process.env.SECRETS_VAULT_NAMESPACE
  delete process.env.SECRETS_VAULT_AUTH_METHOD
  delete process.env.SECRETS_VAULT_AUTH_MOUNT
  delete process.env.SECRETS_VAULT_APPROLE_ROLE_ID
  delete process.env.SECRETS_VAULT_APPROLE_SECRET_ID
  delete process.env.SECRETS_VAULT_JWT_ROLE
  delete process.env.SECRETS_VAULT_JWT
  delete process.env.SECRETS_VAULT_JWT_FILE
  delete process.env.SECRETS_VAULT_TOKEN_RENEW_WINDOW_SECONDS
}

async function loadAuthModule() {
  // @ts-expect-error nodeNext module resolution allows extensionless imports in Jest
  // eslint-disable-next-line no-restricted-syntax
  return await import('../auth/api-token')
}

beforeEach(() => {
  jest.resetModules()
  jest.clearAllMocks()
  resetEnv()
  mockFetchSecretString.mockReset()
  mockRecordSecretProviderFailure.mockReset()
})

describe('verifyApiToken', () => {
  test('authenticates strong environment token with admin permissions', async () => {
    process.env.API_AUTH_TOKEN = strongToken
    mockStoreModule(null, Promise.resolve())

    const module = await loadAuthModule()
    const identity = await module.verifyApiToken(strongToken)

    expect(identity).not.toBeNull()
    expect(identity?.role).toBe('admin')
    expect(identity?.permissions.has(API_PERMISSIONS.BEDROCK_CONVERSE_STREAM)).toBe(true)
    expect(await module.hasConfiguredApiTokens()).toBe(true)
    expect(await module.getApiAuthToken()).toBe(strongToken)
  })

  test('authenticates hashed environment token without exposing value', async () => {
    process.env.API_AUTH_TOKEN_SHA256 = createHash('sha256').update(strongToken).digest('hex')
    process.env.API_AUTH_TOKEN_ROLE = 'operator'
    mockStoreModule(null, Promise.resolve())

    const module = await loadAuthModule()
    const identity = await module.verifyApiToken(strongToken)

    expect(identity).not.toBeNull()
    expect(identity?.role).toBe('operator')
    expect(identity?.permissions.has(API_PERMISSIONS.MONITORING_READ)).toBe(true)
    expect(await module.getApiAuthToken()).toBeNull()
    expect(await module.hasConfiguredApiTokens()).toBe(true)
    expect(mockLogger.warn).not.toHaveBeenCalled()
  })

  test('ignores stored token when environment digest override is active', async () => {
    const digestSourceToken = strongToken
    const storedPlainToken = 'B'.repeat(64)
    process.env.API_AUTH_TOKEN_SHA256 = createHash('sha256').update(digestSourceToken).digest('hex')
    mockStoreModule(storedPlainToken, Promise.resolve())

    const module = await loadAuthModule()
    const digestIdentity = await module.verifyApiToken(digestSourceToken)
    const storedIdentity = await module.verifyApiToken(storedPlainToken)

    expect(digestIdentity).not.toBeNull()
    expect(storedIdentity).toBeNull()
    expect(await module.getApiAuthToken()).toBeNull()
    expect(await module.hasConfiguredApiTokens()).toBe(true)
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Stored API auth token ignored due to environment digest override',
      { action: 'remove_store_secret' }
    )
  })

  test('falls back to stored token when environment token is weak', async () => {
    process.env.API_AUTH_TOKEN = 'weak-token'
    mockStoreModule(strongToken, Promise.resolve())

    const module = await loadAuthModule()
    const identity = await module.verifyApiToken(strongToken)

    expect(identity).not.toBeNull()
    expect(identity?.role).toBe('admin')
    expect(mockLogger.warn).toHaveBeenCalledWith('Rejected weak API auth token from environment', {
      minLength: 32
    })
    expect(await module.getApiAuthToken()).toBe(strongToken)
  })

  test('authenticates hashed secret token without exposing value', async () => {
    const hashedToken = createHash('sha256').update(strongToken).digest('hex')
    process.env.API_AUTH_SECRET_ID = 'secret-id'
    process.env.SECRETS_DRIVER = 'aws-secrets-manager'
    mockFetchSecretString.mockResolvedValue(
      JSON.stringify({ tokens: [{ sha256: hashedToken, role: 'operator' }] })
    )
    mockStoreModule(null, Promise.resolve())

    const module = await loadAuthModule()

    expect(await module.getApiAuthToken()).toBeNull()
    expect(await module.hasConfiguredApiTokens()).toBe(true)

    const identity = await module.verifyApiToken(strongToken)
    expect(identity).not.toBeNull()
    expect(identity?.role).toBe('operator')
    expect(identity?.permissions.has(API_PERMISSIONS.MONITORING_READ)).toBe(true)
    expect(mockFetchSecretString).toHaveBeenCalledWith(
      expect.objectContaining({ driver: 'aws-secrets-manager', secretId: 'secret-id' })
    )
  })

  test('authenticates hashed secret token fetched from Vault', async () => {
    const hashedToken = createHash('sha256').update(strongToken).digest('hex')
    process.env.API_AUTH_SECRET_ID = 'kv/data/api'
    process.env.SECRETS_DRIVER = 'hashicorp-vault'
    process.env.SECRETS_VAULT_ADDR = 'https://vault.internal'
    process.env.SECRETS_VAULT_APPROLE_ROLE_ID = 'role-id'
    process.env.SECRETS_VAULT_APPROLE_SECRET_ID = 'secret-id'
    mockFetchSecretString.mockImplementation(async (options) => {
      expect(options).toMatchObject({
        driver: 'hashicorp-vault',
        secretPath: 'kv/data/api',
        address: 'https://vault.internal',
        auth: {
          method: 'approle',
          roleId: 'role-id',
          secretId: 'secret-id'
        }
      })
      return JSON.stringify({ tokens: [{ sha256: hashedToken, role: 'observer' }] })
    })
    mockStoreModule(null, Promise.resolve())

    const module = await loadAuthModule()
    const identity = await module.verifyApiToken(strongToken)

    expect(identity).not.toBeNull()
    expect(identity?.role).toBe('observer')
    expect(identity?.permissions.has(API_PERMISSIONS.MONITORING_READ)).toBe(true)
    expect(mockFetchSecretString).toHaveBeenCalledWith(
      expect.objectContaining({ driver: 'hashicorp-vault', secretPath: 'kv/data/api' })
    )
    expect(mockLogger.error).not.toHaveBeenCalled()
  })
})

describe('getApiAuthTokenHealthComponent', () => {
  test('reports ok status when environment token is available', async () => {
    process.env.API_AUTH_TOKEN = strongToken
    mockStoreModule(null, Promise.resolve())

    const module = await loadAuthModule()
    const health = await module.getApiAuthTokenHealthComponent()

    expect(health.status).toBe(HEALTH_STATUS.OK)
    expect(health.issues).toBeUndefined()
    expect(health.metadata?.sources).toContain('env')
  })

  test('reports error when store readiness fails', async () => {
    const rejection = Promise.reject(new Error('store failed'))
    rejection.catch(() => undefined)
    mockStoreModule(null, rejection)

    const module = await loadAuthModule()
    const health = await module.getApiAuthTokenHealthComponent()

    expect(health.status).toBe(HEALTH_STATUS.ERROR)
    expect(health.issues).toContain(HEALTH_ISSUES.API_AUTH_TOKEN_STORE_UNAVAILABLE)
    expect(health.metadata?.storeStatus).toBe('error')
  })

  test('reports secret availability issues when secret manager call fails', async () => {
    process.env.API_AUTH_SECRET_ID = 'secret-id'
    process.env.SECRETS_DRIVER = 'aws-secrets-manager'
    mockFetchSecretString.mockRejectedValue(new Error('secret unavailable'))
    mockStoreModule(null, Promise.resolve())

    const module = await loadAuthModule()
    const health = await module.getApiAuthTokenHealthComponent()

    expect(health.status).toBe(HEALTH_STATUS.ERROR)
    expect(health.issues).toEqual(
      expect.arrayContaining([
        HEALTH_ISSUES.API_AUTH_TOKEN_SECRET_UNAVAILABLE,
        HEALTH_ISSUES.API_AUTH_TOKEN_MISSING
      ])
    )
  })

  test('reports degraded health when environment digest is invalid', async () => {
    process.env.API_AUTH_TOKEN_SHA256 = 'not-a-digest'
    mockStoreModule(null, Promise.resolve())

    const module = await loadAuthModule()
    const health = await module.getApiAuthTokenHealthComponent()

    expect(health.status).toBe(HEALTH_STATUS.DEGRADED)
    expect(health.issues).toEqual(
      expect.arrayContaining([
        HEALTH_ISSUES.API_AUTH_TOKEN_WEAK,
        HEALTH_ISSUES.API_AUTH_TOKEN_MISSING
      ])
    )
    expect(health.metadata?.weakSources).toContain('env')
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Rejected invalid API auth token digest from environment',
      expect.objectContaining({ expectedFormat: 'hex_sha256', providedLength: 12 })
    )
  })

  test('reports stored token conflict when digest override is configured', async () => {
    const digestSourceToken = strongToken
    const storedPlainToken = 'B'.repeat(64)
    process.env.API_AUTH_TOKEN_SHA256 = createHash('sha256').update(digestSourceToken).digest('hex')
    mockStoreModule(storedPlainToken, Promise.resolve())

    const module = await loadAuthModule()
    const health = await module.getApiAuthTokenHealthComponent()

    expect(health.status).toBe(HEALTH_STATUS.DEGRADED)
    expect(health.issues).toEqual(
      expect.arrayContaining([HEALTH_ISSUES.API_AUTH_TOKEN_WEAK])
    )
    expect(health.metadata?.weakSources).toContain('store')
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Stored API auth token ignored due to environment digest override',
      { action: 'remove_store_secret' }
    )
  })

  test('suggests AWS secrets driver when configuration is missing', async () => {
    const hashedToken = createHash('sha256').update(strongToken).digest('hex')
    process.env.API_AUTH_SECRET_ID = 'secret-id'
    mockFetchSecretString.mockResolvedValue(
      JSON.stringify({ tokens: [{ sha256: hashedToken, role: 'operator' }] })
    )
    mockStoreModule(null, Promise.resolve())

    const module = await loadAuthModule()
    const health = await module.getApiAuthTokenHealthComponent()

    expect(mockFetchSecretString).not.toHaveBeenCalled()
    expect(health.status).toBe(HEALTH_STATUS.ERROR)
    expect(health.metadata?.secretDriver).toBeNull()
    expect(health.metadata?.secretStatus).toBe('error')
    expect(health.metadata?.suggestedSecretDriver).toBe('aws-secrets-manager')
    expect(health.metadata?.suggestedSecretDriverReason).toBe('aws_configuration_detected')
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Secrets driver not configured for API auth token retrieval',
      expect.objectContaining({ secretIdHash: expect.any(String) })
    )
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Secrets driver not configured; detected potential secret manager configuration',
      expect.objectContaining({
        detectedDriver: 'aws-secrets-manager',
        detectionReason: 'aws_configuration_detected'
      })
    )
  })

  test('suggests Vault secrets driver when Vault configuration is present', async () => {
    const hashedToken = createHash('sha256').update(strongToken).digest('hex')
    process.env.API_AUTH_SECRET_ID = 'kv/data/api'
    process.env.SECRETS_VAULT_ADDR = 'https://vault.internal'
    process.env.SECRETS_VAULT_APPROLE_ROLE_ID = 'role-id'
    process.env.SECRETS_VAULT_APPROLE_SECRET_ID = 'secret-id'
    mockFetchSecretString.mockResolvedValue(
      JSON.stringify({ tokens: [{ sha256: hashedToken, role: 'observer' }] })
    )
    mockStoreModule(null, Promise.resolve())

    const module = await loadAuthModule()
    const health = await module.getApiAuthTokenHealthComponent()

    expect(mockFetchSecretString).not.toHaveBeenCalled()
    expect(health.status).toBe(HEALTH_STATUS.ERROR)
    expect(health.metadata?.secretDriver).toBeNull()
    expect(health.metadata?.secretStatus).toBe('error')
    expect(health.metadata?.suggestedSecretDriver).toBe('hashicorp-vault')
    expect(health.metadata?.suggestedSecretDriverReason).toBe('vault_configuration_detected')
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Secrets driver not configured for API auth token retrieval',
      expect.objectContaining({ secretIdHash: expect.any(String) })
    )
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Secrets driver not configured; detected potential secret manager configuration',
      expect.objectContaining({
        detectedDriver: 'hashicorp-vault',
        detectionReason: 'vault_configuration_detected'
      })
    )
  })

  test('reports secret configuration issue when vault settings are incomplete', async () => {
    process.env.API_AUTH_SECRET_ID = 'secret-id'
    process.env.SECRETS_DRIVER = 'vault'
    mockStoreModule(null, Promise.resolve())

    const module = await loadAuthModule()
    const health = await module.getApiAuthTokenHealthComponent()

    expect(mockFetchSecretString).not.toHaveBeenCalled()
    expect(health.status).toBe(HEALTH_STATUS.ERROR)
    expect(health.issues).toEqual(
      expect.arrayContaining([
        HEALTH_ISSUES.API_AUTH_TOKEN_SECRET_UNAVAILABLE,
        HEALTH_ISSUES.API_AUTH_TOKEN_SECRET_CONFIGURATION_INVALID
      ])
    )
    expect(health.metadata?.secretStatus).toBe('error')
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Vault secrets configuration invalid for API auth tokens',
      expect.objectContaining({ reason: 'vault_address_missing' })
    )
    expect(mockRecordSecretProviderFailure).toHaveBeenCalledWith('hashicorp-vault', 'configuration_invalid')
  })

  test('reports ok status when vault secret provides token definitions', async () => {
    const hashedToken = createHash('sha256').update(strongToken).digest('hex')
    process.env.API_AUTH_SECRET_ID = 'kv/data/api'
    process.env.SECRETS_DRIVER = 'vault'
    process.env.SECRETS_VAULT_ADDR = 'https://vault.internal'
    process.env.SECRETS_VAULT_APPROLE_ROLE_ID = 'role-id'
    process.env.SECRETS_VAULT_APPROLE_SECRET_ID = 'secret-id'
    mockFetchSecretString.mockResolvedValue(
      JSON.stringify({ tokens: [{ sha256: hashedToken, role: 'operator' }] })
    )
    mockStoreModule(null, Promise.resolve())

    const module = await loadAuthModule()
    const health = await module.getApiAuthTokenHealthComponent()

    expect(health.status).toBe(HEALTH_STATUS.OK)
    expect(health.issues).toBeUndefined()
    expect(health.metadata?.secretDriver).toBe('hashicorp-vault')
    expect(health.metadata?.sources).toContain('secret')
    expect(mockRecordSecretProviderFailure).not.toHaveBeenCalled()
    expect(mockLogger.error).not.toHaveBeenCalled()
  })
})
