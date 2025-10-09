/**
 * PDF handlers for main process
 */

import { IpcMainInvokeEvent, app } from 'electron'
import * as fs from 'fs/promises'
import * as path from 'path'
import os from 'os'
import pdfParse from 'pdf-parse'
import { log } from '../../common/logger'
import { store } from '../../preload/store'
import {
  buildAllowedOutputDirectories,
  ensurePathWithinAllowedDirectories
} from '../security/path-utils'

export interface LineRange {
  from?: number
  to?: number
}

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

/**
 * Apply line range filtering to text content
 */
function filterByLineRange(content: string, lineRange?: LineRange): string {
  if (!lineRange) return content

  const lines = content.split('\n')
  const from = Math.max(1, lineRange.from || 1)
  const to = Math.min(lines.length, lineRange.to || lines.length)

  // Convert 1-based to 0-based array indices and slice
  return lines.slice(from - 1, to).join('\n')
}

/**
 * Check if the file is a PDF based on file extension
 */
function isPdfFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  return ext === '.pdf'
}

/**
 * Validate PDF file path
 */
const MAX_PDF_BYTES = 25 * 1024 * 1024

function getDocumentPathContext(): { projectPath?: string; userDataPath?: string } {
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

function getAllowedDocumentDirectories(): string[] {
  const { projectPath, userDataPath } = getDocumentPathContext()

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
  })
}

function resolvePdfPath(filePath: string): string {
  const { projectPath } = getDocumentPathContext()
  const allowedDirectories = getAllowedDocumentDirectories()
  const candidatePath = path.isAbsolute(filePath)
    ? filePath
    : projectPath
    ? path.resolve(projectPath, filePath)
    : path.resolve(filePath)

  return ensurePathWithinAllowedDirectories(candidatePath, allowedDirectories)
}

async function assertPdfFileSafe(filePath: string): Promise<string> {
  const safePath = resolvePdfPath(filePath)

  if (!isPdfFile(safePath)) {
    throw new Error(`File ${filePath} is not a PDF file`)
  }

  const stats = await fs.stat(safePath)
  if (stats.size > MAX_PDF_BYTES) {
    throw new Error('PDF file is too large to process safely')
  }

  return safePath
}

export const pdfHandlers = {
  /**
   * Extract text from PDF file with optional line range filtering
   */
  'pdf-extract-text': async (
    _event: IpcMainInvokeEvent,
    { filePath, lineRange }: { filePath: string; lineRange?: LineRange }
  ): Promise<string> => {
    log.info('Extracting text from PDF', { filePath, hasLineRange: !!lineRange })

    try {
      const safePath = await assertPdfFileSafe(filePath)

      const dataBuffer = await fs.readFile(safePath)
      const pdfData = await pdfParse(dataBuffer)
      const cleanedText = cleanupText(pdfData.text)

      // Apply line range filtering if specified
      const result = filterByLineRange(cleanedText, lineRange)

      log.info('PDF text extraction successful', {
        filePath: safePath,
        pages: pdfData.numpages,
        originalLength: cleanedText.length,
        filteredLength: result.length
      })

      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      log.error('PDF text extraction failed', {
        filePath,
        error: errorMessage
      })
      throw new Error(`Failed to extract text from PDF ${filePath}: ${errorMessage}`)
    }
  },

  /**
   * Extract text with metadata from PDF file
   */
  'pdf-extract-metadata': async (
    _event: IpcMainInvokeEvent,
    { filePath }: { filePath: string }
  ): Promise<PdfContent> => {
    log.info('Extracting PDF metadata', { filePath })

    try {
      const safePath = await assertPdfFileSafe(filePath)

      const dataBuffer = await fs.readFile(safePath)
      const pdfData = await pdfParse(dataBuffer)
      const cleanedText = cleanupText(pdfData.text)
      const lines = cleanedText.split('\n')

      const result: PdfContent = {
        text: cleanedText,
        totalLines: lines.length,
        metadata: {
          pages: pdfData.numpages || 0,
          title: pdfData.info?.Title,
          author: pdfData.info?.Author,
          creationDate: pdfData.info?.CreationDate
            ? new Date(pdfData.info.CreationDate)
            : undefined,
          creator: pdfData.info?.Creator,
          producer: pdfData.info?.Producer
        }
      }

      log.info('PDF metadata extraction successful', {
        filePath: safePath,
        pages: result.metadata.pages,
        totalLines: result.totalLines,
        title: result.metadata.title
      })

      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      log.error('PDF metadata extraction failed', {
        filePath,
        error: errorMessage
      })
      throw new Error(`Failed to parse PDF file ${filePath}: ${errorMessage}`)
    }
  },

  /**
   * Get basic PDF information without extracting full text
   */
  'pdf-get-info': async (
    _event: IpcMainInvokeEvent,
    { filePath }: { filePath: string }
  ): Promise<{ pages: number; title?: string; author?: string }> => {
    log.info('Getting PDF info', { filePath })

    try {
      const safePath = await assertPdfFileSafe(filePath)

      const dataBuffer = await fs.readFile(safePath)
      const pdfData = await pdfParse(dataBuffer, {
        max: 1 // Only parse first page for metadata
      })

      const result = {
        pages: pdfData.numpages || 0,
        title: pdfData.info?.Title,
        author: pdfData.info?.Author
      }

      log.info('PDF info extraction successful', {
        filePath: safePath,
        pages: result.pages,
        title: result.title
      })

      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      log.error('PDF info extraction failed', {
        filePath,
        error: errorMessage
      })
      throw new Error(`Failed to get PDF info for ${filePath}: ${errorMessage}`)
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
