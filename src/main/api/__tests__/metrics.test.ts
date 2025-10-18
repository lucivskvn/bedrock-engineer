import { getMetricsRegistry, recordHttpRequestMetrics, resetMetricsForTests } from '../observability/metrics'

describe('HTTP metrics', () => {
  beforeEach(() => {
    resetMetricsForTests()
  })

  it('records timing data using normalised labels', async () => {
    recordHttpRequestMetrics({
      method: 'get',
      route: '/healthz',
      statusCode: 200,
      durationMs: 125
    })

    const output = await getMetricsRegistry().metrics()
    expect(output).toContain('bedrock_engineer_http_requests_total')
    expect(output).toContain('method="GET"')
    expect(output).toContain('route="/healthz"')
  })
})
