/**
 * ReadFiles tool implementation with line range support
 */

import * as fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { Tool } from '@aws-sdk/client-bedrock-runtime'
import { BaseTool } from '../../base/BaseTool'
import { ValidationResult, ReadFileOptions } from '../../base/types'
import { ExecutionError } from '../../base/errors'
import {
  filterByLineRange,
  getLineRangeInfo,
  validateLineRange
} from '../../../lib/line-range-utils'
import { PdfReader } from '../../../lib/PdfReader'
import { DocxReader } from '../../../lib/DocxReader'
import {
  buildAllowedOutputDirectories,
  ensurePathWithinAllowedDirectories
} from '../../../../common/security/pathGuards'

const MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024

/**
 * Input type for ReadFilesTool
 */
interface ReadFilesInput {
  type: 'readFiles'
  paths: string[]
  options?: ReadFileOptions
}

/**
 * Tool for reading file contents with line range support
 */
export class ReadFilesTool extends BaseTool<ReadFilesInput, string> {
  static readonly toolName = 'readFiles'
  static readonly toolDescription =
    'Read the content of multiple files at the specified paths with line range filtering support. For Excel files, the content is converted to CSV format. For PDF files, text content is extracted. For Word documents (.docx), text content is extracted.\n\nRead content from multiple files simultaneously. Supports line range filtering, Excel conversion, PDF text extraction, and DOCX text extraction.'

  readonly name = ReadFilesTool.toolName
  readonly description = ReadFilesTool.toolDescription

  private getFilesystemContext(): { projectPath?: string; userDataPath?: string } {
    const projectPathValue = this.store.get('projectPath')
    const projectPath =
      typeof projectPathValue === 'string' && projectPathValue.trim().length > 0
        ? (projectPathValue as string)
        : undefined
    const userDataPathValue = this.store.get('userDataPath')
    const userDataPath =
      typeof userDataPathValue === 'string' && userDataPathValue.trim().length > 0
        ? (userDataPathValue as string)
        : undefined

    return { projectPath, userDataPath }
  }

  private getAllowedReadDirectories(): string[] {
    const { projectPath, userDataPath } = this.getFilesystemContext()
    return buildAllowedOutputDirectories({
      projectPath,
      userDataPath,
      additional: [os.tmpdir()]
    }).sort()
  }

  private resolveInputPath(filePath: string): string {
    const allowedDirectories = this.getAllowedReadDirectories()
    const trimmed = filePath?.trim()
    if (!trimmed) {
      throw new Error('File path must be provided')
    }

    const { projectPath } = this.getFilesystemContext()
    const candidate = path.isAbsolute(trimmed)
      ? trimmed
      : projectPath
      ? path.resolve(projectPath, trimmed)
      : path.resolve(trimmed)

    return ensurePathWithinAllowedDirectories(candidate, allowedDirectories)
  }

  private async readTextFileSafe(
    filePath: string,
    encoding: BufferEncoding
  ): Promise<{ content: string; safePath: string }> {
    const safePath = this.resolveInputPath(filePath)
    const stats = await fs.stat(safePath)
    if (stats.size > MAX_TEXT_FILE_BYTES) {
      throw new ExecutionError(
        `File ${filePath} is too large to read (max ${MAX_TEXT_FILE_BYTES} bytes)`,
        this.name
      )
    }

    const content = await fs.readFile(safePath, encoding)
    return { content, safePath }
  }

  /**
   * AWS Bedrock tool specification
   */
  static readonly toolSpec: Tool['toolSpec'] = {
    name: ReadFilesTool.toolName,
    description: ReadFilesTool.toolDescription,
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          paths: {
            type: 'array',
            items: {
              type: 'string'
            },
            description:
              'Array of file paths to read. Supports text files, Excel files (.xlsx, .xls), PDF files (.pdf), and Word documents (.docx).'
          },
          options: {
            type: 'object',
            description: 'Optional configurations for reading files',
            properties: {
              encoding: {
                type: 'string',
                description: 'File encoding (default: utf-8)'
              },
              lines: {
                type: 'object',
                description: 'Line range to read from the file',
                properties: {
                  from: {
                    type: 'number',
                    description: 'Starting line number (1-based, inclusive)'
                  },
                  to: {
                    type: 'number',
                    description: 'Ending line number (1-based, inclusive)'
                  }
                }
              }
            }
          }
        },
        required: ['paths']
      }
    }
  } as const

  /**
   * Validate input
   */
  protected validateInput(input: ReadFilesInput): ValidationResult {
    const errors: string[] = []

    // Basic validation
    if (!input.paths) {
      errors.push('Paths array is required')
    }

    if (!Array.isArray(input.paths)) {
      errors.push('Paths must be an array')
    } else if (input.paths.length === 0) {
      errors.push('At least one path is required')
    } else {
      input.paths.forEach((path, index) => {
        if (typeof path !== 'string') {
          errors.push(`Path at index ${index} must be a string`)
        }
      })
    }

    // Line range validation
    if (input.options?.lines) {
      const lineRangeErrors = validateLineRange(input.options.lines)
      errors.push(...lineRangeErrors)
    }

    return {
      isValid: errors.length === 0,
      errors
    }
  }

  /**
   * Execute the tool
   */
  protected async executeInternal(input: ReadFilesInput): Promise<string> {
    const { paths, options } = input

    this.logger.debug('Reading files', {
      fileCount: paths.length,
      hasLineRange: !!options?.lines
    })

    // Single file handling
    if (paths.length === 1) {
      return this.readSingleFile(paths[0], options)
    }

    // Multiple files handling
    return this.readMultipleFiles(paths, options)
  }

  /**
   * Read a single file with optional line range filtering
   */
  private async readSingleFile(filePath: string, options?: ReadFileOptions): Promise<string> {
    this.logger.debug('Reading single file', { requestedPath: filePath })

    try {
      const safePath = this.resolveInputPath(filePath)

      // Check if it's a PDF file
      if (PdfReader.isPdfFile(safePath)) {
        return this.readPdfFile(safePath, options)
      }

      // Check if it's a DOCX file
      if (DocxReader.isDocxFile(safePath)) {
        return this.readDocxFile(safePath, options)
      }

      const { content, safePath: sanitizedPath } = await this.readTextFileSafe(
        safePath,
        (options?.encoding as BufferEncoding) || 'utf-8'
      )

      this.logger.debug('File read successfully', {
        requestedPath: filePath,
        contentLength: content.length,
        safePath: sanitizedPath
      })

      return this.formatFileContent(sanitizedPath, content, options)
    } catch (error) {
      this.logger.error('Error reading file', {
        requestedPath: filePath,
        error: error instanceof Error ? error.message : String(error)
      })

      throw new ExecutionError(
        `Error reading file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
        this.name,
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Read PDF file with optional line range filtering
   */
  private async readPdfFile(filePath: string, options?: ReadFileOptions): Promise<string> {
    const safePath = this.resolveInputPath(filePath)
    this.logger.debug('Reading PDF file', {
      filePath: safePath,
      hasLineRange: !!options?.lines
    })

    try {
      const content = await PdfReader.extractText(safePath, options?.lines)

      if (!options?.lines) {
        const pdfContent = await PdfReader.extractTextWithMetadata(safePath)
        this.logger.info('PDF processed successfully', {
          filePath: safePath,
          totalLines: pdfContent.totalLines,
          pages: pdfContent.metadata.pages,
          title: pdfContent.metadata.title
        })

        if (pdfContent.totalLines > 400) {
          const suggestion = PdfReader.suggestLineRange(pdfContent.totalLines)
          if (suggestion.warning) {
            this.logger.warn(`Large PDF detected`, {
              filePath: safePath,
              totalLines: pdfContent.totalLines,
              suggestion: suggestion.warning
            })
          }
        }
      }

      return this.formatFileContent(safePath, content, options)
    } catch (error) {
      this.logger.error('Error reading PDF file', {
        requestedPath: filePath,
        error: error instanceof Error ? error.message : String(error)
      })

      throw new ExecutionError(
        `Error reading PDF file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
        this.name,
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Read DOCX file with optional line range filtering
   */
  private async readDocxFile(filePath: string, options?: ReadFileOptions): Promise<string> {
    const safePath = this.resolveInputPath(filePath)
    this.logger.debug('Reading DOCX file', {
      filePath: safePath,
      hasLineRange: !!options?.lines
    })

    try {
      const content = await DocxReader.extractText(safePath, options?.lines)

      if (!options?.lines) {
        const docxContent = await DocxReader.extractTextWithMetadata(safePath)
        this.logger.info('DOCX processed successfully', {
          filePath: safePath,
          totalLines: docxContent.totalLines,
          wordCount: docxContent.metadata.wordCount,
          characterCount: docxContent.metadata.characterCount
        })

        if (docxContent.totalLines > 400) {
          const suggestion = DocxReader.suggestLineRange(docxContent.totalLines)
          if (suggestion.warning) {
            this.logger.warn(`Large DOCX detected`, {
              filePath: safePath,
              totalLines: docxContent.totalLines,
              suggestion: suggestion.warning
            })
          }
        }
      }

      return this.formatFileContent(safePath, content, options)
    } catch (error) {
      this.logger.error('Error reading DOCX file', {
        requestedPath: filePath,
        error: error instanceof Error ? error.message : String(error)
      })

      throw new ExecutionError(
        `Error reading DOCX file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
        this.name,
        error instanceof Error ? error : undefined
      )
    }
  }

  /**
   * Read multiple files
   */
  private async readMultipleFiles(paths: string[], options?: ReadFileOptions): Promise<string> {
    this.logger.debug('Reading multiple files', { fileCount: paths.length })

    const fileContents: string[] = []

    // Read each file
    for (const filePath of paths) {
      try {
        this.logger.verbose('Reading file during batch read', { requestedPath: filePath })

        let formattedContent: string
        const safePath = this.resolveInputPath(filePath)

        // Check if it's a PDF file
        if (PdfReader.isPdfFile(safePath)) {
          const content = await PdfReader.extractText(safePath, options?.lines)
          formattedContent = this.formatFileContent(safePath, content, options)
        } else if (DocxReader.isDocxFile(safePath)) {
          // Check if it's a DOCX file
          const content = await DocxReader.extractText(safePath, options?.lines)
          formattedContent = this.formatFileContent(safePath, content, options)
        } else {
          const { content } = await this.readTextFileSafe(
            safePath,
            (options?.encoding as BufferEncoding) || 'utf-8'
          )
          formattedContent = this.formatFileContent(safePath, content, options)
        }

        fileContents.push(formattedContent)

        this.logger.verbose('File read successfully during batch read', {
          requestedPath: filePath,
          contentLength: formattedContent.length
        })
      } catch (error) {
        this.logger.error('Error reading file during batch read', {
          requestedPath: filePath,
          error: error instanceof Error ? error.message : String(error)
        })
        fileContents.push(
          `## Error reading file: ${filePath}\nError: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      }
    }

    // Combine content
    const combinedContent = fileContents.join('\n\n')
    this.logger.info('Completed multi-file read', { fileCount: paths.length })

    return combinedContent
  }

  /**
   * Format file content with header and line range filtering
   */
  private formatFileContent(filePath: string, content: string, options?: ReadFileOptions): string {
    // Apply line range filtering
    const filteredContent = filterByLineRange(content, options?.lines)

    // Generate line range info for header
    const lines = content.split('\n')
    const lineInfo = getLineRangeInfo(lines.length, options?.lines)
    const header = `File: ${filePath}${lineInfo}\n${'='.repeat(filePath.length + lineInfo.length + 6)}\n`

    return header + filteredContent
  }

  /**
   * Override to return error as string for compatibility
   */
  protected shouldReturnErrorAsString(): boolean {
    return true
  }
}
