import { timingSafeEqual } from 'crypto'

function normaliseHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry !== 'string') {
        continue
      }

      const trimmedEntry = entry.trim()
      if (trimmedEntry.length > 0) {
        return trimmedEntry
      }
    }

    return null
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }

  return null
}

/**
 * Performs a constant-time comparison between two authentication tokens. The
 * function guards against timing attacks by rejecting length mismatches before
 * deferring to Node.js' {@link timingSafeEqual} implementation.
 */
export function tokensMatch(expected: string, provided: string): boolean {
  const expectedBuffer = Buffer.from(expected, 'utf8')
  const providedBuffer = Buffer.from(provided, 'utf8')

  if (expectedBuffer.length !== providedBuffer.length) {
    return false
  }

  return timingSafeEqual(expectedBuffer, providedBuffer)
}

/**
 * Extracts an API token from canonical request headers. The helper inspects the
 * `X-API-Key` header first, then falls back to a Bearer token in the
 * `Authorization` header. Mixed-case prefixes and surrounding whitespace are
 * tolerated. Returns `null` when no token is present.
 */
export function resolveProvidedToken(headers: {
  ['x-api-key']?: string | string[]
  authorization?: string | string[]
}): string | null {
  const directHeader = normaliseHeaderValue(headers['x-api-key'])
  if (directHeader) {
    return directHeader
  }

  const bearerPrefixPattern = /^bearer\s+/i
  const rawAuthorization = headers.authorization
  if (Array.isArray(rawAuthorization)) {
    for (const entry of rawAuthorization) {
      if (typeof entry !== 'string') {
        continue
      }

      const trimmedEntry = entry.trim()
      if (!bearerPrefixPattern.test(trimmedEntry)) {
        continue
      }

      const tokenCandidate = trimmedEntry.replace(bearerPrefixPattern, '').trim()
      if (tokenCandidate.length > 0) {
        return tokenCandidate
      }
    }

    return null
  }

  const authorization = normaliseHeaderValue(rawAuthorization)
  if (!authorization) {
    return null
  }

  if (!bearerPrefixPattern.test(authorization)) {
    return null
  }

  const token = authorization.replace(bearerPrefixPattern, '').trim()
  return token.length > 0 ? token : null
}

export function hasStoredApiTokenValue(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false
  }

  return value.trim().length > 0
}

export function shouldClearStoredApiToken(options: {
  hasEnvDigestOverride: boolean
  storedTokenValue: unknown
}): boolean {
  if (!options.hasEnvDigestOverride) {
    return false
  }

  if (typeof options.storedTokenValue !== 'string') {
    return false
  }

  return options.storedTokenValue.length > 0
}
