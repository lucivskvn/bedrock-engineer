require('dotenv').config()

// Add any additional setup code here

// Only log the presence of non-sensitive environment keys to avoid leaking values
const SAFE_ENV_KEYS = ['AWS_REGION', 'INTEGRATION_TEST']
const presentKeys = SAFE_ENV_KEYS.filter((key) => process.env[key] !== undefined)

if (process.env.DEBUG) {
  console.log('Integration test environment variables loaded:', presentKeys)
}
