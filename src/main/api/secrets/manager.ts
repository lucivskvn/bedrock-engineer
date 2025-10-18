import { createCategoryLogger } from '../../../common/logger'
import { recordSecretProviderFailure } from '../observability/metrics'
import type { SecretsAuditLogger } from './types'
import {
  AwsSecretsManagerUnavailableError,
  fetchAwsSecretString,
  type AwsSecretFetchOptions,
  resetAwsSecretsCacheForTests
} from './aws'
import { fetchVaultSecretString, type VaultSecretFetchOptions, VaultUnavailableError, resetVaultSecretsCacheForTests } from './vault'

export type SecretsDriver = 'aws-secrets-manager' | 'hashicorp-vault'

export class SecretProviderUnavailableError extends Error {
  public readonly retryAfter: number

  constructor(message: string, options: { retryAfter: number; cause?: unknown }) {
    super(message)
    this.name = 'SecretProviderUnavailableError'
    this.retryAfter = options.retryAfter
    if (options.cause) {
      this.cause = options.cause
    }
  }
}

const auditLogger: SecretsAuditLogger = createCategoryLogger('security:audit')

export interface AwsSecretProviderOptions extends AwsSecretFetchOptions {
  driver: 'aws-secrets-manager'
}

export interface VaultSecretProviderOptions extends VaultSecretFetchOptions {
  driver: 'hashicorp-vault'
}

export type SecretProviderOptions = AwsSecretProviderOptions | VaultSecretProviderOptions

export async function fetchSecretString(options: SecretProviderOptions): Promise<string | undefined> {
  if (options.driver === 'aws-secrets-manager') {
    try {
      return await fetchAwsSecretString({
        ...options,
        auditLogger
      })
    } catch (error) {
      if (error instanceof AwsSecretsManagerUnavailableError) {
        recordSecretProviderFailure('aws-secrets-manager', 'unavailable')
        throw new SecretProviderUnavailableError(error.message, {
          retryAfter: error.retryAfter,
          cause: error.cause
        })
      }
      recordSecretProviderFailure('aws-secrets-manager', 'unexpected_error')
      throw error
    }
  }

  try {
    const vaultOptions: VaultSecretFetchOptions = {
      ...options,
      auditLogger
    }
    return await fetchVaultSecretString(vaultOptions)
  } catch (error) {
    if (error instanceof VaultUnavailableError) {
      recordSecretProviderFailure('hashicorp-vault', 'unavailable')
      throw new SecretProviderUnavailableError(error.message, {
        retryAfter: error.retryAfter,
        cause: error.cause
      })
    }
    recordSecretProviderFailure('hashicorp-vault', 'unexpected_error')
    throw error
  }
}

export function resetSecretProviderCachesForTests(): void {
  resetAwsSecretsCacheForTests()
  resetVaultSecretsCacheForTests()
}

export type { VaultAuthConfig } from './vault'
