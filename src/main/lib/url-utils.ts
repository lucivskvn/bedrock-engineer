const ALLOWED_HOSTS = ['github.com']

export function isUrlAllowed(targetUrl: string): boolean {
  try {
    const { protocol, hostname } = new URL(targetUrl)
    if (protocol !== 'https:') {
      return false
    }
    return ALLOWED_HOSTS.includes(hostname)
  } catch {
    return false
  }
}

export { ALLOWED_HOSTS }

