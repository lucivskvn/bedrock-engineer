#!/usr/bin/env node
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const checker = require('license-checker-rseidelsohn')

const ALLOW_LIST = new Set(['MIT', 'MIT-0', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC'])

const loadLicenses = () =>
  new Promise((resolve, reject) => {
    checker.init(
      {
        start: process.cwd(),
        production: true,
        customPath: undefined
      },
      (error, packages) => {
        if (error) {
          reject(error)
          return
        }
        resolve(packages)
      }
    )
  })

const normalizeLicenses = (license) => {
  if (!license) {
    return []
  }
  if (Array.isArray(license)) {
    return license
  }
  return String(license)
    .split(' OR ')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

try {
  const packages = await loadLicenses()
  const disallowed = []

  Object.entries(packages).forEach(([pkg, info]) => {
    const normalized = normalizeLicenses(info.licenses)
    const isAllowed = normalized.every((license) => ALLOW_LIST.has(license))
    if (!isAllowed) {
      disallowed.push({ package: pkg, licenses: normalized })
    }
  })

  if (disallowed.length > 0) {
    console.error('Found dependencies with disallowed licenses.', {
      packages: disallowed.map((entry) => ({
        name: entry.package,
        licenses: entry.licenses
      }))
    })
    process.exit(1)
  }

  console.log('All dependency licenses comply with the approved allow list.', {
    packageCount: Object.keys(packages).length
  })
} catch (error) {
  console.error('Failed to validate dependency licenses.', {
    error:
      error instanceof Error
        ? { name: error.name, message: error.message }
        : { type: typeof error }
  })
  process.exit(1)
}
