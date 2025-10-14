jest.mock('pdf-parse', () => ({
  PDFParse: class {
    constructor() {}
  }
}))

import type { PDFParse } from 'pdf-parse'

import {
  createPdfError,
  createPdfParser,
  normalizePdfLineRange,
  summarizeLineRange,
  summarizePathForLogs,
  toPdfError
} from '../pdf/utils'

describe('pdf utils', () => {
  it('creates structured PDF errors with metadata', () => {
    const error = createPdfError('PDF_FILE_TOO_LARGE', {
      actualSize: '[bytes value=26000000]',
      maxAllowedSize: '[bytes value=26214400]'
    })

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('PdfProcessingError')
    expect(error.code).toBe('PDF_FILE_TOO_LARGE')
    expect(error.message).toBe('PDF file exceeds the maximum allowed size.')
    expect(error.metadata).toEqual({
      actualSize: '[bytes value=26000000]',
      maxAllowedSize: '[bytes value=26214400]'
    })
  })

  it('merges metadata when converting to a PDF error', () => {
    const existing = createPdfError('PDF_FILE_ACCESS_FAILED', {
      attempt: '[count value=1]'
    })

    const merged = toPdfError(existing, 'PDF_TEXT_EXTRACTION_FAILED', {
      retry: '[boolean value=false]'
    })

    expect(merged.code).toBe('PDF_FILE_ACCESS_FAILED')
    expect(merged.metadata).toEqual({
      attempt: '[count value=1]',
      retry: '[boolean value=false]'
    })
  })

  it('normalizes valid line ranges and rejects invalid ones', () => {
    expect(normalizePdfLineRange({ from: 2, to: 4 })).toEqual({ from: 2, to: 4 })

    try {
      normalizePdfLineRange({ from: 0, to: 3 })
      throw new Error('Expected normalizePdfLineRange to throw')
    } catch (error) {
      const structured = error as { code?: string; metadata?: Record<string, unknown> }
      expect(structured.code).toBe('PDF_LINE_RANGE_INVALID')
      expect(structured.metadata).toMatchObject({ reason: 'from_invalid' })
    }

    try {
      normalizePdfLineRange({ from: 5, to: 3 })
      throw new Error('Expected normalizePdfLineRange to throw')
    } catch (error) {
      const structured = error as { code?: string; metadata?: Record<string, unknown> }
      expect(structured.code).toBe('PDF_LINE_RANGE_INVALID')
      expect(structured.metadata).toMatchObject({ reason: 'range_mismatch' })
    }
  })

  it('summarises paths and line ranges for logging', () => {
    const summary = summarizePathForLogs('/tmp/example.pdf')
    expect(summary).toEqual({
      hash: expect.stringMatching(/^\[hash value=[0-9a-f]+\]$/),
      length: '[length value=16]',
      absolute: '[boolean value=true]',
      extension: '[extension value=.pdf]'
    })

    expect(summarizeLineRange({ from: 10, to: 20 })).toEqual({
      hasLineRange: '[boolean value=true]',
      from: '[line value=10]',
      to: '[line value=20]'
    })

    expect(summarizeLineRange(undefined)).toEqual({
      hasLineRange: '[boolean value=false]'
    })
  })

  it('wraps parser instantiation failures with structured metadata', () => {
    const ThrowingParser = class {
      constructor() {
        throw new TypeError('parser export mismatch')
      }
    } as unknown as typeof PDFParse

    try {
      createPdfParser(Buffer.from('test'), { test: '[test value]' }, ThrowingParser)
      throw new Error('Expected createPdfParser to throw')
    } catch (error) {
      const structured = error as { code?: string; metadata?: Record<string, unknown> }
      expect(structured.code).toBe('PDF_PARSE_FAILED')
      expect(structured.metadata).toMatchObject({
        reason: 'parser_initialization_failed',
        remediation: 'Reinstall dependencies with npm ci to refresh pdf-parse >=2.2.16.',
        parserExportType: 'function'
      })
    }
  })
})
