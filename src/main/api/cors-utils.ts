import { normalizeHttpOrigin } from '../../common/security/urlGuards'
export function isOriginAllowed(
  origin: string | string[] | undefined,
  allowedOrigins: string[],
  allowFileProtocol: boolean,
  headers?: Record<string, string | string[] | undefined>
): boolean {
  if (Array.isArray(origin)) {
    return origin.every((item) => isOriginAllowed(item, allowedOrigins, allowFileProtocol, headers))
  }

  const normalizedHeaderValue = (headerName: string): string | null => {
    if (!headers) {
      return null
    }
    const value = headers[headerName.toLowerCase()] ?? headers[headerName]
    if (Array.isArray(value)) {
      return value[0]?.toLowerCase() ?? null
    }
    return typeof value === 'string' ? value.toLowerCase() : null
  }

  if (!origin || origin.length === 0) {
    if (!allowFileProtocol) {
      return false
    }
    const fetchSite = normalizedHeaderValue('sec-fetch-site')
    const fetchDest = normalizedHeaderValue('sec-fetch-dest')
    const siteAllowed = fetchSite === null || fetchSite === 'none' || fetchSite === 'same-origin'
    const destAllowed = fetchDest === null || fetchDest === 'empty'
    return siteAllowed && destAllowed
  }

  if (allowFileProtocol) {
    if (origin === 'null') {
      const fetchSite = normalizedHeaderValue('sec-fetch-site')
      if (fetchSite && fetchSite !== 'none' && fetchSite !== 'same-origin') {
        return false
      }
      const fetchMode = normalizedHeaderValue('sec-fetch-mode')
      if (fetchMode && fetchMode !== 'cors' && fetchMode !== 'same-origin') {
        return false
      }
      const fetchDest = normalizedHeaderValue('sec-fetch-dest')
      if (fetchDest && fetchDest !== 'empty') {
        return false
      }
      return true
    }
    if (origin.startsWith('file://') || origin.startsWith('app://')) {
      const fetchDest = normalizedHeaderValue('sec-fetch-dest')
      if (fetchDest && fetchDest !== 'empty') {
        return false
      }
      return true
    }
  }

  try {
    const normalized = normalizeHttpOrigin(origin, { allowLoopbackHttp: true })
    return allowedOrigins.includes(normalized)
  } catch {
    return false
  }
}
