import { OVERALL_HEALTH_STATUS } from '../../../common/health'

describe('buildReadinessReport', () => {
  afterEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
  })

  it('reports ready status when dependencies succeed', async () => {
    jest.doMock('../../../preload/store', () => ({
      storeReady: Promise.resolve()
    }))

    const buildHealthReport = jest.fn().mockResolvedValue({
      status: OVERALL_HEALTH_STATUS.OK,
      components: {}
    })

    jest.doMock('../health/report', () => ({ buildHealthReport }))

    // @ts-expect-error NodeNext module resolution allows extensionless imports during Jest execution
    const { buildReadinessReport } = await import('../health/readiness') // eslint-disable-line no-restricted-syntax
    const report = await buildReadinessReport()

    expect(report.status).toBe('ready')
    expect(report.healthStatus).toBe(OVERALL_HEALTH_STATUS.OK)
    expect(buildHealthReport).toHaveBeenCalled()
  })

  it('marks initialization when configuration store is unavailable', async () => {
    jest.doMock('../../../preload/store', () => ({
      storeReady: Promise.reject(new Error('store down'))
    }))

    const buildHealthReport = jest.fn().mockResolvedValue({
      status: OVERALL_HEALTH_STATUS.DEGRADED,
      components: {}
    })

    jest.doMock('../health/report', () => ({ buildHealthReport }))

    // @ts-expect-error NodeNext module resolution allows extensionless imports during Jest execution
    const { buildReadinessReport } = await import('../health/readiness') // eslint-disable-line no-restricted-syntax
    const report = await buildReadinessReport()

    expect(report.status).toBe('initializing')
    expect(report.dependencies[0]).toMatchObject({ name: 'configuration_store', status: 'error' })
    expect(report.healthStatus).toBe(OVERALL_HEALTH_STATUS.DEGRADED)
  })
})
