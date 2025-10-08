import { normalizeNetworkEndpoint } from '../../../../common/security/urlGuards'

export function resolveTrustedApiEndpoint(candidate: unknown): string {
  if (candidate === null || candidate === undefined || candidate === '') {
    throw new Error('API endpoint is not configured')
  }

  return normalizeNetworkEndpoint(candidate, { allowLoopbackHttp: true })
}

export function getTrustedApiEndpoint(): string {
  const raw = (window as any).store?.get('apiEndpoint')
  return resolveTrustedApiEndpoint(raw)
}
