/** @type {import('jest').Config} **/
const esModules = [
  'get-port',
  'electron-store',
  'conf',
  'dot-prop',
  'env-paths',
  'atomically',
  'stubborn-fs',
  'when-exit',
  'debounce-fn',
  'mimic-function',
  'uint8array-extras'
]

module.exports = {
  testEnvironment: 'node',
  transformIgnorePatterns: [`/node_modules/(?!${esModules.join('|')})`],
  transform: {
    '^.+\\.[tj]sx?$': ['babel-jest', { configFile: './babel.config.js' }]
  },
  moduleNameMapper: {
    '^@renderer/(.*)$': '<rootDir>/src/renderer/src/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@types/(.*)$': '<rootDir>/src/types/$1',
    '^@common/(.*)$': '<rootDir>/src/common/$1',
    '^keytar$': '<rootDir>/src/test/__mocks__/keytar.ts'
  },
  setupFilesAfterEnv: ['<rootDir>/src/test/setup/logging.ts'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  testPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '\\.integration\\.test\\.ts$' // .integration.test.ts で終わるファイルを除外
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  collectCoverageFrom: [
    'src/main/api/auth/token-utils.ts',
    'src/main/api/config/runtime-config.ts',
    'src/main/api/health/**/*.ts'
  ],
  coverageThreshold: {
    global: {
      branches: 95,
      functions: 95,
      lines: 95,
      statements: 95
    }
  }
}
