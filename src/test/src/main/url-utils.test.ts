import { isUrlAllowed } from '../../../main/lib/url-utils'

describe('isUrlAllowed', () => {
  test('rejects non-HTTPS URLs', () => {
    expect(isUrlAllowed('http://github.com')).toBe(false)
  })

  test('rejects non-whitelisted URLs', () => {
    expect(isUrlAllowed('https://example.com')).toBe(false)
  })

  test('allows whitelisted HTTPS URLs', () => {
    expect(isUrlAllowed('https://github.com')).toBe(true)
  })
})

