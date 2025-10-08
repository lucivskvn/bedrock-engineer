export type TrustProxyConfig = {
  value: string | false
  enabled: boolean
}

export function resolveTrustProxySetting(env: NodeJS.ProcessEnv): TrustProxyConfig {
  if (env.TRUST_PROXY === 'true') {
    const value = env.TRUST_PROXY_TRUSTED_ADDRESSES || 'loopback, linklocal, uniquelocal'
    return { enabled: true, value }
  }

  return { enabled: false, value: false }
}
