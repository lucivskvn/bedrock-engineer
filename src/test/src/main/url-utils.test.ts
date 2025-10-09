import { promises as dns } from 'dns'
import { isUrlAllowed, isUrlSafe } from '../../../main/lib/url-utils'

jest.mock('dns', () => ({ promises: { lookup: jest.fn() } }))

const lookupMock = dns.lookup as unknown as jest.MockedFunction<typeof dns.lookup>
const originalAllowedHosts = process.env.ALLOWED_HOSTS

const resetAllowedHosts = () => {
  if (originalAllowedHosts === undefined) {
    delete process.env.ALLOWED_HOSTS
  } else {
    process.env.ALLOWED_HOSTS = originalAllowedHosts
  }
}

describe('isUrlSafe', () => {
  beforeEach(() => {
    lookupMock.mockReset()
    resetAllowedHosts()
  })

  test('rejects non-http/https URLs', async () => {
    expect(await isUrlSafe('ftp://github.com')).toBe(false)
  })

  test('rejects non-whitelisted URLs', async () => {
    lookupMock.mockResolvedValue([{ address: '1.1.1.1', family: 4 }] as any)
    expect(await isUrlSafe('https://example.com')).toBe(false)
  })

  test('rejects private network URLs', async () => {
    expect(await isUrlSafe('https://127.0.0.1')).toBe(false)
  })

  test('rejects whitelisted HTTP URLs', async () => {
    expect(await isUrlSafe('http://github.com')).toBe(false)
  })

  test('allows whitelisted HTTPS URLs', async () => {
    lookupMock.mockResolvedValue([{ address: '1.1.1.1', family: 4 }] as any)
    expect(await isUrlSafe('https://github.com')).toBe(true)
  })

  test('rejects non-default ports unless explicitly allowed', async () => {
    lookupMock.mockResolvedValue([{ address: '1.1.1.1', family: 4 }] as any)
    expect(await isUrlSafe('https://github.com:8443')).toBe(false)

    process.env.ALLOWED_HOSTS = 'github.com:8443'
    expect(await isUrlSafe('https://github.com:8443')).toBe(true)
  })
})

describe('isUrlAllowed', () => {
  beforeEach(() => {
    resetAllowedHosts()
  })

  test('rejects http URLs', () => {
    expect(isUrlAllowed('http://github.com')).toBe(false)
  })

  test('accepts allowlisted https URLs', () => {
    expect(isUrlAllowed('https://github.com')).toBe(true)
  })

  test('rejects https URLs on unexpected ports', () => {
    expect(isUrlAllowed('https://github.com:4444')).toBe(false)
  })

  test('supports wildcard port configuration', () => {
    process.env.ALLOWED_HOSTS = 'github.com:*'
    expect(isUrlAllowed('https://github.com:4444')).toBe(true)
  })
})

afterAll(() => {
  if (originalAllowedHosts === undefined) {
    delete process.env.ALLOWED_HOSTS
  } else {
    process.env.ALLOWED_HOSTS = originalAllowedHosts
  }
})
