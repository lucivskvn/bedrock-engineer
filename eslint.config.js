import js from '@eslint/js'
import { FlatCompat } from '@eslint/eslintrc'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const compat = new FlatCompat({
  baseDirectory: __dirname,
  resolvePluginsRelativeTo: __dirname,
  recommendedConfig: js.configs.recommended
})

export default [
  {
    ignores: ['node_modules', 'dist', 'out', '.gitignore']
  },
  ...compat
    .config({
      extends: [
        'eslint:recommended',
        'plugin:react/recommended',
        'plugin:react/jsx-runtime',
        '@electron-toolkit/eslint-config-ts/recommended',
        '@electron-toolkit/eslint-config-prettier'
      ],
      settings: {
        react: {
          version: 'detect'
        }
      },
      rules: {
        '@typescript-eslint/explicit-function-return-type': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
        ],
        'react/prop-types': 'off',
        'no-control-regex': 0,
        'no-restricted-syntax': [
          'warn',
          {
            selector: 'ImportExpression',
            message:
              'Consider using static imports instead of dynamic imports unless specifically required.'
          }
        ]
      }
    })
    .map((config) => ({
      ...config,
      files: ['**/*.{js,jsx,cjs,mjs,ts,tsx,cts,mts}']
    }))
]
