/** @jest-environment jsdom */

import React from 'react'
import { describe, expect, test } from '@jest/globals'
import JSONViewer from '..'
import { TextEncoder, TextDecoder } from 'util'

// Polyfill for environments where these are missing (e.g., jsdom)
;(global as any).TextEncoder = TextEncoder
;(global as any).TextDecoder = TextDecoder

// Import after polyfills to avoid ReferenceError in react-dom/server
let renderToString: typeof import('react-dom/server')['renderToString']
beforeAll(async () => {
  ;({ renderToString } = await import('react-dom/server'))
})

describe('JSONViewer sanitization', () => {
  test('renders script tags as harmless text', () => {
    const data = { message: '<script>alert("xss")</script>' }
    const html = renderToString(
      React.createElement(JSONViewer, {
        data,
        title: '',
        showCopyButton: false
      })
    )

    const container = document.createElement('div')
    container.innerHTML = html

    expect(container.querySelector('script')).toBeNull()
    expect(container.textContent).not.toContain('alert("xss")')
  })
})
