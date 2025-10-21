import {
  isApiTokenStrong,
  normalizeApiToken,
  MIN_API_TOKEN_LENGTH,
  parseSha256Digest
} from '../security'

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

  it('parses SHA-256 digests while normalising casing', () => {
    const digest = 'A'.repeat(64)
    expect(parseSha256Digest(digest)).toEqual({ digest: digest.toLowerCase() })
  })

  it('flags invalid digest formats with the original length', () => {
    expect(parseSha256Digest('invalid')).toEqual({ invalid: true, rawLength: 7 })
  })

  it('ignores empty or non-string digest values', () => {
    expect(parseSha256Digest('   ')).toBeNull()
    expect(parseSha256Digest(undefined)).toBeNull()
  })
})
