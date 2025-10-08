#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
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
