import {
  hasStoredApiTokenValue,
  resolveProvidedToken,
  shouldClearStoredApiToken,
  tokensMatch
} from '../auth/token-utils'

describe('token utils', () => {
  describe('tokensMatch', () => {
    it('returns true when tokens are identical', () => {
      expect(tokensMatch('abc123', 'abc123')).toBe(true)
    })

    it('returns false when lengths differ', () => {
      expect(tokensMatch('abc123', 'abc1234')).toBe(false)
    })

    it('returns false when values differ but length matches', () => {
      expect(tokensMatch('abcdef', 'abcdeg')).toBe(false)
    })
  })

  describe('resolveProvidedToken', () => {
    it('prefers the X-API-Key header when present', () => {
      expect(
        resolveProvidedToken({
          'x-api-key': '  token-from-header  ',
          authorization: 'Bearer ignored'
        })
      ).toBe('token-from-header')
    })

    it('supports header arrays', () => {
      expect(
        resolveProvidedToken({
          'x-api-key': [' token-from-array ']
        })
      ).toBe('token-from-array')
    })

    it('scans header arrays for the first non-empty string entry', () => {
      expect(
        resolveProvidedToken({
          'x-api-key': [123 as unknown as string, '   ', '  header-value  ']
        })
      ).toBe('header-value')
    })

    it('falls back to bearer tokens in the authorization header', () => {
      expect(
        resolveProvidedToken({
          authorization: '  Bearer   from-auth  '
        })
      ).toBe('from-auth')
    })

    it('scans authorization header arrays', () => {
      expect(
        resolveProvidedToken({
          authorization: ['Basic ignored', '  Bearer   from-array  ']
        })
      ).toBe('from-array')
    })

    it('treats non-bearer authorization headers as missing', () => {
      expect(
        resolveProvidedToken({
          authorization: 'Basic abc123'
        })
      ).toBeNull()
    })

    it('returns null when header arrays contain no string values', () => {
      expect(
        resolveProvidedToken({
          'x-api-key': [123 as unknown as string, ''],
          authorization: undefined
        })
      ).toBeNull()
    })

    it('returns null when the bearer header lacks a token', () => {
      expect(
        resolveProvidedToken({
          authorization: 'Bearer   '
        })
      ).toBeNull()
    })

    it('returns null when header strings normalise to empty', () => {
      expect(
        resolveProvidedToken({
          'x-api-key': '   '
        })
      ).toBeNull()
    })

    it('returns null when no token is available', () => {
      expect(resolveProvidedToken({})).toBeNull()
    })
  })

  describe('hasStoredApiTokenValue', () => {
    it('returns true for strings containing non-whitespace characters', () => {
      expect(hasStoredApiTokenValue('  secret ')).toBe(true)
    })

    it('returns false for non-string values', () => {
      expect(hasStoredApiTokenValue(undefined)).toBe(false)
      expect(hasStoredApiTokenValue(123)).toBe(false)
    })

    it('returns false for whitespace-only strings', () => {
      expect(hasStoredApiTokenValue('   ')).toBe(false)
    })

    it('returns false for empty strings', () => {
      expect(hasStoredApiTokenValue('')).toBe(false)
    })
  })

  describe('shouldClearStoredApiToken', () => {
    it('returns false when no digest override is configured', () => {
      expect(
        shouldClearStoredApiToken({ hasEnvDigestOverride: false, storedTokenValue: 'value' })
      ).toBe(false)
    })

    it('returns false when stored token value is missing', () => {
      expect(
        shouldClearStoredApiToken({ hasEnvDigestOverride: true, storedTokenValue: null })
      ).toBe(false)
    })

    it('returns true when digest override and a trimmed stored string are present', () => {
      expect(
        shouldClearStoredApiToken({ hasEnvDigestOverride: true, storedTokenValue: ' secret ' })
      ).toBe(true)
    })

    it('returns false when digest override is present but stored value is empty', () => {
      expect(
        shouldClearStoredApiToken({ hasEnvDigestOverride: true, storedTokenValue: '' })
      ).toBe(false)
    })

    it('returns true when digest override is present and stored value contains only whitespace', () => {
      expect(
        shouldClearStoredApiToken({ hasEnvDigestOverride: true, storedTokenValue: '   ' })
      ).toBe(true)
    })
  })
})
