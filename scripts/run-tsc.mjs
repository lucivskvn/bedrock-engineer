#!/usr/bin/env node
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_FLAG_SHORT = '-p'
const PROJECT_FLAG_LONG = '--project'
const BUILD_FLAG_SHORT = '-b'
const BUILD_FLAG_LONG = '--build'

const require = createRequire(import.meta.url)

const TYPESCRIPT_PACKAGE = 'typescript'

function resolvePackage(pkg, paths) {
  try {
    return require.resolve(`${pkg}/package.json`, { paths })
  } catch {
    return null
  }
}

function resolvePackageAndTrack(pkg, resolutionRoots) {
  const resolved = resolvePackage(pkg, Array.from(resolutionRoots))

  if (resolved) {
    const pkgDir = path.dirname(resolved)
    resolutionRoots.add(pkgDir)
    resolutionRoots.add(path.join(pkgDir, 'node_modules'))
  }

  return resolved
}

function safeStat(targetPath) {
  try {
    return fs.statSync(targetPath)
  } catch {
    return null
  }
}

function resolveReferenceConfigPath(referencePath, fromConfigPath) {
  const configDir = path.dirname(fromConfigPath)
  const absoluteReference = path.normalize(
    path.isAbsolute(referencePath) ? referencePath : path.join(configDir, referencePath)
  )

  const referenceStats = safeStat(absoluteReference)

  if (referenceStats?.isFile()) {
    return absoluteReference
  }

  if (referenceStats?.isDirectory()) {
    const candidate = path.join(absoluteReference, 'tsconfig.json')
    const candidateStats = safeStat(candidate)

    if (candidateStats?.isFile()) {
      return candidate
    }
  }

  if (!referenceStats && !path.extname(absoluteReference)) {
    const candidate = `${absoluteReference}.json`
    const candidateStats = safeStat(candidate)

    if (candidateStats?.isFile()) {
      return candidate
    }
  }

  return null
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const resolutionRoots = new Set([process.cwd(), scriptDir])

const missingDependencies = new Set()

const typescriptPackagePath = resolvePackageAndTrack(TYPESCRIPT_PACKAGE, resolutionRoots)

if (!typescriptPackagePath) {
  missingDependencies.add(TYPESCRIPT_PACKAGE)
}

if (missingDependencies.size > 0) {
  console.error('Missing dev dependencies required for TypeScript project references.', {
    missingDevDependencies: Array.from(missingDependencies).sort()
  })
  console.error('Run `npm ci` (or `npm install`) to restore the toolchain before retrying TypeScript checks.')
  process.exit(1)
}

const typescriptPackageJson = require(typescriptPackagePath)
const tscBinField = typescriptPackageJson.bin
const tscRelativePath =
  typeof tscBinField === 'string'
    ? tscBinField
    : tscBinField && typeof tscBinField === 'object'
    ? tscBinField.tsc ?? tscBinField.default
    : null

if (!tscRelativePath) {
  console.error('TypeScript CLI is not available in the installed package.')
  process.exit(1)
}

const tscBinPath = path.join(path.dirname(typescriptPackagePath), tscRelativePath)

const typescript = require(TYPESCRIPT_PACKAGE)

function resolveExtendsSpecifier(specifier, searchRoots) {
  try {
    return require.resolve(specifier, { paths: Array.from(searchRoots) })
  } catch {
    return null
  }
}

function normalizeConfigPath(configPath) {
  return path.isAbsolute(configPath)
    ? path.normalize(configPath)
    : path.normalize(path.join(process.cwd(), configPath))
}

function collectProjectConfigPaths(argv) {
  const configs = []

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === PROJECT_FLAG_SHORT || arg === PROJECT_FLAG_LONG) {
      const value = argv[index + 1]
      if (value && !value.startsWith('-')) {
        configs.push(value)
        index += 1
      }
      continue
    }

    if (arg.startsWith(`${PROJECT_FLAG_SHORT}`) && arg.length > PROJECT_FLAG_SHORT.length) {
      configs.push(arg.slice(PROJECT_FLAG_SHORT.length))
      continue
    }

    if (arg.startsWith(`${PROJECT_FLAG_LONG}=`)) {
      configs.push(arg.slice(PROJECT_FLAG_LONG.length + 1))
      continue
    }
  }

  const hasBuildFlag = argv.some((value) => value === BUILD_FLAG_SHORT || value === BUILD_FLAG_LONG)

  if (configs.length === 0 && hasBuildFlag) {
    configs.push('tsconfig.json')
  }

  const unique = new Set()
  const orderedUnique = []

  for (const config of configs) {
    const normalized = normalizeConfigPath(config)
    if (!unique.has(normalized)) {
      unique.add(normalized)
      orderedUnique.push(normalized)
    }
  }

  if (orderedUnique.length === 0) {
    orderedUnique.push(normalizeConfigPath('tsconfig.json'))
  }

  return orderedUnique
}

function analyseConfigExtends(configPath, ts, state) {
  if (state.visited.has(configPath)) {
    return
  }

  state.visited.add(configPath)

  const readResult = ts.readConfigFile(configPath, ts.sys.readFile)

  if (readResult.error) {
    state.parseErrors.push({
      configPath,
      diagnosticCode: readResult.error.code,
      message: ts.flattenDiagnosticMessageText(readResult.error.messageText, ' ')
    })
    return
  }

  const rawExtends = readResult.config?.extends
  const extendsList = rawExtends ? (Array.isArray(rawExtends) ? rawExtends : [rawExtends]) : []

  for (const extendsEntry of extendsList) {
    if (typeof extendsEntry !== 'string' || extendsEntry.trim() === '') {
      continue
    }

    const trimmedEntry = extendsEntry.trim()
    const searchRoots = new Set(resolutionRoots)
    searchRoots.add(path.dirname(configPath))

    const resolvedExtendsPath = resolveExtendsSpecifier(trimmedEntry, searchRoots)

    if (!resolvedExtendsPath) {
      state.missingExtends.push({
        configPath,
        extendsSpecifier: trimmedEntry
      })
      continue
    }

    const extendsDir = path.dirname(resolvedExtendsPath)
    resolutionRoots.add(extendsDir)
    resolutionRoots.add(path.join(extendsDir, 'node_modules'))

    analyseConfigExtends(resolvedExtendsPath, ts, state)
  }

  const references = Array.isArray(readResult.config?.references)
    ? readResult.config.references
    : []

  for (const reference of references) {
    if (!reference || typeof reference !== 'object') {
      continue
    }

    const referencePath = typeof reference.path === 'string' ? reference.path.trim() : ''

    if (!referencePath) {
      continue
    }

    const resolvedReferenceConfig = resolveReferenceConfigPath(referencePath, configPath)

    if (!resolvedReferenceConfig) {
      state.missingReferences.push({
        configPath,
        referencePath
      })
      continue
    }

    analyseConfigExtends(resolvedReferenceConfig, ts, state)
  }
}

const state = {
  visited: new Set(),
  missingExtends: [],
  missingReferences: [],
  parseErrors: []
}

const projectConfigPaths = collectProjectConfigPaths(process.argv.slice(2))

for (const configPath of projectConfigPaths) {
  analyseConfigExtends(configPath, typescript, state)
}

if (state.parseErrors.length > 0) {
  console.error('Unable to analyse the TypeScript configuration before running the compiler.', {
    configParseErrors: state.parseErrors.map((error) => ({
      configPath: path.relative(process.cwd(), error.configPath),
      diagnosticCode: error.diagnosticCode,
      message: error.message
    }))
  })
  console.error('Fix the configuration files (or reinstall dependencies) before retrying TypeScript checks.')
  process.exit(1)
}

if (state.missingExtends.length > 0) {
  console.error('Missing extended TypeScript configuration files required by the project.', {
    missingExtends: state.missingExtends.map((item) => ({
      configPath: path.relative(process.cwd(), item.configPath),
      extendsSpecifier: item.extendsSpecifier
    }))
  })
  console.error('Install or restore the missing configs before retrying TypeScript checks.')
  process.exit(1)
}

if (state.missingReferences.length > 0) {
  console.error('Missing TypeScript project references required by the project.', {
    missingReferences: state.missingReferences.map((item) => ({
      configPath: path.relative(process.cwd(), item.configPath),
      referencePath: item.referencePath
    }))
  })
  console.error('Restore the referenced projects (or fix the paths) before retrying TypeScript checks.')
  process.exit(1)
}

const result = spawnSync(process.execPath, [tscBinPath, ...process.argv.slice(2)], {
  stdio: 'inherit'
})

if (result.error) {
  throw result.error
}

if (typeof result.status === 'number') {
  process.exit(result.status)
}

process.exit(1)
