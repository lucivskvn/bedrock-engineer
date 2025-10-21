import type { HealthStatus, HealthComponentKey, HealthIssueCode, OverallHealthStatus } from './constants'

export interface HealthComponentReport {
  status: HealthStatus
  issues?: HealthIssueCode[]
  metadata?: Record<string, unknown>
}

export type HealthComponentMap = Record<HealthComponentKey, HealthComponentReport>

export interface HealthReport {
  status: OverallHealthStatus
  timestamp: string
  uptimeMs: number
  components: HealthComponentMap
}
