#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

const REQUIRED_JEST_PACKAGES = ['jest', 'jest-environment-jsdom', 'babel-jest']

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

function ensureJestDependencies() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url))
  const resolutionRoots = new Set([process.cwd(), scriptDir])
  const missingDeps = new Set()

  for (const dep of REQUIRED_JEST_PACKAGES) {
    if (!resolvePackageAndTrack(dep, resolutionRoots)) {
      missingDeps.add(dep)
    }
  }

  if (missingDeps.size > 0) {
    console.error('Missing dev dependencies required for the Jest test environment.', {
      missingDevDependencies: Array.from(missingDeps).sort()
    })
    console.error('Run `npm ci` (or `npm install`) to restore the toolchain before retrying tests.')
    process.exit(1)
  }
}

ensureJestDependencies()

const jestPackageJsonPath = require.resolve('jest/package.json')
const jestPackage = require(jestPackageJsonPath)
const jestBin = typeof jestPackage.bin === 'string' ? jestPackage.bin : jestPackage.bin.jest
const jestCliPath = path.join(path.dirname(jestPackageJsonPath), jestBin)

const result = spawnSync(process.execPath, [jestCliPath, ...process.argv.slice(2)], {
  env: process.env,
  stdio: 'inherit'
})

if (result.error) {
  throw result.error
}

if (typeof result.status === 'number') {
  process.exit(result.status)
}

process.exit(1)
