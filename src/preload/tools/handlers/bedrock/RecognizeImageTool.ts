/**
 * RecognizeImage tool implementation
 */

import { Tool } from '@aws-sdk/client-bedrock-runtime'
import * as fs from 'fs/promises'
import { DEFAULT_RECOGNIZE_IMAGE_MODEL_ID } from '../../../../common/models/defaults'
import { ToolResult } from '../../../../types/tools'
import { ipc } from '../../../ipc-client'
import { BaseTool } from '../../base/BaseTool'
import { ValidationResult } from '../../base/types'

/**
 * Input type for RecognizeImageTool
 */
interface RecognizeImageInput {
  type: 'recognizeImage'
  imagePaths: string[] // Supports multiple images
  prompt?: string
}

/**
 * Result type for RecognizeImageTool - matches legacy implementation
 */
interface RecognizeImageResult extends ToolResult {
  name: 'recognizeImage'
  result: {
    images: Array<{
      path: string
      sanitizedPath: string
      description: string
      success: boolean
      errorDetails?: Record<string, unknown>
    }>
    modelUsed: string
  }
}

/**
 * Tool for recognizing and analyzing images using AWS Bedrock
 */
export class RecognizeImageTool extends BaseTool<RecognizeImageInput, RecognizeImageResult> {
  static readonly toolName = 'recognizeImage'
  static readonly toolDescription =
    "Analyze and describe multiple images (up to 5) using Amazon Bedrock's Claude vision capabilities. The tool processes images in parallel and returns detailed descriptions.\n\nAnalyze and describe image content. Supports multiple images simultaneously."

  readonly name = RecognizeImageTool.toolName
  readonly description = RecognizeImageTool.toolDescription

  /**
   * AWS Bedrock tool specification
   */
  static readonly toolSpec: Tool['toolSpec'] = {
    name: RecognizeImageTool.toolName,
    description: RecognizeImageTool.toolDescription,
    inputSchema: {
      json: {
        type: 'object',
        properties: {
          imagePaths: {
            type: 'array',
            items: {
              type: 'string'
            },
            description:
              'Paths to the image files to analyze (maximum 5). Supports common formats: .jpg, .jpeg, .png, .gif, .webp'
          },
          prompt: {
            type: 'string',
            description:
              'Custom prompt to guide the image analysis (e.g., "Describe this image in detail", "What text appears in this image?", etc.). Default: "Describe this image in detail."'
          }
        },
        required: ['imagePaths']
      }
    }
  } as const

  /**
   * Validate input
   */
  protected validateInput(input: RecognizeImageInput): ValidationResult {
    const errors: string[] = []

    if (!input.imagePaths) {
      errors.push('Image paths are required')
    }

    if (!Array.isArray(input.imagePaths)) {
      errors.push('Image paths must be an array')
    }

    if (input.imagePaths && input.imagePaths.length === 0) {
      errors.push('At least one image path is required')
    }

    if (input.imagePaths && input.imagePaths.length > 5) {
      errors.push('Maximum 5 images are allowed')
    }

    if (input.imagePaths) {
      input.imagePaths.forEach((path, index) => {
        if (typeof path !== 'string') {
          errors.push(`Image path at index ${index} must be a string`)
        }
        if (path && path.trim().length === 0) {
          errors.push(`Image path at index ${index} cannot be empty`)
        }
      })
    }

    if (input.prompt !== undefined && typeof input.prompt !== 'string') {
      errors.push('Prompt must be a string')
    }

    return {
      isValid: errors.length === 0,
      errors
    }
  }

  /**
   * Execute the tool - following legacy implementation pattern
   */
  protected async executeInternal(input: RecognizeImageInput): Promise<RecognizeImageResult> {
    const { imagePaths, prompt } = input

    // Limit to maximum 5 images (following legacy implementation)
    const limitedPaths = imagePaths.slice(0, 5)

    this.logger.debug('Recognizing multiple images', {
      imageCount: limitedPaths.length,
      hasCustomPrompt: !!prompt
    })

    try {
      // Get the configured model ID from store (using recognizeImageTool setting)
      const recognizeImageSetting = this.store.get('recognizeImageTool')
      const modelId = recognizeImageSetting?.modelId || DEFAULT_RECOGNIZE_IMAGE_MODEL_ID

      // Process in parallel to match the legacy implementation
      const results = await Promise.all(
        limitedPaths.map(async (imagePath) => {
          const sanitizedPath = this.sanitizePath(imagePath)
          try {
            // Validate that the file exists before processing
            try {
              await fs.access(imagePath)
            } catch (error) {
              const errorName = error instanceof Error ? error.name : 'UnknownError'
              const errorCode =
                error instanceof Error && 'code' in error && typeof (error as NodeJS.ErrnoException).code === 'string'
                  ? (error as NodeJS.ErrnoException).code
                  : undefined

              this.logger.error('Image file not found', {
                imagePath: sanitizedPath,
                errorName,
                ...(errorCode ? { errorCode } : {})
              })
              throw new Error('Image file not found', {
                cause: {
                  imagePath: sanitizedPath,
                  errorName,
                  ...(errorCode ? { errorCode } : {})
                }
              })
            }

            // Perform each recognition call by invoking the main process through type-safe IPC
            const description = await ipc('bedrock:recognizeImage', {
              imagePaths: [imagePath], // Single image per call
              prompt,
              modelId
            })

            this.logger.debug('Successfully recognized image', {
              sanitizedPath
            })

            return {
              path: imagePath,
              sanitizedPath,
              description: description || 'No description available',
              success: true
            }
          } catch (error) {
            const errorDetails =
              error instanceof Error && typeof error.cause === 'object' && error.cause !== null
                ? (error.cause as Record<string, unknown>)
                : undefined

            const errorName = error instanceof Error ? error.name : 'UnknownError'
            const errorCode =
              error instanceof Error && 'code' in error && typeof (error as NodeJS.ErrnoException).code === 'string'
                ? (error as NodeJS.ErrnoException).code
                : undefined

            this.logger.error('Failed to recognize image', {
              imagePath: sanitizedPath,
              errorName,
              ...(errorCode ? { errorCode } : {}),
              ...(errorDetails ? { errorDetails } : {})
            })

            return {
              path: imagePath,
              sanitizedPath,
              description: 'Failed to analyze this image.',
              success: false,
              errorDetails: {
                ...(errorDetails ?? { imagePath: sanitizedPath }),
                errorName,
                ...(errorCode ? { errorCode } : {})
              }
            }
          }
        })
      )

      const successCount = results.filter((r) => r.success).length

      this.logger.info('Multiple image recognition completed', {
        total: limitedPaths.length,
        success: successCount,
        failed: limitedPaths.length - successCount
      })

      return {
        name: 'recognizeImage',
        success: successCount > 0, // True when at least one image succeeded
        message: `Analyzed ${successCount} of ${limitedPaths.length} images successfully`,
        result: {
          images: results,
          modelUsed: modelId
        },
        details: {
          sanitizedPaths: limitedPaths.map((path) => this.sanitizePath(path)),
          successCount,
          failureCount: limitedPaths.length - successCount
        }
      }
    } catch (error) {
      const metadata =
        error instanceof Error && typeof error.cause === 'object' && error.cause !== null
          ? (error.cause as Record<string, unknown>)
          : undefined

      this.logger.error('Failed to recognize images', {
        error: error instanceof Error ? error.message : String(error),
        imageCount: limitedPaths.length,
        ...(metadata ? { errorDetails: metadata } : {})
      })

      if (error instanceof Error) {
        throw error
      }

      throw new Error('Failed to recognize images', {
        cause: {
          detail: typeof error === 'string' ? error : JSON.stringify(error)
        }
      })
    }
  }

  /**
   * Sanitize file path for logging
   */
  private sanitizePath(path: string): string {
    // Extract just the filename for logging
    const parts = path.split(/[/\\]/)
    return parts[parts.length - 1] || path
  }

  /**
   * Override to return error as string for compatibility
   */
  protected shouldReturnErrorAsString(): boolean {
    return true
  }

  /**
   * Override to sanitize paths for logging
   */
  protected sanitizeInputForLogging(input: RecognizeImageInput): any {
    return {
      ...input,
      imagePaths: input.imagePaths.map((path) => this.sanitizePath(path)),
      prompt: input.prompt ? this.truncateForLogging(input.prompt, 100) : undefined
    }
  }
}
