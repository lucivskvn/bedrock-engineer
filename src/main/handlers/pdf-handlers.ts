/**
 * PDF handlers for main process
 */

import { IpcMainInvokeEvent, app } from 'electron'
import type { Stats } from 'fs'
import * as fs from 'fs/promises'
import * as path from 'path'
import os from 'os'
import type { PDFParse } from './pdf/parser'

import { log } from '../../common/logger'
import { store } from '../../preload/store'
import {
  filterByLineRange,
  type LineRange
} from '../../preload/lib/line-range-utils'
import {
  createBooleanPlaceholder,
  createBytesPlaceholder,
  createCountPlaceholder,
  createPdfError,
  createPdfParser,
  createPdfLineCountMetadata,
  createPdfPageCountMetadata,
  createPdfSizeMetadata,
  normalizePdfLineRange,
  summarizeAllowedDirectories,
  summarizeLineRange as summarizePdfLineRange,
  summarizePathForLogs,
  toPdfError
} from './pdf/utils'
import {
  buildAllowedOutputDirectories,
  ensurePathWithinAllowedDirectories
} from '../security/path-utils'

export interface PdfContent {
  text: string
  totalLines: number
  metadata: {
    pages: number
    title?: string
    author?: string
    creationDate?: Date
    creator?: string
    producer?: string
  }
}

const MAX_PDF_BYTES = 25 * 1024 * 1024

type DocumentPathContext = {
  projectPath?: string
  userDataPath?: string
}

type PdfPathMetadata = {
  requestedPath: ReturnType<typeof summarizePathForLogs>
  resolvedPath: ReturnType<typeof summarizePathForLogs>
  allowedDirectories: ReturnType<typeof summarizeAllowedDirectories>
  configuration: Record<string, unknown>
  size: string
  maxAllowedSize: string
}

const buildConfigurationMetadata = ({
  projectPath,
  userDataPath
}: DocumentPathContext): Record<string, unknown> => {
  const metadata: Record<string, unknown> = {
    projectPathConfigured: createBooleanPlaceholder(Boolean(projectPath)),
    userDataPathConfigured: createBooleanPlaceholder(Boolean(userDataPath))
  }

  if (projectPath) {
    metadata.projectPath = summarizePathForLogs(projectPath)
  }

  if (userDataPath) {
    metadata.userDataPath = summarizePathForLogs(userDataPath)
  }

  return metadata
}

function getDocumentPathContext(): DocumentPathContext {
  const projectPathValue = store.get('projectPath')
  const projectPath =
    typeof projectPathValue === 'string' && projectPathValue.trim().length > 0
      ? projectPathValue
      : undefined
  const userDataPathValue = store.get('userDataPath')
  const userDataPath =
    typeof userDataPathValue === 'string' && userDataPathValue.trim().length > 0
      ? userDataPathValue
      : undefined

  return { projectPath, userDataPath }
}

function getAllowedDocumentDirectories({
  projectPath,
  userDataPath
}: DocumentPathContext): string[] {
  return buildAllowedOutputDirectories({
    projectPath,
    userDataPath,
    additional: [
      app.getPath('documents'),
      path.join(app.getPath('documents'), 'bedrock-engineer'),
      app.getPath('downloads'),
      path.join(app.getPath('downloads'), 'bedrock-engineer'),
      os.tmpdir()
    ]
  }).sort()
}

function isPdfFile(filePath: string): boolean {
  return path.extname(filePath).toLowerCase() === '.pdf'
}

function resolvePdfPath(
  filePath: string,
  context: DocumentPathContext,
  allowedDirectories: string[]
): string {
  const candidate = path.isAbsolute(filePath)
    ? filePath
    : context.projectPath
    ? path.resolve(context.projectPath, filePath)
    : path.resolve(filePath)

  return ensurePathWithinAllowedDirectories(candidate, allowedDirectories)
}

async function assertPdfFileSafe(filePath: string): Promise<{
  safePath: string
  metadata: PdfPathMetadata
}> {
  const context = getDocumentPathContext()
  const allowedDirectories = getAllowedDocumentDirectories(context)
  const allowedSummary = summarizeAllowedDirectories(allowedDirectories)
  const configuration = buildConfigurationMetadata(context)
  const requestedSummary = summarizePathForLogs(filePath)
  const trimmedPath = filePath.trim()

  if (trimmedPath.length === 0) {
    throw createPdfError('PDF_PATH_NOT_ALLOWED', {
      reason: 'empty_path',
      requestedPath: requestedSummary,
      allowedDirectories: allowedSummary,
      configuration
    })
  }

  let safePath: string
  try {
    safePath = resolvePdfPath(trimmedPath, context, allowedDirectories)
  } catch (error) {
    throw toPdfError(error, 'PDF_PATH_NOT_ALLOWED', {
      requestedPath: requestedSummary,
      allowedDirectories: allowedSummary,
      configuration
    })
  }

  const resolvedSummary = summarizePathForLogs(safePath)

  if (!isPdfFile(safePath)) {
    throw createPdfError('PDF_EXTENSION_UNSUPPORTED', {
      requestedPath: requestedSummary,
      resolvedPath: resolvedSummary
    })
  }

  let stats: Stats
  try {
    stats = await fs.stat(safePath)
  } catch (error) {
    throw toPdfError(error, 'PDF_FILE_ACCESS_FAILED', {
      requestedPath: requestedSummary,
      resolvedPath: resolvedSummary,
      allowedDirectories: allowedSummary,
      configuration
    })
  }

  if (stats.size > MAX_PDF_BYTES) {
    throw createPdfError('PDF_FILE_TOO_LARGE', {
      requestedPath: requestedSummary,
      resolvedPath: resolvedSummary,
      allowedDirectories: allowedSummary,
      configuration,
      actualSize: createBytesPlaceholder(stats.size),
      maxAllowedSize: createBytesPlaceholder(MAX_PDF_BYTES)
    })
  }

  const metadata: PdfPathMetadata = {
    requestedPath: requestedSummary,
    resolvedPath: resolvedSummary,
    allowedDirectories: allowedSummary,
    configuration,
    maxAllowedSize: createBytesPlaceholder(MAX_PDF_BYTES),
    ...createPdfSizeMetadata(stats.size)
  }

  return {
    safePath,
    metadata
  }
}

/**
 * Clean up extracted PDF text
 * - Normalize line endings
 * - Remove excessive empty lines
 * - Trim whitespace
 */
function cleanupText(text: string): string {
  return text
    .replace(/\r\n/g, '\n') // Normalize Windows line endings
    .replace(/\r/g, '\n') // Normalize Mac line endings
    .replace(/\n{3,}/g, '\n\n') // Limit consecutive empty lines to 2
    .replace(/[ \t]+$/gm, '') // Remove trailing whitespace from lines
    .trim() // Remove leading/trailing whitespace
}

export const pdfHandlers = {
  /**
   * Extract text from PDF file with optional line range filtering
   */
  'pdf-extract-text': async (
    _event: IpcMainInvokeEvent,
    { filePath, lineRange }: { filePath: string; lineRange?: LineRange }
  ): Promise<string> => {
    const normalizedLineRange = normalizePdfLineRange(lineRange)
    const lineRangeSummary = summarizePdfLineRange(normalizedLineRange)
    const { safePath, metadata: pathMetadata } = await assertPdfFileSafe(filePath)

    log.info('Extracting text from PDF', {
      path: pathMetadata,
      lineRange: lineRangeSummary
    })

    let parser: PDFParse | undefined
    try {
      const dataBuffer = await fs.readFile(safePath)
      const parserInstance = createPdfParser(dataBuffer, {
        path: pathMetadata,
        lineRange: lineRangeSummary
      })
      parser = parserInstance

      let textResult
      try {
        textResult = await parser.getText()
      } catch (error) {
        throw toPdfError(error, 'PDF_PARSE_FAILED', {
          path: pathMetadata
        })
      }

      const cleanedText = cleanupText(textResult.text)
      const result = filterByLineRange(cleanedText, normalizedLineRange)
      const totalLines = cleanedText.split('\n').length

      log.info('PDF text extraction successful', {
        path: pathMetadata,
        lineRange: lineRangeSummary,
        ...createPdfPageCountMetadata(textResult.total),
        ...createPdfLineCountMetadata(totalLines),
        extractedLength: createCountPlaceholder('length', cleanedText.length),
        filteredLength: createCountPlaceholder('length', result.length)
      })

      return result
    } catch (error) {
      const pdfError = toPdfError(error, 'PDF_TEXT_EXTRACTION_FAILED', {
        path: pathMetadata,
        lineRange: lineRangeSummary
      })

      log.error('PDF text extraction failed', {
        code: pdfError.code,
        metadata: pdfError.metadata
      })

      throw pdfError
    } finally {
      if (parser) {
        await parser.destroy()
      }
    }
  },

  /**
   * Extract text with metadata from PDF file
   */
  'pdf-extract-metadata': async (
    _event: IpcMainInvokeEvent,
    { filePath }: { filePath: string }
  ): Promise<PdfContent> => {
    const { safePath, metadata: pathMetadata } = await assertPdfFileSafe(filePath)

    log.info('Extracting PDF metadata', {
      path: pathMetadata
    })

    let parser: PDFParse | undefined
    try {
      const dataBuffer = await fs.readFile(safePath)
      parser = createPdfParser(dataBuffer, {
        path: pathMetadata
      })

      let textResult
      try {
        textResult = await parser.getText()
      } catch (error) {
        throw toPdfError(error, 'PDF_PARSE_FAILED', {
          path: pathMetadata
        })
      }

      const cleanedText = cleanupText(textResult.text)
      const lines = cleanedText.split('\n')

      let infoResult
      try {
        infoResult = await parser.getInfo()
      } catch (error) {
        throw toPdfError(error, 'PDF_PARSE_FAILED', {
          path: pathMetadata
        })
      }

      const dateNode = infoResult.getDateNode()
      const creationDate =
        dateNode.CreationDate ??
        dateNode.XmpCreateDate ??
        dateNode.XapCreateDate ??
        undefined

      const result: PdfContent = {
        text: cleanedText,
        totalLines: lines.length,
        metadata: {
          pages: infoResult.total,
          title: infoResult.info?.Title,
          author: infoResult.info?.Author,
          creationDate: creationDate ?? undefined,
          creator: infoResult.info?.Creator,
          producer: infoResult.info?.Producer
        }
      }

      log.info('PDF metadata extraction successful', {
        path: pathMetadata,
        ...createPdfPageCountMetadata(result.metadata.pages),
        ...createPdfLineCountMetadata(result.totalLines),
        textLength: createCountPlaceholder('length', cleanedText.length)
      })

      return result
    } catch (error) {
      const pdfError = toPdfError(error, 'PDF_METADATA_EXTRACTION_FAILED', {
        path: pathMetadata
      })

      log.error('PDF metadata extraction failed', {
        code: pdfError.code,
        metadata: pdfError.metadata
      })

      throw pdfError
    } finally {
      if (parser) {
        await parser.destroy()
      }
    }
  },

  /**
   * Get basic PDF information without extracting full text
   */
  'pdf-get-info': async (
    _event: IpcMainInvokeEvent,
    { filePath }: { filePath: string }
  ): Promise<{ pages: number; title?: string; author?: string }> => {
    const { safePath, metadata: pathMetadata } = await assertPdfFileSafe(filePath)

    log.info('Getting PDF info', {
      path: pathMetadata
    })

    let parser: PDFParse | undefined
    try {
      const dataBuffer = await fs.readFile(safePath)
      parser = createPdfParser(dataBuffer, {
        path: pathMetadata
      })

      let infoResult
      try {
        infoResult = await parser.getInfo()
      } catch (error) {
        throw toPdfError(error, 'PDF_PARSE_FAILED', {
          path: pathMetadata
        })
      }

      const result = {
        pages: infoResult.total,
        title: infoResult.info?.Title,
        author: infoResult.info?.Author
      }

      log.info('PDF info extraction successful', {
        path: pathMetadata,
        ...createPdfPageCountMetadata(result.pages)
      })

      return result
    } catch (error) {
      const pdfError = toPdfError(error, 'PDF_INFO_EXTRACTION_FAILED', {
        path: pathMetadata
      })

      log.error('PDF info extraction failed', {
        code: pdfError.code,
        metadata: pdfError.metadata
      })

      throw pdfError
    } finally {
      if (parser) {
        await parser.destroy()
      }
    }
  },

  /**
   * Check if file is a PDF
   */
  'pdf-is-pdf-file': async (
    _event: IpcMainInvokeEvent,
    { filePath }: { filePath: string }
  ): Promise<boolean> => {
    return isPdfFile(filePath)
  }
} as const
