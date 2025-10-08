require('dotenv').config()

/** @type {import('jest').Config} */
const esModules = [
  'node-fetch',
  'data-uri-to-buffer',
  'fetch-blob',
  'formdata-polyfill',
  'node-domexception',
  'web-streams-polyfill'
]

module.exports = {
  testEnvironment: 'node',
  testTimeout: 90000,
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  transformIgnorePatterns: [`/node_modules/(?!${esModules.join('|')})`],
  transform: {
    '^.+\\.[tj]sx?$': ['babel-jest', { configFile: './babel.config.js' }]
  },
  testMatch: ['**/*.integration.test.ts', '**/*.integration.test.tsx'],
  setupFiles: ['<rootDir>/jest.integration.setup.js']
}
