import { promises as dns } from 'dns'
import net from 'node:net'

const DEFAULT_ALLOWED_HOSTS = ['github.com']

export interface AllowedHostEntry {
  hostname: string
  port?: number
  anyPort?: boolean
}

function normaliseHostname(hostname: string): string {
  return hostname.trim().toLowerCase()
}

function parseAllowedHostEntry(entry: string): AllowedHostEntry | null {
  if (!entry) {
    return null
  }

  let rawValue = entry.trim()
  if (!rawValue) {
    return null
  }

  let anyPort = false
  if (rawValue.endsWith(':*')) {
    anyPort = true
    rawValue = rawValue.slice(0, -2)
  }

  let candidate = rawValue
  if (!candidate.includes('://')) {
    candidate = `https://${candidate}`
  }

  try {
    const url = new URL(candidate)
    if (url.protocol !== 'https:') {
      return null
    }

    if (url.username || url.password) {
      return null
    }

    if ((url.pathname && url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
      return null
    }

    const hostname = normaliseHostname(url.hostname)
    if (!hostname) {
      return null
    }

    if (anyPort) {
      return { hostname, anyPort: true }
    }

    if (url.port) {
      const portNumber = Number.parseInt(url.port, 10)
      if (!Number.isInteger(portNumber) || portNumber <= 0 || portNumber > 65535) {
        return null
      }
      return { hostname, port: portNumber }
    }

    return { hostname, port: 443 }
  } catch {
    return null
  }
}

export function getAllowedHosts(): AllowedHostEntry[] {
  const entries = new Map<string, AllowedHostEntry>()

  const envHosts = process.env.ALLOWED_HOSTS
  if (envHosts) {
    for (const rawEntry of envHosts.split(',')) {
      const parsed = parseAllowedHostEntry(rawEntry)
      if (parsed) {
        const key = `${parsed.hostname}|${parsed.anyPort ? 'any' : parsed.port ?? '443'}`
        entries.set(key, parsed)
      }
    }
  }

  if (entries.size === 0) {
    for (const host of DEFAULT_ALLOWED_HOSTS) {
      const parsed = parseAllowedHostEntry(host)
      if (parsed) {
        const key = `${parsed.hostname}|${parsed.anyPort ? 'any' : parsed.port ?? '443'}`
        entries.set(key, parsed)
      }
    }
  }

  return Array.from(entries.values())
}

function resolvePort(url: URL): number {
  if (url.port) {
    const parsed = Number.parseInt(url.port, 10)
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
      return parsed
    }
  }
  return 443
}

export function isUrlAllowed(
  targetUrl: string,
  allowedHosts: AllowedHostEntry[] = getAllowedHosts()
): boolean {
  try {
    const url = new URL(targetUrl)
    if (url.protocol !== 'https:') {
      return false
    }
    if (url.username || url.password) {
      return false
    }

    const hostname = normaliseHostname(url.hostname)
    const port = resolvePort(url)

    return allowedHosts.some((allowed) => {
      if (hostname !== allowed.hostname) {
        return false
      }
      if (allowed.anyPort) {
        return true
      }
      const expectedPort = allowed.port ?? 443
      return expectedPort === port
    })
  } catch {
    return false
  }
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((part) => Number(part))
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
  )
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase()
  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80')
  )
}

function isPrivateIp(ip: string): boolean {
  const ipVersion = net.isIP(ip)
  if (ipVersion === 4) {
    return isPrivateIpv4(ip)
  }
  if (ipVersion === 6) {
    return isPrivateIpv6(ip)
  }
  return false
}

async function resolvesToPrivateIp(hostname: string): Promise<boolean> {
  if (net.isIP(hostname)) {
    return isPrivateIp(hostname)
  }
  try {
    const addresses = await dns.lookup(hostname, { all: true })
    return addresses.some((addr) => isPrivateIp(addr.address))
  } catch {
    // If the lookup fails, assume it could be unsafe
    return true
  }
}

/**
 * Comprehensive URL safety check that validates the scheme, optional allowed
 * hosts and ensures the host does not resolve to a private network address.
 */
export async function isUrlSafe(
  targetUrl: string,
  allowedHosts: AllowedHostEntry[] = getAllowedHosts()
): Promise<boolean> {
  if (!isUrlAllowed(targetUrl, allowedHosts)) {
    return false
  }
  try {
    const { hostname } = new URL(targetUrl)
    return !(await resolvesToPrivateIp(hostname))
  } catch {
    return false
  }
}
