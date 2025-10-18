import { beforeEach, describe, expect, jest, test } from '@jest/globals'
import { HEALTH_STATUS, OVERALL_HEALTH_STATUS } from '../../../common/health'
import type { HealthComponentReport } from '../../../common/health'

const mockLogger = {
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  verbose: jest.fn()
}

jest.mock('../../../common/logger', () => ({
  createCategoryLogger: () => mockLogger
}))

const mockConfigStore = jest.fn() as jest.MockedFunction<() => HealthComponentReport>
const mockApiToken = jest.fn() as jest.MockedFunction<() => Promise<HealthComponentReport>>

jest.mock('../health/store-status', () => ({
  getConfigStoreHealthComponent: () => mockConfigStore(),
  CONFIG_STORE_COMPONENT_KEY: 'configStore'
}))

jest.mock('../auth/api-token', () => ({
  getApiAuthTokenHealthComponent: () => mockApiToken(),
  API_AUTH_COMPONENT_KEY: 'apiAuthToken'
}))

async function loadHealthReportModule() {
  // @ts-expect-error nodeNext module resolution allows extensionless imports in Jest
  // eslint-disable-next-line no-restricted-syntax
  return await import('../health/report')
}

describe('buildHealthReport', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockConfigStore.mockReset()
    mockApiToken.mockReset()
  })

  test('returns ok status when all components are healthy', async () => {
    mockConfigStore.mockReturnValue({ status: HEALTH_STATUS.OK })
    mockApiToken.mockResolvedValue({ status: HEALTH_STATUS.OK })

    const { buildHealthReport } = await loadHealthReportModule()
    const report = await buildHealthReport()

    expect(report.status).toBe(OVERALL_HEALTH_STATUS.OK)
    expect(mockLogger.debug).toHaveBeenCalledWith('Health check completed successfully', {
      components: [
        expect.objectContaining({ key: 'configStore', status: HEALTH_STATUS.OK }),
        expect.objectContaining({ key: 'apiAuthToken', status: HEALTH_STATUS.OK })
      ]
    })
  })

  test('returns degraded status when a component is initializing', async () => {
    mockConfigStore.mockReturnValue({ status: HEALTH_STATUS.INITIALIZING })
    mockApiToken.mockResolvedValue({ status: HEALTH_STATUS.OK })

    const { buildHealthReport } = await loadHealthReportModule()
    const report = await buildHealthReport()

    expect(report.status).toBe(OVERALL_HEALTH_STATUS.DEGRADED)
    expect(mockLogger.warn).toHaveBeenCalledWith('Health check detected degraded state', {
      components: expect.any(Array)
    })
  })

  test('returns error status when a component reports failure', async () => {
    mockConfigStore.mockReturnValue({ status: HEALTH_STATUS.ERROR, issues: ['config_store_unavailable'] })
    mockApiToken.mockResolvedValue({ status: HEALTH_STATUS.OK })

    const { buildHealthReport } = await loadHealthReportModule()
    const report = await buildHealthReport()

    expect(report.status).toBe(OVERALL_HEALTH_STATUS.ERROR)
    expect(mockLogger.error).toHaveBeenCalledWith('Health check detected critical failure', {
      components: expect.any(Array)
    })
  })
})
