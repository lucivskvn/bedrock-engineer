/** @jest-environment jsdom */

import DOMPurify from 'dompurify'
import { describe, expect, test } from '@jest/globals'

describe('Mermaid diagram sanitization', () => {
  test('removes javascript links from SVG output', () => {
    const maliciousSvg = '<svg><a xlink:href="javascript:alert(1)">X</a></svg>'
    const sanitized = DOMPurify.sanitize(maliciousSvg)
    expect(sanitized).not.toContain('javascript:alert')
  })
})
