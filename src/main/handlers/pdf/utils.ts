import { createHash } from 'node:crypto'
import path from 'node:path'

import { PDFParse } from './parser'

import {
  createPdfError,
  summarizeUnknownError,
  toPdfError,
  type PdfErrorCode,
  type PdfProcessingError
} from './errors'
import type { LineRange } from '../../../preload/lib/line-range-utils'

export { createPdfError, summarizeUnknownError, toPdfError }
export type { PdfErrorCode, PdfProcessingError }

type PlaceholderEntries = Record<string, string | number | boolean | undefined>

const createPlaceholder = (label: string, entries: PlaceholderEntries = {}): string => {
  const parts = Object.entries(entries)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${String(value)}`)

  return parts.length > 0 ? `[${label} ${parts.join(' ')}]` : `[${label}]`
}

export const createBooleanPlaceholder = (value: boolean): string =>
  createPlaceholder('boolean', { value })

export const createCountPlaceholder = (label: string, value: number): string =>
  createPlaceholder(label, { value })

export const createBytesPlaceholder = (value: number): string =>
  createPlaceholder('bytes', { value })

export const summarizePathForLogs = (value: string) => {
  const extension = path.extname(value).toLowerCase()

  return {
    hash: createPlaceholder('hash', { value: createHash('sha256').update(value).digest('hex') }),
    length: createCountPlaceholder('length', value.length),
    absolute: createBooleanPlaceholder(path.isAbsolute(value)),
    extension: createPlaceholder('extension', { value: extension.length > 0 ? extension : 'none' })
  }
}

export const summarizeAllowedDirectories = (directories: string[]) => {
  const preview = directories.slice(0, 3).map((entry) => summarizePathForLogs(entry))

  return {
    count: createCountPlaceholder('count', directories.length),
    preview,
    truncated: createBooleanPlaceholder(directories.length > preview.length)
  }
}

export const summarizeLineRange = (lineRange?: LineRange) => {
  if (!lineRange) {
    return {
      hasLineRange: createBooleanPlaceholder(false)
    }
  }

  const summary: Record<string, string> = {
    hasLineRange: createBooleanPlaceholder(true)
  }

  if (typeof lineRange.from === 'number') {
    summary.from = createCountPlaceholder('line', lineRange.from)
  }

  if (typeof lineRange.to === 'number') {
    summary.to = createCountPlaceholder('line', lineRange.to)
  }

  return summary
}

export const createPdfParser = (
  dataBuffer: Buffer,
  metadata: Record<string, unknown>,
  parserCtor: typeof PDFParse = PDFParse
): PDFParse => {
  try {
    return new parserCtor({ data: dataBuffer })
  } catch (error) {
    throw toPdfError(error, 'PDF_PARSE_FAILED', {
      ...metadata,
      reason: 'parser_initialization_failed',
      parserExportType: typeof parserCtor,
      remediation: 'Reinstall dependencies with npm ci to refresh pdf-parse >=2.2.16.',
      errorSummary: summarizeUnknownError(error)
    })
  }
}

export const normalizePdfLineRange = (lineRange?: LineRange): LineRange | undefined => {
  if (!lineRange) {
    return undefined
  }

  const summary = summarizeLineRange(lineRange)

  const { from, to } = lineRange

  if (from !== undefined) {
    if (typeof from !== 'number' || !Number.isFinite(from) || from < 1 || !Number.isInteger(from)) {
      throw createPdfError('PDF_LINE_RANGE_INVALID', {
        reason: 'from_invalid',
        lineRange: summary
      })
    }
  }

  if (to !== undefined) {
    if (typeof to !== 'number' || !Number.isFinite(to) || to < 1 || !Number.isInteger(to)) {
      throw createPdfError('PDF_LINE_RANGE_INVALID', {
        reason: 'to_invalid',
        lineRange: summary
      })
    }
  }

  if (from !== undefined && to !== undefined && from > to) {
    throw createPdfError('PDF_LINE_RANGE_INVALID', {
      reason: 'range_mismatch',
      lineRange: summary
    })
  }

  const normalized: LineRange = {}

  if (from !== undefined) {
    normalized.from = from
  }

  if (to !== undefined) {
    normalized.to = to
  }

  return normalized
}

export const createPdfSizeMetadata = (value: number) => ({
  size: createBytesPlaceholder(value)
})

export const createPdfPageCountMetadata = (pages: number) => ({
  pages: createCountPlaceholder('pages', pages)
})

export const createPdfLineCountMetadata = (lines: number) => ({
  lines: createCountPlaceholder('lines', lines)
})
