import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  buildAllowedOutputDirectories,
  ensurePathWithinAllowedDirectories,
  resolveSafeOutputPath,
  sanitizeFilename,
  isPathWithinAllowedDirectories,
  ensureValidStorageKey
} from '../path-utils'

describe('sanitizeFilename', () => {
  it('normalizes dangerous characters and enforces extension', () => {
    const sanitized = sanitizeFilename('..\\evil<>name?.txt', {
      fallback: 'fallback',
      allowedExtensions: ['.png']
    })

    expect(sanitized.endsWith('.png')).toBe(true)
    expect(sanitized).not.toMatch(/[<>:"/\\|?*]/)
  })

  it('uses fallback for reserved device names', () => {
    const sanitized = sanitizeFilename('CON', { fallback: 'output' })
    expect(sanitized.toLowerCase()).toContain('output')
  })
})

describe('buildAllowedOutputDirectories', () => {
  it('collects unique directories from project, userData, and additional paths', () => {
    const projectPath = path.join(os.tmpdir(), 'project-dir')
    const userDataPath = path.join(os.tmpdir(), 'user-data-dir')
    const additional = [path.join(os.tmpdir(), 'extra-one'), path.join(os.tmpdir(), 'extra-two')]

    const result = buildAllowedOutputDirectories({
      projectPath,
      userDataPath,
      additional
    })

    expect(result).toEqual(
      expect.arrayContaining([
        path.resolve(projectPath),
        path.resolve(path.join(projectPath, 'downloads')),
        path.resolve(userDataPath),
        path.resolve(additional[0])
      ])
    )
  })

  it('skips system root directories from the allowlist', () => {
    const systemRoot = path.parse(os.tmpdir()).root || path.sep
    const result = buildAllowedOutputDirectories({
      projectPath: systemRoot,
      userDataPath: undefined,
      additional: [systemRoot]
    })

    const normalizedRoot = path.resolve(systemRoot)
    for (const entry of result) {
      expect(entry).not.toBe(normalizedRoot)
    }
  })
})

describe('ensurePathWithinAllowedDirectories', () => {
  const baseDir = path.join(os.tmpdir(), 'allowed-dir')
  const allowed = [baseDir]

  it('accepts paths inside allowed directories', () => {
    const safePath = path.join(baseDir, 'nested', 'file.txt')
    expect(() => ensurePathWithinAllowedDirectories(safePath, allowed)).not.toThrow()
  })

  it('rejects paths outside allowed directories', () => {
    const unsafePath = path.join(baseDir, '..', 'other', 'file.txt')
    expect(() => ensurePathWithinAllowedDirectories(unsafePath, allowed)).toThrow()
  })

  it('rejects attempts to escape via symbolic links', () => {
    const outsideDir = path.join(os.tmpdir(), 'outside-dir')
    const symlinkPath = path.join(baseDir, 'link-outside')
    fs.mkdirSync(baseDir, { recursive: true })
    fs.mkdirSync(outsideDir, { recursive: true })

    try {
      if (!fs.existsSync(symlinkPath)) {
        fs.symlinkSync(outsideDir, symlinkPath, 'dir')
      }
    } catch (error) {
      // Skip test on environments where symlink creation is not permitted
      if ((error as NodeJS.ErrnoException).code === 'EPERM') {
        return
      }
      throw error
    }

    const maliciousPath = path.join(symlinkPath, 'escape.txt')

    expect(() => ensurePathWithinAllowedDirectories(maliciousPath, allowed)).toThrow()

    fs.rmSync(symlinkPath, { recursive: true, force: true })
  })
})

describe('resolveSafeOutputPath', () => {
  const baseDir = path.join(os.tmpdir(), 'output-base')
  const allowed = [baseDir]

  it('returns sanitized path within allowed directory for explicit request', () => {
    const { fullPath } = resolveSafeOutputPath({
      requestedPath: path.join(baseDir, 'subdir', '..', 'report.txt'),
      defaultDirectory: baseDir,
      defaultFileName: 'report',
      allowedDirectories: allowed,
      extension: '.txt'
    })

    expect(isPathWithinAllowedDirectories(fullPath, allowed)).toBe(true)
    expect(fullPath.endsWith('.txt')).toBe(true)
  })

  it('falls back to default directory and filename when none provided', () => {
    const { fullPath, filename } = resolveSafeOutputPath({
      requestedPath: undefined,
      defaultDirectory: baseDir,
      defaultFileName: 'fallback-name',
      allowedDirectories: allowed,
      extension: '.log'
    })

    expect(isPathWithinAllowedDirectories(fullPath, allowed)).toBe(true)
    expect(filename.endsWith('.log')).toBe(true)
  })
})

describe('ensureValidStorageKey', () => {
  it('enforces allowed characters and optional prefix', () => {
    expect(ensureValidStorageKey('session_123', { prefix: 'session_' })).toBe('session_123')
    expect(ensureValidStorageKey('123', { prefix: 'session_' })).toBe('session_123')
  })

  it('rejects invalid keys', () => {
    expect(() => ensureValidStorageKey('../evil')).toThrow()
    expect(() => ensureValidStorageKey('')).toThrow()
  })

  it('exposes structured metadata for invalid input types', () => {
    expect.assertions(4)

    try {
      ensureValidStorageKey(123 as unknown as string)
    } catch (error) {
      const structured = error as Error & {
        code?: string
        metadata?: Record<string, unknown>
      }

      expect(structured).toBeInstanceOf(Error)
      expect(structured.message).toBe('Storage key validation failed')
      expect(structured.code).toBe('storage_key_invalid_type')
      expect(structured.metadata).toEqual(
        expect.objectContaining({
          label: 'storage key',
          receivedType: 'number'
        })
      )
    }
  })
})
