import { createSocketProxyEvaluator, extractFirstIpFromForwardedHeader, normalizeIpAddress } from '../network-utils'

const logger = {
  warn: jest.fn(),
  info: jest.fn()
}

describe('normalizeIpAddress', () => {
  test('normalizes IPv4 addresses', () => {
    expect(normalizeIpAddress('192.168.0.1')).toBe('192.168.0.1')
    expect(normalizeIpAddress(' 192.168.0.1 ')).toBe('192.168.0.1')
  })

  test('normalizes IPv6 and IPv4-mapped addresses', () => {
    expect(normalizeIpAddress('::1')).toBe('::1')
    expect(normalizeIpAddress('[::1]')).toBe('::1')
    expect(normalizeIpAddress('::ffff:127.0.0.1')).toBe('127.0.0.1')
  })

  test('removes ports and zones', () => {
    expect(normalizeIpAddress('192.168.0.1:8080')).toBe('192.168.0.1')
    expect(normalizeIpAddress('fe80::1%eth0')).toBe('fe80::1')
  })

  test('returns null for invalid input', () => {
    expect(normalizeIpAddress('not-an-ip')).toBeNull()
    expect(normalizeIpAddress('')).toBeNull()
  })
})

describe('extractFirstIpFromForwardedHeader', () => {
  test('returns first valid IP from list', () => {
    expect(extractFirstIpFromForwardedHeader(' 1.1.1.1 , 2.2.2.2 ')).toBe('1.1.1.1')
  })

  test('ignores invalid entries', () => {
    expect(extractFirstIpFromForwardedHeader('invalid, ::ffff:203.0.113.1')).toBe('203.0.113.1')
  })

  test('returns null when no valid address found', () => {
    expect(extractFirstIpFromForwardedHeader(undefined)).toBeNull()
    expect(extractFirstIpFromForwardedHeader('invalid')).toBeNull()
  })
})

describe('createSocketProxyEvaluator', () => {
  const trustProxyDisabled = { enabled: false, value: false as const }
  const trustProxyEnabled = { enabled: true, value: 'loopback, 10.0.0.0/8' }

  beforeEach(() => {
    logger.warn.mockReset()
    logger.info.mockReset()
  })

  test('disables forwarded headers when configuration is false or empty', () => {
    expect(createSocketProxyEvaluator(undefined, trustProxyDisabled, logger)).toMatchObject({
      shouldTrustForwardedHeader: false
    })
    expect(createSocketProxyEvaluator('false', trustProxyDisabled, logger)).toMatchObject({
      shouldTrustForwardedHeader: false
    })
  })

  test('mirrors Express trust proxy configuration when set to true', () => {
    const evaluator = createSocketProxyEvaluator('true', trustProxyEnabled, logger)
    expect(evaluator.shouldTrustForwardedHeader).toBe(true)
    expect(evaluator.isTrustedProxy('10.1.1.1')).toBe(true)
    expect(logger.info).toHaveBeenCalled()
  })

  test('falls back to loopback when Express trust proxy is disabled', () => {
    const evaluator = createSocketProxyEvaluator('true', trustProxyDisabled, logger)
    expect(evaluator.shouldTrustForwardedHeader).toBe(true)
    expect(evaluator.isTrustedProxy('127.0.0.1')).toBe(true)
    expect(evaluator.isTrustedProxy('203.0.113.1')).toBe(false)
    expect(logger.warn).toHaveBeenCalled()
  })

  test('handles custom proxy list', () => {
    const evaluator = createSocketProxyEvaluator('loopback, 192.168.0.0/16', trustProxyDisabled, logger)
    expect(evaluator.shouldTrustForwardedHeader).toBe(true)
    expect(evaluator.isTrustedProxy('192.168.1.10')).toBe(true)
    expect(evaluator.isTrustedProxy('203.0.113.1')).toBe(false)
  })

  test('disables trust when configuration is invalid', () => {
    const evaluator = createSocketProxyEvaluator('invalid value', trustProxyDisabled, logger)
    expect(evaluator.shouldTrustForwardedHeader).toBe(false)
    expect(logger.warn).toHaveBeenCalled()
  })
})
