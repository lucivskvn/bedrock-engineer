import { createCategoryLogger } from '../../../common/logger'
import { describeError } from '../api-error-response'
import { storeReady } from '../../../preload/store'
import {
  HEALTH_STATUS,
  HEALTH_ISSUES,
  HEALTH_COMPONENT_KEYS
} from '../../../common/health'
import type { HealthComponentReport } from '../../../common/health'

const healthLogger = createCategoryLogger('api:health')

let storeStatus: (typeof HEALTH_STATUS)[keyof typeof HEALTH_STATUS] = HEALTH_STATUS.INITIALIZING
let storeIssues: Set<(typeof HEALTH_ISSUES)[keyof typeof HEALTH_ISSUES]> = new Set([
  HEALTH_ISSUES.CONFIG_STORE_INITIALIZING
])
let storeMetadata: Record<string, unknown> | undefined

storeReady
  .then(() => {
    storeStatus = HEALTH_STATUS.OK
    storeIssues = new Set()
    storeMetadata = undefined
  })
  .catch((error) => {
    storeStatus = HEALTH_STATUS.ERROR
    storeIssues = new Set([HEALTH_ISSUES.CONFIG_STORE_UNAVAILABLE])
    storeMetadata = { error: describeError(error) }
    healthLogger.error('Configuration store failed to initialize', {
      error: storeMetadata.error
    })
  })

export function getConfigStoreHealthComponent(): HealthComponentReport {
  return {
    status: storeStatus,
    issues: storeIssues.size > 0 ? Array.from(storeIssues) : undefined,
    metadata: storeMetadata ? { ...storeMetadata } : undefined
  }
}

export const CONFIG_STORE_COMPONENT_KEY = HEALTH_COMPONENT_KEYS.CONFIG_STORE
