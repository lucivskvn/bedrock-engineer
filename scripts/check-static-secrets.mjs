#!/usr/bin/env node
import process from 'node:process'

function fail(message, metadata = {}) {
  const payload = {
    message,
    ...metadata
  }
  console.error('StaticSecretCheckFailure', JSON.stringify(payload))
  process.exit(1)
}

const allowStatic = process.env.ALLOW_STATIC_API_TOKEN === 'true'

if (!allowStatic) {
  if (process.env.API_AUTH_TOKEN && process.env.API_AUTH_TOKEN.trim().length > 0) {
    fail('Detected API_AUTH_TOKEN in CI environment. Configure an external secret manager instead.', {
      envVar: 'API_AUTH_TOKEN'
    })
  }

  if (process.env.API_AUTH_TOKEN_SHA256 && process.env.API_AUTH_TOKEN_SHA256.trim().length > 0) {
    fail('Detected API_AUTH_TOKEN_SHA256 in CI environment. Provide the digest via the configured secret manager.', {
      envVar: 'API_AUTH_TOKEN_SHA256'
    })
  }
}

console.log('StaticSecretCheckPassed')
