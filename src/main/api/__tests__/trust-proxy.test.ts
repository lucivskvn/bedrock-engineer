import { resolveTrustProxySetting } from '../server-config'

describe('resolveTrustProxySetting', () => {
  it('disables trust proxy by default', () => {
    expect(resolveTrustProxySetting({} as NodeJS.ProcessEnv)).toEqual({
      enabled: false,
      value: false
    })
  })

  it('enables trust proxy when configured', () => {
    expect(
      resolveTrustProxySetting({
        TRUST_PROXY: 'true',
        TRUST_PROXY_TRUSTED_ADDRESSES: 'loopback'
      } as NodeJS.ProcessEnv)
    ).toEqual({
      enabled: true,
      value: 'loopback'
    })
  })

  it('falls back to default trusted addresses', () => {
    expect(
      resolveTrustProxySetting({ TRUST_PROXY: 'true' } as NodeJS.ProcessEnv)
    ).toEqual({
      enabled: true,
      value: 'loopback, linklocal, uniquelocal'
    })
  })
})
