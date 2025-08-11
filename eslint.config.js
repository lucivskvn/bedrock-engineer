import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import react from 'eslint-plugin-react'
import prettier from 'eslint-config-prettier/flat'
import globals from 'globals'

export default [
  {
    ignores: ['node_modules', 'dist', 'out', '.gitignore']
  },
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node
      }
    }
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  react.configs.flat.recommended,
  react.configs.flat['jsx-runtime'],
  prettier,
  {
    files: ['**/*.{js,jsx,cjs,mjs,ts,tsx,cts,mts}'],
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
  },
  {
    files: ['**/*.{js,jsx,cjs,mjs}'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off'
    }
  }
]

