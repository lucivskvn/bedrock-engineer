#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)

const NODE_MEMORY_FLAG = '--max_old_space_size=8192'

function mergeNodeOptions(currentValue = '') {
  const existing = currentValue
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => !value.startsWith('--max_old_space_size='))

  return [NODE_MEMORY_FLAG, ...existing].join(' ')
}

const sharedEnv = {
  ...process.env,
  NODE_OPTIONS: mergeNodeOptions(process.env.NODE_OPTIONS),
  NODE_ENV: process.env.NODE_ENV ?? 'production'
}

function handleResult(result) {
  if (result.error) {
    throw result.error
  }

  if (typeof result.status === 'number') {
    if (result.status !== 0) {
      process.exit(result.status)
    }
    return
  }

  process.exit(1)
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
    env: { ...sharedEnv, ...(options.env ?? {}) }
  })
  handleResult(result)
}

function runNpmScript(scriptName) {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  runCommand(npmCommand, ['run', scriptName], {
    shell: process.platform === 'win32'
  })
}

function resolveBin(packageName, binName = packageName) {
  const packageJsonPath = require.resolve(`${packageName}/package.json`)
  const packageJson = require(packageJsonPath)
  const binField = packageJson.bin

  let binRelativePath
  if (typeof binField === 'string') {
    binRelativePath = binField
  } else if (binField && typeof binField === 'object') {
    binRelativePath = binField[binName] ?? binField.default
  }

  if (!binRelativePath) {
    throw new Error(`Unable to resolve executable for ${packageName}`)
  }

  return path.join(path.dirname(packageJsonPath), binRelativePath)
}

function runNodeBin(binPath, args = []) {
  runCommand(process.execPath, [binPath, ...args])
}

runNpmScript('typecheck')

const electronViteBin = resolveBin('electron-vite')
runNodeBin(electronViteBin, ['build'])
