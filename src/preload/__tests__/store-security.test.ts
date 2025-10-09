import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  ensureFallbackKey,
  readFallbackKey,
  writeFallbackKey,
  coerceAwsCredentials,
  sanitizeProxyConfiguration,
  sanitizeAwsMetadata,
  sanitizeProjectPathValue,
  __test__
} from '../store'

const { sanitizeTavilyApiKey } = __test__

const createTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'store-security-'))

describe('fallback encryption key handling', () => {
  it('writes fallback key with restrictive permissions', async () => {
    const dir = createTempDir()
    const keyPath = await ensureFallbackKey(dir)

    await writeFallbackKey(keyPath, 'a'.repeat(64))

    const stats = await fs.promises.lstat(keyPath)
    expect(stats.mode & 0o777).toBe(0o600)
    const key = await readFallbackKey(keyPath)
    expect(key).toBe('a'.repeat(64))
  })

  it('rewrites symlink targets instead of following them', async () => {
    if (process.platform === 'win32') {
      // Symlink creation requires elevated privileges on Windows environments
      return
    }

    const dir = createTempDir()
    const keyPath = await ensureFallbackKey(dir)
    const targetFile = path.join(dir, 'target.txt')
    await fs.promises.writeFile(targetFile, 'original', { mode: 0o600 })

    await fs.promises.rm(keyPath, { force: true })
    await fs.promises.symlink(targetFile, keyPath)

    await writeFallbackKey(keyPath, 'b'.repeat(64))

    const targetContent = await fs.promises.readFile(targetFile, 'utf8')
    expect(targetContent).toBe('original')

    const stats = await fs.promises.lstat(keyPath)
    expect(stats.isSymbolicLink()).toBe(false)
    const key = await readFallbackKey(keyPath)
    expect(key).toBe('b'.repeat(64))
  })

  it('rejects fallback keys with insecure permissions', async () => {
    const dir = createTempDir()
    const keyPath = await ensureFallbackKey(dir)
    await fs.promises.writeFile(keyPath, 'c'.repeat(64), { mode: 0o644 })

    const key = await readFallbackKey(keyPath)
    expect(key).toBeNull()
    expect(fs.existsSync(keyPath)).toBe(false)
  })
})

describe('AWS credential coercion', () => {
  it('normalizes valid credential values', () => {
    const result = coerceAwsCredentials({
      accessKeyId: ' AKIAEXAMPLE123456 ',
      secretAccessKey: 'abcDEF123+/=abcDEF123+/=abcDEF123+/=abcDEF12',
      sessionToken: '  AQoDYXdzEjr123+/= '
    })

    expect(result.accessKeyId).toBe('AKIAEXAMPLE123456')
    expect(result.secretAccessKey).toBe('abcDEF123+/=abcDEF123+/=abcDEF123+/=abcDEF12')
    expect(result.sessionToken).toBe('AQoDYXdzEjr123+/=')
  })

  it('throws on invalid credential characters', () => {
    expect(() =>
      coerceAwsCredentials({ accessKeyId: 'INVALID KEY', secretAccessKey: 'bad', sessionToken: undefined })
    ).toThrow()
  })
})

describe('Proxy configuration sanitization', () => {
  it('trims and normalizes disabled proxy configuration', () => {
    const sanitized = sanitizeProxyConfiguration({
      enabled: false,
      host: ' proxy.example.com ',
      port: 8080,
      protocol: 'https',
      username: ' user ',
      password: ' pass '
    })

    expect(sanitized).toEqual({
      enabled: false,
      host: 'proxy.example.com',
      port: 8080,
      username: 'user',
      password: 'pass',
      protocol: 'https'
    })
  })

  it('rejects incomplete enabled proxy configuration', () => {
    expect(() => sanitizeProxyConfiguration({ enabled: true, host: 'proxy.example.com' })).toThrow()
  })
})

describe('AWS metadata sanitization', () => {
  it('strips whitespace and drops invalid proxy config', () => {
    const result = sanitizeAwsMetadata({
      region: '  eu-central-1 ',
      profile: ' default ',
      useProfile: 'true' as unknown as boolean,
      proxyConfig: { enabled: true } as any
    })

    expect(result.region).toBe('eu-central-1')
    expect(result.profile).toBe('default')
    expect(result.useProfile).toBeUndefined()
    expect(result.proxyConfig).toBeUndefined()
  })
})

describe('Project path sanitization', () => {
  it('normalizes relative project paths', () => {
    const sanitized = sanitizeProjectPathValue(' ./workspace ')
    expect(path.isAbsolute(sanitized)).toBe(true)
  })

  it('rejects filesystem root assignments', () => {
    const rootPath = path.parse(process.cwd()).root
    expect(() => sanitizeProjectPathValue(rootPath)).toThrow()
  })
})

describe('Tavily API key sanitization', () => {
  it('accepts valid Tavily keys', () => {
    expect(sanitizeTavilyApiKey('tvly-' + 'a'.repeat(20))).toBe('tvly-' + 'a'.repeat(20))
  })

  it('returns undefined for empty values', () => {
    expect(sanitizeTavilyApiKey('  ')).toBeUndefined()
    expect(sanitizeTavilyApiKey(undefined)).toBeUndefined()
  })

  it('rejects malformed keys', () => {
    expect(() => sanitizeTavilyApiKey('invalid-key')).toThrow('Tavily API key has an unexpected format')
  })
})
