import { createStructuredError, type StructuredError } from '../../../common/errors'

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

