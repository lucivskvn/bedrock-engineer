#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

const REQUIRED_FLAT_CONFIG_PACKAGES = ['@typescript-eslint/parser', '@typescript-eslint/eslint-plugin']
const META_PACKAGE = 'typescript-eslint'

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

function ensureFlatConfigDependencies() {
  const missingDeps = new Set()

  const scriptDir = path.dirname(fileURLToPath(import.meta.url))
  const resolutionRoots = new Set([process.cwd(), scriptDir])

  const metaPackagePath = resolvePackageAndTrack(META_PACKAGE, resolutionRoots)

  if (!metaPackagePath) {
    console.error('Missing dev dependencies required for the ESLint flat config.', {
      missingDevDependencies: [META_PACKAGE]
    })
    console.error('Run `npm ci` (or `npm install`) to restore the toolchain before retrying linting.')
    process.exit(1)
  }

  for (const dep of REQUIRED_FLAT_CONFIG_PACKAGES) {
    if (!resolvePackageAndTrack(dep, resolutionRoots)) {
      missingDeps.add(dep)
    }
  }

  if (missingDeps.size > 0) {
    console.error('Missing dev dependencies required for the ESLint flat config.', {
      missingDevDependencies: Array.from(missingDeps).sort()
    })
    console.error('Run `npm ci` (or `npm install`) to restore the toolchain before retrying linting.')
    process.exit(1)
  }
}

ensureFlatConfigDependencies()

const eslintPackageJsonPath = require.resolve('eslint/package.json')
const eslintPackage = require(eslintPackageJsonPath)
const eslintCliPath = path.join(path.dirname(eslintPackageJsonPath), eslintPackage.bin.eslint)

const env = {
  ...process.env,
  ESLINT_USE_FLAT_CONFIG: process.env.ESLINT_USE_FLAT_CONFIG ?? 'true'
}

const result = spawnSync(process.execPath, [eslintCliPath, ...process.argv.slice(2)], {
  env,
  stdio: 'inherit'
})

if (result.error) {
  throw result.error
}

if (typeof result.status === 'number') {
  process.exit(result.status)
}

process.exit(1)
