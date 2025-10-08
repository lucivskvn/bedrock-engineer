import net from 'node:net'
import { compile as compileProxyAddr } from 'proxy-addr'
import type { TrustProxyConfig } from './server-config'

export interface LoggerLike {
  warn(message: string, meta?: Record<string, unknown>): void
  info?(message: string, meta?: Record<string, unknown>): void
}

export interface SocketProxyEvaluator {
  shouldTrustForwardedHeader: boolean
  isTrustedProxy(address: string | null | undefined): boolean
}

function compileProxySource(source: string) {
  const entries = source
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)

  if (entries.length === 0) {
    throw new TypeError('No proxy addresses provided')
  }

  return compileProxyAddr(entries.length === 1 ? entries[0] : entries)
}

export function normalizeIpAddress(address: string | null | undefined): string | null {
  if (!address) {
    return null
  }

  let candidate = address.trim()
  if (!candidate) {
    return null
  }

  const bracketMatch = candidate.match(/^\[(.*)\](?::\d+)?$/)
  if (bracketMatch) {
    candidate = bracketMatch[1]
  }

  const zoneIndex = candidate.indexOf('%')
  if (zoneIndex >= 0) {
    candidate = candidate.slice(0, zoneIndex)
  }

  if (candidate.startsWith('::ffff:')) {
    const mapped = candidate.slice(7)
    if (net.isIP(mapped) === 4) {
      return mapped
    }
  }

  if (net.isIP(candidate)) {
    return candidate
  }

  const lastColon = candidate.lastIndexOf(':')
  if (lastColon !== -1 && candidate.indexOf(':') === lastColon) {
    const portCandidate = candidate.slice(lastColon + 1)
    if (/^\d+$/.test(portCandidate)) {
      const hostOnly = candidate.slice(0, lastColon)
      if (net.isIP(hostOnly) === 4) {
        return hostOnly
      }
    }
  }

  return net.isIP(candidate) ? candidate : null
}

export function extractFirstIpFromForwardedHeader(
  value: string | string[] | undefined
): string | null {
  if (!value) {
    return null
  }

  const raw = Array.isArray(value) ? value[0] : value
  if (!raw) {
    return null
  }

  for (const part of raw.split(',')) {
    const normalized = normalizeIpAddress(part)
    if (normalized) {
      return normalized
    }
  }

  return null
}

export function createSocketProxyEvaluator(
  rawSetting: string | undefined,
  trustProxySetting: TrustProxyConfig,
  logger: LoggerLike
): SocketProxyEvaluator {
  if (!rawSetting || rawSetting.trim().toLowerCase() === 'false') {
    return {
      shouldTrustForwardedHeader: false,
      isTrustedProxy: () => false
    }
  }

  let source = rawSetting.trim()
  if (!source) {
    return {
      shouldTrustForwardedHeader: false,
      isTrustedProxy: () => false
    }
  }

  if (source.toLowerCase() === 'true') {
    if (trustProxySetting.enabled && typeof trustProxySetting.value === 'string' && trustProxySetting.value) {
      source = trustProxySetting.value
      logger.info?.('Socket proxy trust follows Express trust proxy configuration', {
        trustProxyValue: trustProxySetting.value
      })
    } else {
      source = 'loopback'
      logger.warn(
        'TRUST_PROXY_FOR_SOCKETS=true but TRUST_PROXY disabled; defaulting to loopback-only socket proxy trust'
      )
    }
  }

  try {
    const compiled = compileProxySource(source)
    return {
      shouldTrustForwardedHeader: true,
      isTrustedProxy(address) {
        const normalized = normalizeIpAddress(address)
        if (!normalized) {
          return false
        }
        return compiled(normalized, 0)
      }
    }
  } catch (error) {
    logger.warn('Invalid TRUST_PROXY_FOR_SOCKETS configuration; forwarded addresses will be ignored', {
      value: source,
      error: error instanceof Error ? error.message : String(error)
    })
    return {
      shouldTrustForwardedHeader: false,
      isTrustedProxy: () => false
    }
  }
}
