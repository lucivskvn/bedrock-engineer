import { createHash } from 'node:crypto'
import path from 'node:path'

import { PDFParse } from 'pdf-parse'

import { createStructuredError, type StructuredError } from '../../../common/errors'
import type { LineRange } from '../../../preload/lib/line-range-utils'

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

export const summarizeUnknownError = (error: unknown) => {
  if (error instanceof Error) {
    const payload: Record<string, unknown> = {
      name: error.name,
      message: error.message
    }

    const code = (error as { code?: unknown }).code
    if (typeof code === 'string' && code.length > 0) {
      payload.code = code
    }

    return payload
  }

  return {
    type: typeof error,
    value: error === undefined ? '[undefined]' : String(error)
  }
}

export type PdfErrorCode =
  | 'PDF_EXTENSION_UNSUPPORTED'
  | 'PDF_PATH_NOT_ALLOWED'
  | 'PDF_FILE_ACCESS_FAILED'
  | 'PDF_FILE_TOO_LARGE'
  | 'PDF_PARSE_FAILED'
  | 'PDF_LINE_RANGE_INVALID'
  | 'PDF_TEXT_EXTRACTION_FAILED'
  | 'PDF_METADATA_EXTRACTION_FAILED'
  | 'PDF_INFO_EXTRACTION_FAILED'

const PDF_ERROR_MESSAGES: Record<PdfErrorCode, string> = {
  PDF_EXTENSION_UNSUPPORTED: 'PDF file extension is not supported.',
  PDF_PATH_NOT_ALLOWED: 'PDF file path is not within an allowed directory.',
  PDF_FILE_ACCESS_FAILED: 'PDF file could not be accessed.',
  PDF_FILE_TOO_LARGE: 'PDF file exceeds the maximum allowed size.',
  PDF_PARSE_FAILED: 'PDF file could not be parsed.',
  PDF_LINE_RANGE_INVALID: 'PDF line range is invalid.',
  PDF_TEXT_EXTRACTION_FAILED: 'PDF text extraction failed.',
  PDF_METADATA_EXTRACTION_FAILED: 'PDF metadata extraction failed.',
  PDF_INFO_EXTRACTION_FAILED: 'PDF info retrieval failed.'
}

export type PdfProcessingError = StructuredError<PdfErrorCode>

export const createPdfError = (
  code: PdfErrorCode,
  metadata?: Record<string, unknown>
): PdfProcessingError =>
  createStructuredError({
    name: 'PdfProcessingError',
    message: PDF_ERROR_MESSAGES[code],
    code,
    metadata
  })

export const toPdfError = (
  error: unknown,
  code: PdfErrorCode,
  metadata?: Record<string, unknown>
): PdfProcessingError => {
  if (error instanceof Error && typeof (error as { code?: unknown }).code === 'string') {
    const structured = error as PdfProcessingError

    if (metadata && Object.keys(metadata).length > 0) {
      structured.metadata = {
        ...(structured.metadata ?? {}),
        ...metadata
      }
    }

    return structured
  }

  return createPdfError(code, {
    ...(metadata ?? {}),
    errorSummary: summarizeUnknownError(error)
  })
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
      parserExportType: typeof PDFParse,
      remediation: 'Reinstall dependencies with npm ci to refresh pdf-parse >=2.2.16.'
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
