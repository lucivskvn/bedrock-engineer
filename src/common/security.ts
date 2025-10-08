export const MIN_API_TOKEN_LENGTH = 32
const MAX_API_TOKEN_LENGTH = 256
const ALLOWED_TOKEN_PATTERN = /^[A-Za-z0-9+_=.-]+$/

export function normalizeApiToken(token: unknown): string | null {
  if (typeof token !== 'string') {
    return null
  }
  const trimmed = token.trim()
  if (trimmed.length < MIN_API_TOKEN_LENGTH || trimmed.length > MAX_API_TOKEN_LENGTH) {
    return null
  }
  if (!ALLOWED_TOKEN_PATTERN.test(trimmed)) {
    return null
  }
  return trimmed
}

export function isApiTokenStrong(token: unknown): token is string {
  return normalizeApiToken(token) !== null
}
