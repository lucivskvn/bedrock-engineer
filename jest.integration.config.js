require('dotenv').config()

/** @type {import('ts-jest').JestConfigWithTsJest} */
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
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.test.json',
        useESM: false,
        diagnostics: false,
        isolatedModules: true
      }
    ],
    '^.+\\.[jt]sx?$': 'babel-jest'
  },
  testMatch: ['**/*.integration.test.ts'],
  setupFiles: ['<rootDir>/jest.integration.setup.js']
}
