import { promises as dns } from 'dns'
import net from 'node:net'

/**
 * List of hosts that are considered trusted. This list is sourced from the
 * `ALLOWED_HOSTS` environment variable (comma separated) and falls back to a
 * default value when not provided.
 */
const DEFAULT_ALLOWED_HOSTS = ['github.com']

export function getAllowedHosts(): string[] {
  const envHosts = process.env.ALLOWED_HOSTS
  if (envHosts) {
    const parsed = envHosts
      .split(',')
      .map((h) => h.trim())
      .filter((h) => h.length > 0)
    if (parsed.length > 0) {
      return parsed
    }
  }
  return DEFAULT_ALLOWED_HOSTS
}

/**
 * Checks if a URL uses http/https schemes and optionally if it belongs to the
 * list of trusted hosts. This check is synchronous and does not perform any
 * network lookups. It is used in places where a quick validation is required
 * (e.g. Electron navigation handling).
 */
export function isUrlAllowed(targetUrl: string, allowedHosts: string[] = getAllowedHosts()): boolean {
  try {
    const { protocol, hostname } = new URL(targetUrl)
    if (protocol !== 'https:') {
      return false
    }
    if (allowedHosts.length > 0 && !allowedHosts.includes(hostname)) {
      return false
    }
    return true
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
  allowedHosts: string[] = getAllowedHosts()
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
