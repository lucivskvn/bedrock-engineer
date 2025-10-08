import { isApiTokenStrong, normalizeApiToken, MIN_API_TOKEN_LENGTH } from '../security'

describe('API token helpers', () => {
  it('accepts strong tokens', () => {
    const token = 'a'.repeat(MIN_API_TOKEN_LENGTH)
    expect(isApiTokenStrong(token)).toBe(true)
    expect(normalizeApiToken(token)).toBe(token)
  })

  it('rejects tokens that are too short', () => {
    const token = 'short-token'
    expect(isApiTokenStrong(token)).toBe(false)
    expect(normalizeApiToken(token)).toBeNull()
  })

  it('rejects tokens with illegal characters', () => {
    const token = 'a'.repeat(MIN_API_TOKEN_LENGTH - 1) + '!'
    expect(isApiTokenStrong(token)).toBe(false)
  })
})
