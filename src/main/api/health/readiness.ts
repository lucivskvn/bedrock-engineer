import { OVERALL_HEALTH_STATUS } from '../../../common/health'
import type { OverallHealthStatus } from '../../../common/health'
import { storeReady } from '../../../preload/store'
import { buildHealthReport } from './report'
import { describeError } from '../api-error-response'

export interface ReadinessDependencyStatus {
  name: string
  status: 'ready' | 'initializing' | 'error'
  issues?: string[]
}

export interface ReadinessReport {
  status: 'ready' | 'degraded' | 'initializing'
  dependencies: ReadinessDependencyStatus[]
  healthStatus: OverallHealthStatus
}

export const buildReadinessReport = async (): Promise<ReadinessReport> => {
  const dependencies: ReadinessDependencyStatus[] = []
  let overallStatus: ReadinessReport['status'] = 'ready'

  try {
    await storeReady
    dependencies.push({ name: 'configuration_store', status: 'ready' })
  } catch (error) {
    const description = describeError(error)
    const issueLabel = typeof description.name === 'string' ? description.name : 'store_unavailable'
    dependencies.push({
      name: 'configuration_store',
      status: 'error',
      issues: [issueLabel]
    })
    overallStatus = 'initializing'
  }

  const health = await buildHealthReport()
  const healthStatus = health.status

  if (healthStatus === OVERALL_HEALTH_STATUS.ERROR) {
    overallStatus = 'initializing'
  } else if (healthStatus === OVERALL_HEALTH_STATUS.DEGRADED && overallStatus === 'ready') {
    overallStatus = 'degraded'
  }

  return {
    status: overallStatus,
    dependencies,
    healthStatus
  }
}
