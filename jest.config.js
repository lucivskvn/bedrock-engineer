/** @type {import('ts-jest').JestConfigWithTsJest} **/
const esModules = ['get-port']

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transformIgnorePatterns: [`/node_modules/(?!${esModules.join('|')})`],
  transform: {
    '^.+.tsx?$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.test.json'
      }
    ],
    '^.+\\.[jt]sx?$': 'babel-jest'
  },
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '\\.integration\\.test\\.ts$' // .integration.test.ts で終わるファイルを除外
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node']
}
