import fs from 'node:fs'
import path from 'node:path'

import { createStructuredError } from '../errors'

const RESERVED_FILENAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9'
])

const STORAGE_KEY_PATTERN = /^[A-Za-z0-9_-]+$/

type StorageKeyErrorCode =
  | 'storage_key_invalid_type'
  | 'storage_key_empty'
  | 'storage_key_missing_suffix'
  | 'storage_key_exceeds_length'
  | 'storage_key_invalid_characters'

const createStorageKeyError = (
  code: StorageKeyErrorCode,
  metadata: Record<string, unknown>
) =>
  createStructuredError({
    name: 'StorageKeyValidationError',
    message: 'Storage key validation failed',
    code,
    metadata
  })

function resolveRealPathIfPossible(target: string): string | null {
  const segments: string[] = []
  let current = target

  while (true) {
    try {
      const realParent = fs.realpathSync.native(current)
      if (segments.length === 0) {
        return realParent
      }
      return path.join(realParent, ...segments.reverse())
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        const parent = path.dirname(current)
        if (parent === current) {
          return null
        }
        segments.push(path.basename(current))
        current = parent
        continue
      }
      throw error
    }
  }
}

function normalizeComparisonPath(input: string): string {
  return normalizeForComparison(input.endsWith(path.sep) ? input : `${input}${path.sep}`)
}

export function ensureValidStorageKey(
  rawKey: unknown,
  {
    label = 'storage key',
    prefix,
    maxLength = 128
  }: { label?: string; prefix?: string; maxLength?: number } = {}
): string {
  if (typeof rawKey !== 'string') {
    throw createStorageKeyError('storage_key_invalid_type', {
      label,
      receivedType: typeof rawKey
    })
  }

  const trimmed = rawKey.trim()
  if (trimmed.length === 0) {
    throw createStorageKeyError('storage_key_empty', { label })
  }

  const normalized = prefix && !trimmed.startsWith(prefix) ? `${prefix}${trimmed}` : trimmed
  const suffix = prefix ? normalized.slice(prefix.length) : normalized

  if (suffix.length === 0) {
    throw createStorageKeyError('storage_key_missing_suffix', {
      label,
      prefix: prefix ?? null
    })
  }

  if (suffix.length > maxLength) {
    throw createStorageKeyError('storage_key_exceeds_length', {
      label,
      maxLength
    })
  }

  if (!STORAGE_KEY_PATTERN.test(suffix)) {
    throw createStorageKeyError('storage_key_invalid_characters', {
      label,
      allowedPattern: STORAGE_KEY_PATTERN.source
    })
  }

  return normalized
}

function normalizePath(input: string): string {
  return path.resolve(input)
}

function normalizeForComparison(input: string): string {
  return process.platform === 'win32' ? input.toLowerCase() : input
}

export function isSystemRootDirectory(directory: string): boolean {
  const normalizedDirectory = normalizePath(directory)
  const parsed = path.parse(normalizedDirectory)
  if (parsed.root.length === 0) {
    return false
  }

  // On Windows UNC paths, parse().root already contains the entire share path
  // (e.g. \\server\share\). Treat those as roots as well to avoid allowing an
  // allowlist that effectively covers an entire network share.
  return normalizeForComparison(parsed.root) === normalizeForComparison(normalizedDirectory)
}

export function sanitizeFilename(
  filename: string | undefined | null,
  {
    fallback,
    allowedExtensions
  }: {
    fallback: string
    allowedExtensions?: string[]
  }
): string {
  const raw = (filename ?? '').normalize('NFKC')
  const withoutIllegalChars = raw
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  let base = withoutIllegalChars.replace(/^[.\s-]+/, '').replace(/[.\s-]+$/, '')

  if (base.length === 0) {
    base = fallback
  }

  const baseName = path.basename(base)
  let nameWithoutExt = baseName
  let ext = ''
  const existingExt = path.extname(baseName)

  if (existingExt) {
    nameWithoutExt = baseName.slice(0, -existingExt.length)
    ext = existingExt
  }

  if (!nameWithoutExt || nameWithoutExt.length === 0) {
    nameWithoutExt = fallback
  }

  if (RESERVED_FILENAMES.has(nameWithoutExt.toLowerCase())) {
    nameWithoutExt = fallback
  }

  if (allowedExtensions && allowedExtensions.length > 0) {
    const normalizedAllowed = allowedExtensions.map((extension) =>
      extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`
    )
    const normalizedExt = ext.toLowerCase()
    const desiredExt = normalizedAllowed[0]

    if (!normalizedAllowed.includes(normalizedExt)) {
      ext = desiredExt
    } else {
      ext = normalizedExt.startsWith('.') ? normalizedExt : `.${normalizedExt}`
    }
  }

  const sanitized = `${nameWithoutExt}`
  let finalName = sanitized

  const maxLength = 255
  const extLength = ext.length
  if (finalName.length + extLength > maxLength) {
    finalName = finalName.slice(0, maxLength - extLength)
  }

  finalName = finalName.replace(/[.\s-]+$/g, '')
  if (finalName.length === 0) {
    finalName = fallback
  }

  if (RESERVED_FILENAMES.has(finalName.toLowerCase())) {
    finalName = `_${finalName}`
  }

  return `${finalName}${ext}`
}

export function buildAllowedOutputDirectories({
  projectPath,
  userDataPath,
  additional = []
}: {
  projectPath?: string | null
  userDataPath?: string | null
  additional?: Array<string | undefined | null>
}): string[] {
  const directories = new Set<string>()

  const addDirectory = (dir?: string | null) => {
    if (!dir || typeof dir !== 'string') {
      return
    }
    const trimmed = dir.trim()
    if (trimmed.length === 0) {
      return
    }
    const normalized = normalizePath(trimmed)
    if (isSystemRootDirectory(normalized)) {
      return
    }
    directories.add(normalized)
  }

  const safeProjectPath = typeof projectPath === 'string' ? projectPath : undefined
  if (safeProjectPath) {
    addDirectory(safeProjectPath)
    addDirectory(path.join(safeProjectPath, '.bedrock-engineer'))
    addDirectory(path.join(safeProjectPath, 'downloads'))
    addDirectory(path.join(safeProjectPath, 'output'))
  }

  const safeUserData = typeof userDataPath === 'string' ? userDataPath : undefined
  if (safeUserData) {
    addDirectory(safeUserData)
    addDirectory(path.join(safeUserData, 'downloads'))
    addDirectory(path.join(safeUserData, 'captures'))
    addDirectory(path.join(safeUserData, 'output'))
  }

  additional.forEach((dir) => addDirectory(dir ?? undefined))

  return Array.from(directories)
}

export function ensurePathWithinAllowedDirectories(
  targetPath: string,
  allowedDirectories: string[]
): string {
  if (!allowedDirectories.length) {
    throw new Error('No allowed directories configured')
  }

  const resolvedTarget = normalizePath(targetPath)
  const targetForComparison = normalizeForComparison(resolvedTarget)

  const allowedComparisons = allowedDirectories.map((directory) => {
    const resolvedDir = normalizePath(directory)
    return {
      original: resolvedDir,
      comparison: normalizeForComparison(resolvedDir)
    }
  })

  const isWithinAllowed = allowedComparisons.some(({ comparison }) => {
    if (targetForComparison === comparison) {
      return true
    }
    const comparisonWithSeparator = comparison.endsWith(path.sep)
      ? comparison
      : `${comparison}${path.sep}`
    return targetForComparison.startsWith(comparisonWithSeparator)
  })

  if (!isWithinAllowed) {
    throw new Error('Output path must reside within an allowed directory')
  }

  const allowedRealPaths = allowedComparisons
    .map(({ original }) => {
      try {
        return {
          original,
          real: normalizeComparisonPath(fs.realpathSync.native(original))
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return null
        }
        throw error
      }
    })
    .filter((value): value is { original: string; real: string } => value !== null)

  if (allowedRealPaths.length > 0) {
    const realTarget = resolveRealPathIfPossible(resolvedTarget)
    if (realTarget) {
      const realComparison = normalizeComparisonPath(realTarget)
      const realWithinAllowed = allowedRealPaths.some(({ real }) =>
        realComparison.startsWith(real)
      )
      if (!realWithinAllowed) {
        throw new Error('Output path must reside within an allowed directory')
      }
    }
  }

  return resolvedTarget
}

export function ensureDirectoryWithinAllowed(
  directory: string,
  allowedDirectories: string[]
): string {
  const resolved = normalizePath(directory)
  return ensurePathWithinAllowedDirectories(resolved, allowedDirectories)
}

export function resolveSafeOutputPath({
  requestedPath,
  defaultDirectory,
  defaultFileName,
  allowedDirectories,
  extension
}: {
  requestedPath?: string | null
  defaultDirectory: string
  defaultFileName: string
  allowedDirectories: string[]
  extension?: string
}): { fullPath: string; directory: string; filename: string } {
  const desiredExtension = extension
    ? extension.startsWith('.')
      ? extension
      : `.${extension}`
    : undefined

  const fallbackFilename = sanitizeFilename(defaultFileName, {
    fallback: defaultFileName,
    allowedExtensions: desiredExtension ? [desiredExtension] : undefined
  })

  if (requestedPath) {
    const resolvedRequested = normalizePath(requestedPath)
    const directory = ensureDirectoryWithinAllowed(path.dirname(resolvedRequested), allowedDirectories)
    const filename = sanitizeFilename(path.basename(resolvedRequested), {
      fallback: fallbackFilename,
      allowedExtensions: desiredExtension ? [desiredExtension] : undefined
    })
    const fullPath = ensurePathWithinAllowedDirectories(path.join(directory, filename), allowedDirectories)
    return { fullPath, directory, filename }
  }

  const safeDirectory = ensureDirectoryWithinAllowed(defaultDirectory, allowedDirectories)
  const filename = sanitizeFilename(undefined, {
    fallback: fallbackFilename,
    allowedExtensions: desiredExtension ? [desiredExtension] : undefined
  })
  const fullPath = ensurePathWithinAllowedDirectories(path.join(safeDirectory, filename), allowedDirectories)

  return { fullPath, directory: safeDirectory, filename }
}

export function isPathWithinAllowedDirectories(
  targetPath: string,
  allowedDirectories: string[]
): boolean {
  try {
    ensurePathWithinAllowedDirectories(targetPath, allowedDirectories)
    return true
  } catch {
    return false
  }
}
