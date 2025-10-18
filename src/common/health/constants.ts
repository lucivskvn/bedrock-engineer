export const HEALTH_STATUS = {
  INITIALIZING: 'initializing',
  OK: 'ok',
  DEGRADED: 'degraded',
  ERROR: 'error'
} as const

export type HealthStatus = (typeof HEALTH_STATUS)[keyof typeof HEALTH_STATUS]

export const OVERALL_HEALTH_STATUS = {
  OK: HEALTH_STATUS.OK,
  DEGRADED: HEALTH_STATUS.DEGRADED,
  ERROR: HEALTH_STATUS.ERROR
} as const

export type OverallHealthStatus = (typeof OVERALL_HEALTH_STATUS)[keyof typeof OVERALL_HEALTH_STATUS]

export const HEALTH_COMPONENT_KEYS = {
  CONFIG_STORE: 'configStore',
  API_AUTH_TOKEN: 'apiAuthToken'
} as const

export type HealthComponentKey = (typeof HEALTH_COMPONENT_KEYS)[keyof typeof HEALTH_COMPONENT_KEYS]

export const HEALTH_ISSUES = {
  CONFIG_STORE_INITIALIZING: 'config_store_initializing',
  CONFIG_STORE_UNAVAILABLE: 'config_store_unavailable',
  API_AUTH_TOKEN_MISSING: 'api_auth_token_missing',
  API_AUTH_TOKEN_WEAK: 'api_auth_token_weak',
  API_AUTH_TOKEN_STORE_UNAVAILABLE: 'api_auth_token_store_unavailable',
  API_AUTH_TOKEN_SECRET_UNAVAILABLE: 'api_auth_token_secret_unavailable',
  API_AUTH_TOKEN_SECRET_DRIVER_MISSING: 'api_auth_token_secret_driver_missing',
  API_AUTH_TOKEN_SECRET_CONFIGURATION_INVALID: 'api_auth_token_secret_configuration_invalid',
  API_AUTH_TOKEN_ROLE_INVALID: 'api_auth_token_role_invalid',
  API_AUTH_TOKEN_PERMISSIONS_INVALID: 'api_auth_token_permissions_invalid'
} as const

export type HealthIssueCode = (typeof HEALTH_ISSUES)[keyof typeof HEALTH_ISSUES]
