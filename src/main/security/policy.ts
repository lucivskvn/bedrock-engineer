import type { PermissionCheckHandlerHandlerDetails, PermissionRequest } from 'electron'

type AllowedPermission =
  | 'media'
  | 'camera'
  | 'microphone'
  | 'clipboard-read'
  | 'clipboard-sanitized-write'
  | 'fullscreen'

const DEFAULT_ALLOWED_PERMISSIONS = new Set<AllowedPermission>([
  'media',
  'camera',
  'microphone',
  'clipboard-read',
  'clipboard-sanitized-write',
  'fullscreen'
])

function normalizeUrl(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

export function isTrustedRendererUrl(
  url: string,
  allowedOrigins: string[],
  allowFileProtocol: boolean
): boolean {
  if (!url || url === 'about:blank') {
    return true
  }

  const normalized = normalizeUrl(url)
  if (!normalized) {
    return false
  }

  const protocol = normalized.protocol

  if (protocol === 'devtools:' || protocol === 'chrome-devtools:') {
    return true
  }

  if (protocol === 'file:' || protocol === 'app:') {
    return allowFileProtocol
  }

  if (protocol === 'http:' || protocol === 'https:') {
    const origin = `${protocol}//${normalized.host}`
    return allowedOrigins.includes(origin)
  }

  return false
}

export function isPermissionAllowed(
  permission: string,
  details: PermissionRequest | PermissionCheckHandlerHandlerDetails,
  options: {
    allowedOrigins: string[]
    allowFileProtocol: boolean
    origin?: string
  }
): boolean {
  const normalizedPermission = permission as AllowedPermission
  if (!DEFAULT_ALLOWED_PERMISSIONS.has(normalizedPermission)) {
    return false
  }

  const originToCheck = options.origin || details.requestingUrl || ''
  if (
    originToCheck &&
    !isTrustedRendererUrl(originToCheck, options.allowedOrigins, options.allowFileProtocol)
  ) {
    return false
  }

  if (normalizedPermission === 'media') {
    const mediaDetails = details as PermissionRequest & { mediaTypes?: string[] }
    const mediaTypes = mediaDetails.mediaTypes || []
    return mediaTypes.every((type) => type === 'audio' || type === 'video')
  }

  return true
}

export function getAllowedPermissions(): ReadonlySet<string> {
  return DEFAULT_ALLOWED_PERMISSIONS
}
