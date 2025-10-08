import { isOriginAllowed } from '../cors-utils'

describe('isOriginAllowed', () => {
  const allowedOrigins = ['https://example.com', 'http://localhost:5173', 'http://[::1]:5173']

  it('allows configured origins', () => {
    expect(isOriginAllowed('https://example.com', allowedOrigins, false)).toBe(true)
  })

  it('normalizes case and loopback variants', () => {
    expect(isOriginAllowed('HTTPS://EXAMPLE.COM', allowedOrigins, false)).toBe(true)
    expect(isOriginAllowed('http://[::1]:5173', allowedOrigins, false)).toBe(true)
  })

  it('rejects unknown origins', () => {
    expect(isOriginAllowed('https://malicious.com', allowedOrigins, false)).toBe(false)
  })

  it('allows null origins when file protocol is permitted', () => {
    expect(
      isOriginAllowed('null', allowedOrigins, true, {
        'sec-fetch-site': 'none',
        'sec-fetch-mode': 'same-origin',
        'sec-fetch-dest': 'empty'
      })
    ).toBe(true)
  })

  it('rejects null origins when file protocol is not permitted', () => {
    expect(isOriginAllowed('null', allowedOrigins, false)).toBe(false)
  })

  it('rejects null origins from cross-site contexts even when file protocol is allowed', () => {
    expect(
      isOriginAllowed('null', allowedOrigins, true, {
        'sec-fetch-site': 'cross-site'
      })
    ).toBe(false)
  })

  it('rejects null origins with unsafe destinations', () => {
    expect(
      isOriginAllowed('null', allowedOrigins, true, {
        'sec-fetch-site': 'none',
        'sec-fetch-mode': 'same-origin',
        'sec-fetch-dest': 'document'
      })
    ).toBe(false)
  })

  it('allows requests with missing origin only when headers indicate same-origin or none', () => {
    expect(isOriginAllowed(undefined, allowedOrigins, true, {})).toBe(true)
    expect(
      isOriginAllowed(undefined, allowedOrigins, true, {
        'sec-fetch-site': 'cross-site'
      })
    ).toBe(false)
    expect(
      isOriginAllowed(undefined, allowedOrigins, true, {
        'sec-fetch-site': 'none',
        'sec-fetch-dest': 'document'
      })
    ).toBe(false)
  })
})
