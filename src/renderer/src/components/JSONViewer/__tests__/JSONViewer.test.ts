/** @jest-environment jsdom */

import React from 'react'
import { describe, expect, test } from '@jest/globals'
import JSONViewer from '..'
import { TextEncoder, TextDecoder } from 'util'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { createInstance } from 'i18next'
import type { i18n as I18nInstance } from 'i18next'

// Polyfill for environments where these are missing (e.g., jsdom)
;(global as any).TextEncoder = TextEncoder
;(global as any).TextDecoder = TextDecoder

// Import after polyfills to avoid ReferenceError in react-dom/server
let renderToString: typeof import('react-dom/server')['renderToString']
let i18n: I18nInstance
beforeAll(async () => {
  i18n = createInstance()
  await i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    resources: {
      en: {
        translation: {
          'Copied to clipboard': 'Copied to clipboard',
          'Failed to copy': 'Failed to copy',
          'Copy JSON': 'Copy JSON'
        }
      }
    }
  })
  // eslint-disable-next-line no-restricted-syntax -- dynamic import ensures polyfills are applied first
  ;({ renderToString } = await import('react-dom/server'))
})

describe('JSONViewer sanitization', () => {
  test('renders script tags as harmless text', () => {
    const data = { message: '<script>alert("xss")</script>' }
    const html = renderToString(
      React.createElement(
        I18nextProvider,
        { i18n },
        React.createElement(JSONViewer, {
          data,
          title: '',
          showCopyButton: false
        })
      )
    )

    const container = document.createElement('div')
    container.innerHTML = html

    expect(container.querySelector('script')).toBeNull()
    expect(container.textContent).not.toContain('alert("xss")')
  })
})
