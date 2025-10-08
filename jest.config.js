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
    '^keytar$': '<rootDir>/src/test/__mocks__/keytar.ts'
  },
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  testPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '\\.integration\\.test\\.ts$' // .integration.test.ts で終わるファイルを除外
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node']
}
