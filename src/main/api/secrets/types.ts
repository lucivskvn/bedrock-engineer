import type { CategoryLogger } from '../../../common/logger'

export type SecretsAuditLogger = Pick<CategoryLogger, 'info' | 'warn' | 'error'>

export interface SecretAuditEventMetadata extends Record<string, unknown> {
  driver: string
  secretIdHash?: string
  event?: string
}
