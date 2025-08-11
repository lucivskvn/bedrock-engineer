import dns from 'dns/promises'
import { isUrlSafe } from '../../../main/lib/url-utils'

jest.mock('dns/promises')

const lookupMock = dns.lookup as jest.MockedFunction<typeof dns.lookup>

describe('isUrlSafe', () => {
  beforeEach(() => {
    lookupMock.mockReset()
  })

  test('rejects non-http/https URLs', async () => {
    expect(await isUrlSafe('ftp://github.com')).toBe(false)
  })

  test('rejects non-whitelisted URLs', async () => {
    lookupMock.mockResolvedValue([{ address: '1.1.1.1', family: 4 }] as any)
    expect(await isUrlSafe('https://example.com')).toBe(false)
  })

  test('rejects private network URLs', async () => {
    expect(await isUrlSafe('http://127.0.0.1')).toBe(false)
  })

  test('allows whitelisted HTTP URLs', async () => {
    lookupMock.mockResolvedValue([{ address: '1.1.1.1', family: 4 }] as any)
    expect(await isUrlSafe('http://github.com')).toBe(true)
  })
})
