import { createCategoryLogger } from '../../../common/logger'
import {
  HEALTH_STATUS,
  HEALTH_COMPONENT_KEYS,
  OVERALL_HEALTH_STATUS,
  type OverallHealthStatus,
  type HealthComponentReport,
  type HealthReport
} from '../../../common/health'
import { getApiAuthTokenHealthComponent, API_AUTH_COMPONENT_KEY } from '../auth/api-token'
import { getConfigStoreHealthComponent, CONFIG_STORE_COMPONENT_KEY } from './store-status'

const healthLogger = createCategoryLogger('api:health')

function resolveOverallStatus(components: HealthComponentReport[]): OverallHealthStatus {
  if (components.some((component) => component.status === HEALTH_STATUS.ERROR)) {
    return OVERALL_HEALTH_STATUS.ERROR
  }

  if (
    components.some((component) =>
      component.status === HEALTH_STATUS.DEGRADED || component.status === HEALTH_STATUS.INITIALIZING
    )
  ) {
    return OVERALL_HEALTH_STATUS.DEGRADED
  }

  return OVERALL_HEALTH_STATUS.OK
}

function summarizeComponent(component: HealthComponentReport & { key: string }) {
  return {
    key: component.key,
    status: component.status,
    issueCount: component.issues?.length ?? 0
  }
}

export async function buildHealthReport(): Promise<HealthReport> {
  const components = {
    [CONFIG_STORE_COMPONENT_KEY]: getConfigStoreHealthComponent(),
    [API_AUTH_COMPONENT_KEY]: await getApiAuthTokenHealthComponent()
  }

  const componentList: Array<HealthComponentReport & { key: string }> = Object.entries(components).map(
    ([key, value]) => ({
      key,
      ...value
    })
  )

  const status = resolveOverallStatus(componentList)

  if (status === OVERALL_HEALTH_STATUS.ERROR) {
    healthLogger.error('Health check detected critical failure', {
      components: componentList.map(summarizeComponent)
    })
  } else if (status === OVERALL_HEALTH_STATUS.DEGRADED) {
    healthLogger.warn('Health check detected degraded state', {
      components: componentList.map(summarizeComponent)
    })
  } else {
    healthLogger.debug('Health check completed successfully', {
      components: componentList.map(summarizeComponent)
    })
  }

  return {
    status,
    timestamp: new Date().toISOString(),
    uptimeMs: Math.round(process.uptime() * 1000),
    components
  }
}

export const HEALTH_COMPONENT_ORDER = [
  HEALTH_COMPONENT_KEYS.CONFIG_STORE,
  HEALTH_COMPONENT_KEYS.API_AUTH_TOKEN
] as const
