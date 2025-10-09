import { URL } from 'node:url'

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', '::1', 'localhost'])

export interface NormalizeNetworkOptions {
  /**
   * Allow HTTP scheme when the hostname resolves to a loopback interface.
   * Defaults to false which forces HTTPS.
   */
  allowLoopbackHttp?: boolean
}

function assertString(value: unknown, errorMessage: string): string {
  if (typeof value !== 'string') {
    throw new Error(errorMessage)
  }

  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(errorMessage)
  }

  return trimmed
}

export function isLoopbackHostname(hostname: string): boolean {
  let normalized = hostname.trim().toLowerCase()
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    normalized = normalized.slice(1, -1)
  }
  return LOOPBACK_HOSTNAMES.has(normalized)
}

function ensureNoCredentials(url: URL): void {
  if (url.username || url.password) {
    throw new Error('Endpoint must not include embedded credentials')
  }
  url.username = ''
  url.password = ''
}

function ensureNoPathQueryOrHash(url: URL): void {
  if (url.pathname && url.pathname !== '/' && url.pathname !== '') {
    throw new Error('Endpoint must not include path segments')
  }
  if (url.search && url.search !== '') {
    throw new Error('Endpoint must not include search parameters')
  }
  if (url.hash && url.hash !== '') {
    throw new Error('Endpoint must not include hash fragments')
  }

  url.pathname = ''
  url.search = ''
  url.hash = ''
}

function ensureAllowedProtocol(url: URL, { allowLoopbackHttp = false }: NormalizeNetworkOptions): void {
  const protocol = url.protocol.toLowerCase()
  const hostname = url.hostname.toLowerCase()

  if (protocol === 'https:') {
    return
  }

  if (protocol === 'http:' && allowLoopbackHttp && isLoopbackHostname(hostname)) {
    return
  }

  throw new Error('Endpoint must use HTTPS or loopback HTTP')
}

function ensureValidPort(url: URL): void {
  if (!url.port) {
    return
  }

  const portNumber = Number.parseInt(url.port, 10)
  if (!Number.isFinite(portNumber) || portNumber <= 0 || portNumber > 65535) {
    throw new Error('Endpoint port is out of range')
  }
}

function canonicalise(url: URL): string {
  const host = url.host.toLowerCase()
  const protocol = url.protocol.toLowerCase()
  return `${protocol}//${host}`
}

export function normalizeNetworkEndpoint(
  value: unknown,
  options: NormalizeNetworkOptions = {}
): string {
  const candidate = assertString(value, 'Endpoint must be a non-empty string')

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    throw new Error('Endpoint must be a valid URL')
  }

  ensureNoCredentials(parsed)
  ensureNoPathQueryOrHash(parsed)
  ensureAllowedProtocol(parsed, options)
  ensureValidPort(parsed)

  return canonicalise(parsed)
}

export function normalizeHttpOrigin(
  value: unknown,
  options: NormalizeNetworkOptions = {}
): string {
  return normalizeNetworkEndpoint(value, options)
}
