/**
 * FetchWebsite tool implementation with line range support
 */

import { Tool } from '@aws-sdk/client-bedrock-runtime'
import { ipc } from '../../../ipc-client'
import { BaseTool } from '../../base/BaseTool'
import { ValidationResult, FetchWebsiteOptions } from '../../base/types'
import { ExecutionError, NetworkError } from '../../base/errors'
import { toFileToken } from '../../../../common/security/pathTokens'
import {
  filterByLineRange,
  getLineRangeInfo,
  validateLineRange
} from '../../../lib/line-range-utils'

/**
 * Input type for FetchWebsiteTool
 */
interface FetchWebsiteInput {
  type: 'fetchWebsite'
  url: string
  options?: FetchWebsiteOptions
}

interface SaveWebsiteContentResult {
  success: boolean
  filePath?: string
  error?: string
}

type SaveVariant = 'original' | 'cleaned'

interface SaveTask {
  variant: SaveVariant
  format: 'html' | 'txt'
  contentLength: number
  promise: Promise<SaveWebsiteContentResult>
}

/**
 * Tool for fetching website content with line range support
 */
export class FetchWebsiteTool extends BaseTool<FetchWebsiteInput, string> {
  static readonly toolName = 'fetchWebsite'
  static readonly toolDescription = `Fetch content from a specified URL with line range filtering support. If the cleaning option is true, extracts plain text content from HTML by removing markup and unnecessary elements. Default is false.`

  readonly name = FetchWebsiteTool.toolName
  readonly description = FetchWebsiteTool.toolDescription

  /**
   * AWS Bedrock tool specification
   */
  static readonly toolSpec: Tool['toolSpec'] = {
    name: FetchWebsiteTool.toolName,
    description: FetchWebsiteTool.toolDescription,
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL to fetch content from'
          },
          options: {
            type: 'object',
            description: 'Optional request configurations',
            properties: {
              method: {
                type: 'string',
                description: 'HTTP method (GET, POST, etc.)',
                enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']
              },
              headers: {
                type: 'object',
                description: 'Request headers',
                additionalProperties: {
                  type: 'string'
                }
              },
              body: {
                type: 'string',
                description: 'Request body (for POST, PUT, etc.)'
              },
              cleaning: {
                type: 'boolean',
                description:
                  'Optional. If true, extracts plain text content from HTML by removing markup and unnecessary elements. Default is false.'
              },
              lines: {
                type: 'object',
                description: 'Line range to display from the fetched content',
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
              },
              saveToFile: {
                type: 'object',
                description: 'Save the fetched content to a file',
                properties: {
                  filename: {
                    type: 'string',
                    description: 'Custom filename (optional, auto-generated if not provided)'
                  },
                  directory: {
                    type: 'string',
                    description:
                      'Directory to save the file (optional, uses project downloads directory if not provided)'
                  },
                  format: {
                    type: 'string',
                    description: 'Format to save the content',
                    enum: ['original', 'cleaned', 'both']
                  }
                }
              }
            }
          }
        },
        required: ['url']
      }
    }
  } as const

  /**
   * System prompt description
   */
  /**
   * Validate input
   */
  protected validateInput(input: FetchWebsiteInput): ValidationResult {
    const errors: string[] = []

    if (!input.url) {
      errors.push('URL is required')
    }

    if (typeof input.url !== 'string') {
      errors.push('URL must be a string')
    }

    if (input.url && !this.isValidUrl(input.url)) {
      errors.push('Invalid URL format')
    }

    if (input.options) {
      // Line range validation
      if (input.options.lines) {
        const lineRangeErrors = validateLineRange(input.options.lines)
        errors.push(...lineRangeErrors)
      }

      if (input.options.cleaning !== undefined && typeof input.options.cleaning !== 'boolean') {
        errors.push('cleaning must be a boolean')
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    }
  }

  /**
   * Execute the tool
   */
  protected async executeInternal(input: FetchWebsiteInput): Promise<string> {
    const { url, options } = input
    const { cleaning, lines, saveToFile, ...requestOptions } = options || {}
    const sanitizedInput = this.sanitizeInputForLogging(input) as Partial<FetchWebsiteInput>
    const sanitizedUrl =
      typeof sanitizedInput === 'object' && sanitizedInput !== null && typeof sanitizedInput.url === 'string'
        ? sanitizedInput.url
        : this.sanitizeUrlForMetadata(url)
    const sanitizedOptions =
      typeof sanitizedInput === 'object' && sanitizedInput !== null ? sanitizedInput.options : undefined
    const sanitizedDirectoryToken = saveToFile?.directory ? toFileToken(saveToFile.directory) : undefined

    this.logger.debug('Fetching website content.', {
      url: sanitizedUrl,
      method: requestOptions.method || 'GET',
      cleaning: Boolean(cleaning),
      hasLineRange: Boolean(lines),
      hasSaveRequest: Boolean(saveToFile)
    })

    try {
      // Fetch content using type-safe IPC
      this.logger.info('Sending website fetch request.', { url: sanitizedUrl })

      const response = await ipc('fetch-website', [url, requestOptions])

      this.logger.debug('Website fetch succeeded.', {
        url: sanitizedUrl,
        statusCode: response.status,
        contentLength:
          typeof response.data === 'string'
            ? response.data.length
            : JSON.stringify(response.data).length,
        contentType: response.headers['content-type']
      })

      const originalContent =
        typeof response.data === 'string' ? response.data : JSON.stringify(response.data, null, 2)
      let processedContent = originalContent

      // Apply content cleaning if requested
      let cleanedContent: string | undefined
      if (cleaning) {
        cleanedContent = this.extractMainContent(originalContent)
        processedContent = cleanedContent
        this.logger.debug('Website content cleaned.', {
          url: sanitizedUrl,
          originalLength: originalContent.length,
          cleanedLength: cleanedContent.length
        })
      }

      // Apply automatic truncation if content exceeds token limit
      if (this.shouldTruncateContent(processedContent)) {
        const originalLength = processedContent.length
        processedContent = this.truncateContentMiddleOut(processedContent)
        this.logger.warn('Website content truncated due to token limit.', {
          url: sanitizedUrl,
          originalLength,
          truncatedLength: processedContent.length,
          maxTokensLimit: this.getMaxTokensLimit(),
          strategy: 'middle-out'
        })
      }

      // Handle file saving if requested
      const saveResults: string[] = []
      const failureSummaries: string[] = []
      if (saveToFile) {
        try {
          const saveTasks: SaveTask[] = []

          if (
            saveToFile.format === 'original' ||
            saveToFile.format === 'both' ||
            !saveToFile.format
          ) {
            saveTasks.push({
              variant: 'original',
              format: 'html',
              contentLength: originalContent.length,
              promise: ipc('save-website-content', {
                content: originalContent,
                url,
                filename: saveToFile.filename,
                directory: saveToFile.directory,
                format: 'html'
              })
            })
          }

          if (saveToFile.format === 'cleaned' || saveToFile.format === 'both') {
            const contentToSave = cleanedContent || this.extractMainContent(originalContent)
            saveTasks.push({
              variant: 'cleaned',
              format: 'txt',
              contentLength: contentToSave.length,
              promise: ipc('save-website-content', {
                content: contentToSave,
                url,
                filename: saveToFile.filename ? `${saveToFile.filename}_cleaned` : undefined,
                directory: saveToFile.directory,
                format: 'txt'
              })
            })
          }

          if (saveTasks.length > 0) {
            this.logger.info('Saving fetched website content.', {
              url: sanitizedUrl,
              directory: sanitizedDirectoryToken,
              variants: saveTasks.map((task) => task.variant)
            })

            const results = await Promise.all(saveTasks.map((task) => task.promise))

            results.forEach((result, index) => {
              const task = saveTasks[index]
              const fileToken = result.filePath ? toFileToken(result.filePath) : undefined
              const variantLabel = this.getSaveVariantLabel(task.variant)

              if (result.success) {
                saveResults.push(
                  fileToken
                    ? `✓ Saved ${variantLabel}: ${fileToken}`
                    : `✓ Saved ${variantLabel}.`
                )
                this.logger.info('Website content saved.', {
                  url: sanitizedUrl,
                  variant: task.variant,
                  format: task.format,
                  filePath: fileToken,
                  directory: sanitizedDirectoryToken,
                  contentLength: task.contentLength
                })
              } else {
                const errorMessage =
                  typeof result.error === 'string'
                    ? this.truncateForLogging(result.error, 200)
                    : undefined
                saveResults.push('✗ Failed to save website content.')
                failureSummaries.push(`  • Variant: ${variantLabel}`)
                this.logger.error('Failed to save website content.', {
                  url: sanitizedUrl,
                  variant: task.variant,
                  format: task.format,
                  directory: sanitizedDirectoryToken,
                  errorMessage
                })
              }
            })
          }
        } catch (error) {
          const errorName = error instanceof Error ? error.name : 'UnknownError'
          const errorMessage = this.truncateForLogging(
            error instanceof Error ? error.message : String(error),
            200
          )
          saveResults.push('✗ Failed to save website content.')
          this.logger.error('Failed to save website content (exception).', {
            url: sanitizedUrl,
            directory: sanitizedDirectoryToken,
            errorName,
            errorMessage
          })
        }
      }

      // Apply line range filtering
      const filteredContent = filterByLineRange(processedContent, lines)

      // Generate line range info for header
      const totalLines = processedContent.split('\n').length
      const lineInfo = getLineRangeInfo(totalLines, lines)
      let header = `Website Content: ${url}${lineInfo}\n${'='.repeat(url.length + lineInfo.length + 18)}\n`

      // Add save results to header if any
      if (saveResults.length > 0) {
        header += `\nSave Results:\n${saveResults.join('\n')}\n`
        if (failureSummaries.length > 0) {
          header += `${failureSummaries.join('\n')}\n`
        }
        header += '\n'
      }

      this.logger.info('Website content retrieved successfully', {
        url: sanitizedUrl,
        totalLines,
        hasLineRange: !!lines,
        contentLength: filteredContent.length,
        filesSaved: saveResults.length
      })

      return header + filteredContent
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError'
      const rawErrorMessage = error instanceof Error ? error.message : String(error)
      const errorMessage = this.truncateForLogging(rawErrorMessage, 200)

      this.logger.error('Failed to fetch website content.', {
        url: sanitizedUrl,
        errorName,
        errorMessage,
        options: sanitizedOptions
      })

      if (rawErrorMessage.includes('net::')) {
        throw new NetworkError('Network error fetching website.', this.name, sanitizedUrl, undefined, {
          errorName,
          errorMessage
        })
      }

      throw new ExecutionError('Failed to fetch website content.', this.name, error instanceof Error ? error : undefined, {
        url: sanitizedUrl,
        errorName,
        errorMessage
      })
    }
  }

  private getSaveVariantLabel(variant: SaveVariant): string {
    return variant === 'cleaned' ? 'cleaned text content' : 'original HTML content'
  }

  private sanitizeUrlForMetadata(url: string): string {
    try {
      const parsed = new URL(url)
      return `${parsed.protocol}//${parsed.host}${parsed.pathname}`
    } catch {
      return '[INVALID URL]'
    }
  }

  /**
   * Extract main content from HTML (basic implementation)
   */
  private extractMainContent(html: string): string {
    // Remove script and style tags
    let content = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    content = content.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')

    // Remove HTML tags
    content = content.replace(/<[^>]+>/g, ' ')

    // Decode HTML entities
    content = content
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")

    // Clean up whitespace
    content = content.replace(/\s+/g, ' ').trim()

    return content
  }

  /**
   * Validate URL format
   */
  private isValidUrl(url: string): boolean {
    try {
      new URL(url)
      return true
    } catch {
      return false
    }
  }

  /**
   * Get the maximum token limit from current LLM settings
   */
  private getMaxTokensLimit(): number {
    const llm = this.store.get('llm')

    // Use LLM-specific limit if available, otherwise use default
    const defaultLimit = 50000 // Default fallback

    if (llm?.maxTokensLimit) {
      return llm.maxTokensLimit
    }

    return defaultLimit
  }

  /**
   * Check if content should be truncated based on token limit
   */
  private shouldTruncateContent(content: string): boolean {
    const maxTokensLimit = this.getMaxTokensLimit()

    // Estimate tokens: roughly 1 character = 0.75 tokens for mixed content
    // Being conservative and using 0.8 as approximation
    const estimatedTokens = Math.ceil(content.length * 0.8)

    return estimatedTokens > maxTokensLimit
  }

  /**
   * Truncate content using middle-out strategy
   * Keeps the beginning (40%) and end (40%) of content, omitting middle (20%)
   */
  private truncateContentMiddleOut(content: string): string {
    const maxTokensLimit = this.getMaxTokensLimit()

    // Convert token limit back to approximate character limit
    const maxLength = Math.floor(maxTokensLimit / 0.8)

    if (content.length <= maxLength) {
      return content
    }

    // Split ratio: 40% front, 40% back
    const frontRatio = 0.4
    const backRatio = 0.4

    const frontLength = Math.floor(maxLength * frontRatio)
    const backLength = Math.floor(maxLength * backRatio)

    // Try to break at word/line boundaries for better readability
    const frontContent = this.smartTruncate(content, 0, frontLength, 'end')
    const backContent = this.smartTruncate(
      content,
      content.length - backLength,
      content.length,
      'start'
    )

    const omittedLength = content.length - frontLength - backLength
    const truncationMessage = `\n\n[Content truncated... (${omittedLength.toLocaleString()} characters omitted)]\n\n`

    return frontContent + truncationMessage + backContent
  }

  /**
   * Smart truncation that tries to break at word/line boundaries
   */
  private smartTruncate(
    content: string,
    start: number,
    end: number,
    breakDirection: 'start' | 'end'
  ): string {
    const rawSlice = content.slice(start, end)

    if (breakDirection === 'end') {
      // For front content, try to end at a complete word or line
      const lastNewline = rawSlice.lastIndexOf('\n')
      const lastSpace = rawSlice.lastIndexOf(' ')

      if (lastNewline > rawSlice.length * 0.8) {
        return rawSlice.slice(0, lastNewline)
      } else if (lastSpace > rawSlice.length * 0.8) {
        return rawSlice.slice(0, lastSpace)
      }
    } else {
      // For back content, try to start at a complete word or line
      const firstNewline = rawSlice.indexOf('\n')
      const firstSpace = rawSlice.indexOf(' ')

      if (firstNewline >= 0 && firstNewline < rawSlice.length * 0.2) {
        return rawSlice.slice(firstNewline + 1)
      } else if (firstSpace >= 0 && firstSpace < rawSlice.length * 0.2) {
        return rawSlice.slice(firstSpace + 1)
      }
    }

    return rawSlice
  }

  /**
   * Override to return error as string for compatibility
   */
  protected shouldReturnErrorAsString(): boolean {
    return true
  }

  /**
   * Override to sanitize URL parameters from logs
   */
  protected sanitizeInputForLogging(input: FetchWebsiteInput): any {
    try {
      const urlObj = new URL(input.url)
      // Remove sensitive query parameters
      const sanitizedUrl = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`

      return {
        ...input,
        url: sanitizedUrl,
        options: {
          ...input.options,
          // Remove potentially sensitive headers
          headers: input.options?.headers ? '[REDACTED]' : undefined
        }
      }
    } catch {
      return {
        ...input,
        url: '[INVALID URL]'
      }
    }
  }
}
