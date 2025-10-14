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
  store,
  __test__
} from '../store'

const { sanitizeTavilyApiKey, setElectronStoreForTests } = __test__

jest.setTimeout(15000)

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

  it('throws on invalid credential characters with structured metadata', () => {
    expect.assertions(4)

    try {
      coerceAwsCredentials({
        accessKeyId: 'INVALID KEY',
        secretAccessKey: 'abcDEF123+/=abcDEF123+/=abcDEF123+/=abcDEF12',
        sessionToken: undefined
      })
    } catch (error) {
      const structured = error as Error & {
        code?: string
        metadata?: Record<string, unknown>
      }

      expect(structured).toBeInstanceOf(Error)
      expect(structured.message).toBe('AWS credential validation failed')
      expect(structured.code).toBe('aws_credential_invalid_format')
      expect(structured.metadata).toEqual(
        expect.objectContaining({
          label: 'AWS access key ID'
        })
      )
    }
  })

  it('identifies invalid secret access key formats', () => {
    expect.assertions(4)

    try {
      coerceAwsCredentials({
        accessKeyId: 'AKIAEXAMPLE123456',
        secretAccessKey: 'bad',
        sessionToken: undefined
      })
    } catch (error) {
      const structured = error as Error & {
        code?: string
        metadata?: Record<string, unknown>
      }

      expect(structured).toBeInstanceOf(Error)
      expect(structured.message).toBe('AWS credential validation failed')
      expect(structured.code).toBe('aws_credential_invalid_format')
      expect(structured.metadata).toEqual(
        expect.objectContaining({
          label: 'AWS secret access key'
        })
      )
    }
  })

  it('surfaces metadata when credential types are invalid', () => {
    expect.assertions(4)

    try {
      coerceAwsCredentials({
        accessKeyId: 123456 as unknown as string,
        secretAccessKey: 'abcDEF123+/=abcDEF123+/=abcDEF123+/=abcDEF12',
        sessionToken: undefined
      })
    } catch (error) {
      const structured = error as Error & {
        code?: string
        metadata?: Record<string, unknown>
      }

      expect(structured).toBeInstanceOf(Error)
      expect(structured.message).toBe('AWS credential validation failed')
      expect(structured.code).toBe('aws_credential_invalid_type')
      expect(structured.metadata).toEqual(
        expect.objectContaining({
          label: 'AWS access key ID',
          receivedType: 'number'
        })
      )
    }
  })

  it('identifies invalid session token characters with structured metadata', () => {
    expect.assertions(4)

    try {
      coerceAwsCredentials({
        accessKeyId: 'AKIAEXAMPLE123456',
        secretAccessKey: 'abcDEF123+/=abcDEF123+/=abcDEF123+/=abcDEF12',
        sessionToken: 'AQoDYXdzEjr123!/'
      })
    } catch (error) {
      const structured = error as Error & {
        code?: string
        metadata?: Record<string, unknown>
      }

      expect(structured).toBeInstanceOf(Error)
      expect(structured.message).toBe('AWS credential validation failed')
      expect(structured.code).toBe('aws_credential_invalid_format')
      expect(structured.metadata).toEqual(
        expect.objectContaining({
          label: 'AWS session token'
        })
      )
    }
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

  it('rejects incomplete enabled proxy configuration with structured metadata', () => {
    expect.assertions(4)

    try {
      sanitizeProxyConfiguration({ enabled: true, host: 'proxy.example.com' })
    } catch (error) {
      const structured = error as Error & {
        code?: string
        metadata?: Record<string, unknown>
      }

      expect(structured).toBeInstanceOf(Error)
      expect(structured.message).toBe('Configuration sanitization failed')
      expect(structured.code).toBe('proxy_missing_required_fields')
      expect(structured.metadata).toEqual(
        expect.objectContaining({
          missingFields: expect.arrayContaining(['port', 'protocol'])
        })
      )
    }
  })

  it('reports out-of-range proxy ports through structured errors', () => {
    expect.assertions(4)

    try {
      sanitizeProxyConfiguration({ enabled: true, host: 'proxy.example.com', protocol: 'https', port: 70000 })
    } catch (error) {
      const structured = error as Error & {
        code?: string
        metadata?: Record<string, unknown>
      }

      expect(structured).toBeInstanceOf(Error)
      expect(structured.message).toBe('Configuration sanitization failed')
      expect(structured.code).toBe('proxy_port_out_of_range')
      expect(structured.metadata).toEqual(
        expect.objectContaining({
          constraint: '1-65535'
        })
      )
    }
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
    expect.assertions(4)

    try {
      sanitizeProjectPathValue(rootPath)
    } catch (error) {
      const structured = error as Error & {
        code?: string
        metadata?: Record<string, unknown>
      }

      expect(structured).toBeInstanceOf(Error)
      expect(structured.message).toBe('Configuration sanitization failed')
      expect(structured.code).toBe('project_path_root_forbidden')
      expect(structured.metadata).toEqual(
        expect.objectContaining({
          reason: 'filesystem_root'
        })
      )
    }
  })

  it('rejects null project paths with structured metadata', () => {
    expect.assertions(4)

    try {
      sanitizeProjectPathValue(null)
    } catch (error) {
      const structured = error as Error & {
        code?: string
        metadata?: Record<string, unknown>
      }

      expect(structured).toBeInstanceOf(Error)
      expect(structured.message).toBe('Configuration sanitization failed')
      expect(structured.code).toBe('project_path_missing')
      expect(structured.metadata).toEqual(
        expect.objectContaining({
          reason: 'nullish'
        })
      )
    }
  })

  it('rejects non-string project paths', () => {
    expect.assertions(4)

    try {
      sanitizeProjectPathValue(123)
    } catch (error) {
      const structured = error as Error & {
        code?: string
        metadata?: Record<string, unknown>
      }

      expect(structured).toBeInstanceOf(Error)
      expect(structured.message).toBe('Configuration sanitization failed')
      expect(structured.code).toBe('project_path_invalid_type')
      expect(structured.metadata).toEqual(
        expect.objectContaining({
          receivedType: 'number'
        })
      )
    }
  })

  it('rejects empty project path strings', () => {
    expect.assertions(4)

    try {
      sanitizeProjectPathValue('   ')
    } catch (error) {
      const structured = error as Error & {
        code?: string
        metadata?: Record<string, unknown>
      }

      expect(structured).toBeInstanceOf(Error)
      expect(structured.message).toBe('Configuration sanitization failed')
      expect(structured.code).toBe('project_path_empty')
      expect(structured.metadata).toEqual(
        expect.objectContaining({
          reason: 'empty_string'
        })
      )
    }
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
    expect.assertions(4)

    try {
      sanitizeTavilyApiKey('invalid-key')
    } catch (error) {
      const structured = error as Error & {
        code?: string
        metadata?: Record<string, unknown>
      }

      expect(structured).toBeInstanceOf(Error)
      expect(structured.message).toBe('Configuration sanitization failed')
      expect(structured.code).toBe('tavily_api_key_invalid_format')
      expect(structured.metadata).toEqual(
        expect.objectContaining({
          allowedPattern: expect.stringContaining('tvly-')
        })
      )
    }
  })

  it('rejects non-string Tavily API keys', () => {
    expect.assertions(4)

    try {
      sanitizeTavilyApiKey(123 as unknown as string)
    } catch (error) {
      const structured = error as Error & {
        code?: string
        metadata?: Record<string, unknown>
      }

      expect(structured).toBeInstanceOf(Error)
      expect(structured.message).toBe('Configuration sanitization failed')
      expect(structured.code).toBe('tavily_api_key_invalid_type')
      expect(structured.metadata).toEqual(
        expect.objectContaining({
          receivedType: 'number'
        })
      )
    }
  })
})

describe('store inspector integration', () => {
  beforeEach(() => {
    setElectronStoreForTests(null)
  })

  afterEach(() => {
    setElectronStoreForTests(null)
  })

  it('rejects open requests when the store is unavailable', async () => {
    await expect(store.openInEditor()).rejects.toMatchObject({
      message: 'Configuration store is unavailable',
      code: 'store_uninitialized',
      metadata: { operation: 'open_in_editor' }
    })
  })

  it('delegates to electron-store when available', async () => {
    const openInEditor = jest.fn().mockResolvedValue(undefined)

    setElectronStoreForTests({
      openInEditor,
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      clear: jest.fn(),
      store: {} as Record<string, unknown>,
      path: '/tmp/mock-store'
    } as unknown as any)

    await expect(store.openInEditor()).resolves.toBeUndefined()
    expect(openInEditor).toHaveBeenCalledTimes(1)
  })

  it('wraps failures in a structured error with metadata', async () => {
    const openInEditor = jest.fn().mockRejectedValue(new Error('permission denied'))

    setElectronStoreForTests({
      openInEditor,
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
      clear: jest.fn(),
      store: {} as Record<string, unknown>,
      path: '/tmp/mock-store'
    } as unknown as any)

    await expect(store.openInEditor()).rejects.toMatchObject({
      message: 'Failed to open configuration store.',
      code: 'store_open_in_editor_failed',
      metadata: expect.objectContaining({
        reason: 'electron_store_open_failed',
        errorMessage: 'permission denied'
      })
    })
  })
})
