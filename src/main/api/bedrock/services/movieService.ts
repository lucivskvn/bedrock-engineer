import {
  BedrockRuntimeClient,
  StartAsyncInvokeCommand,
  GetAsyncInvokeCommand
} from '@aws-sdk/client-bedrock-runtime'
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { app } from 'electron'
import { createWriteStream } from 'fs'
import { promises as fs } from 'fs'
import { pipeline } from 'stream/promises'
import path from 'path'
import os from 'os'
import type { ServiceContext } from '../types'
import { createRuntimeClient, createS3Client } from '../client'
import type {
  GenerateMovieRequest,
  GeneratedMovie,
  AsyncInvocationStatus,
  NovaReelRequest,
  Shot
} from '../types/movie'
import {
  getNovaReelModelId,
  isNovaReelSupportedInRegion,
  isNovaReelV1_0,
  NOVA_REEL_RESOLUTION,
  NOVA_REEL_FPS,
  isValidDuration,
  getTaskTypeForRequest,
  NOVA_REEL_REGION_SUPPORT
} from '../types/movie'
import { log } from '../../../../common/logger'
import {
  buildAllowedOutputDirectories,
  ensurePathWithinAllowedDirectories
} from '../../../security/path-utils'
import { toFileToken } from '../../../../common/security/pathTokens'

const MAX_INPUT_IMAGE_BYTES = 10 * 1024 * 1024

const MOVIE_ERROR_MESSAGES = {
  input_image_not_regular_file: 'Input image must be a regular file.',
  input_image_too_large: 'Input image exceeds maximum allowed size.',
  request_prompt_missing: 'Prompt is required and cannot be empty.',
  request_prompt_too_long: 'Prompt must be 4000 characters or less.',
  request_duration_invalid: 'Requested duration is not supported.',
  request_s3_uri_missing: 'S3 URI is required for video generation.',
  request_s3_scheme_invalid: 'S3 URI must start with s3://.',
  request_seed_out_of_range: 'Seed must be between 0 and 2147483646.',
  text_video_image_limit: 'TEXT_VIDEO mode supports only a single input image.',
  input_image_format_invalid: 'Input image format is not supported.',
  prompt_image_mismatch: 'Number of prompts must match number of input images.',
  prompt_missing_for_image: 'Image prompt text cannot be empty.',
  prompt_too_long_for_image: 'Image prompt text must be 4000 characters or less.',
  prompts_require_images: 'Prompts can only be used together with input images.',
  detect_image_format_failed: 'Unable to determine image format.',
  read_image_failed: 'Failed to read input image.',
  s3_uri_invalid: 'S3 URI format is invalid.',
  s3_upload_failed: 'Failed to upload image to S3.',
  shots_images_required: 'Input images are required for building shots array.',
  start_video_no_invocation: 'Failed to start video generation: No invocation ARN returned.',
  start_video_failed: 'Failed to start video generation.',
  fallback_failed: 'Video generation fallback attempt failed.',
  invalid_request_parameters: 'Invalid request parameters provided.',
  video_generation_failed: 'Video generation failed.',
  video_generation_timeout: 'Video generation timed out.'
} as const

type MovieErrorCode = keyof typeof MOVIE_ERROR_MESSAGES

function createMovieError(code: MovieErrorCode, metadata: Record<string, unknown> = {}): Error {
  return new Error(MOVIE_ERROR_MESSAGES[code], {
    cause: {
      code,
      ...metadata
    }
  })
}

function sanitizeErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  return undefined
}

function hasErrorCause(error: unknown): error is Error & { cause?: unknown } {
  return error instanceof Error && 'cause' in error && (error as { cause?: unknown }).cause !== undefined
}

function toS3UriToken(uri?: string): string | undefined {
  if (!uri) {
    return undefined
  }

  const match = uri.match(/^s3:\/\/([^/]+)/)
  return match ? `[s3://${match[1]}]` : '[s3-uri]'
}

function summarizeNovaReelRequest(request: NovaReelRequest): Record<string, unknown> {
  return {
    taskType: request.taskType,
    hasTextToVideoImages:
      'textToVideoParams' in request && Array.isArray(request.textToVideoParams?.images)
        ? request.textToVideoParams.images.length > 0
        : undefined,
    shotCount:
      'multiShotManualParams' in request && request.multiShotManualParams
        ? request.multiShotManualParams.shots?.length || 0
        : undefined,
    videoGenerationConfig: {
      durationSeconds: request.videoGenerationConfig?.durationSeconds,
      fps: request.videoGenerationConfig?.fps,
      dimension: request.videoGenerationConfig?.dimension
    }
  }
}

export class VideoService {
  private runtimeClient: BedrockRuntimeClient
  private s3Client: S3Client
  private region: string

  constructor(private context: ServiceContext) {
    const awsCredentials = this.context.store.get('aws')

    if (
      !awsCredentials.region ||
      (!awsCredentials.useProfile &&
        (!awsCredentials.accessKeyId || !awsCredentials.secretAccessKey))
    ) {
      log.warn('AWS credentials not configured properly')
    }

    this.region = awsCredentials.region || 'us-east-1' // Default to us-east-1

    // Validate that Nova Reel is supported in the selected region
    if (!isNovaReelSupportedInRegion(this.region)) {
      log.warn('Nova Reel is not available in the configured region', {
        region: this.region,
        supportedRegions: Object.keys(NOVA_REEL_REGION_SUPPORT)
      })
    }

    this.runtimeClient = createRuntimeClient(awsCredentials)

    // S3 client for downloading generated videos
    this.s3Client = createS3Client(awsCredentials)
  }

  private getMediaPathContext(): { projectPath?: string; userDataPath?: string } {
    const projectPathValue = this.context.store.get('projectPath')
    const projectPath =
      typeof projectPathValue === 'string' && projectPathValue.trim().length > 0
        ? projectPathValue
        : undefined
    const userDataPathValue = this.context.store.get('userDataPath')
    const userDataPath =
      typeof userDataPathValue === 'string' && userDataPathValue.trim().length > 0
        ? userDataPathValue
        : undefined

    return { projectPath, userDataPath }
  }

  private getAllowedMediaDirectories(): string[] {
    const { projectPath, userDataPath } = this.getMediaPathContext()

    return buildAllowedOutputDirectories({
      projectPath,
      userDataPath,
      additional: [
        app.getPath('pictures'),
        path.join(app.getPath('pictures'), 'bedrock-engineer'),
        app.getPath('downloads'),
        path.join(app.getPath('downloads'), 'bedrock-engineer'),
        app.getPath('documents'),
        os.tmpdir()
      ]
    })
  }

  private resolveImagePath(imagePath: string): string {
    const { projectPath } = this.getMediaPathContext()
    const allowedDirectories = this.getAllowedMediaDirectories()
    const candidatePath = path.isAbsolute(imagePath)
      ? imagePath
      : projectPath
      ? path.resolve(projectPath, imagePath)
      : path.resolve(imagePath)

    return ensurePathWithinAllowedDirectories(candidatePath, allowedDirectories)
  }

  private async readSafeImageBuffer(imagePath: string): Promise<{ buffer: Buffer; safePath: string }> {
    const safePath = this.resolveImagePath(imagePath)
    const stats = await fs.stat(safePath)
    if (!stats.isFile()) {
      throw createMovieError('input_image_not_regular_file', {
        fileName: toFileToken(safePath)
      })
    }
    if (stats.size > MAX_INPUT_IMAGE_BYTES) {
      throw createMovieError('input_image_too_large', {
        fileName: toFileToken(safePath),
        fileSize: stats.size,
        maxBytes: MAX_INPUT_IMAGE_BYTES
      })
    }

    const buffer = await fs.readFile(safePath)
    return { buffer, safePath }
  }

  private validateRequest(request: GenerateMovieRequest): void {
    if (!request.prompt || request.prompt.length === 0) {
      throw createMovieError('request_prompt_missing')
    }

    if (request.prompt.length > 4000) {
      throw createMovieError('request_prompt_too_long', {
        promptLength: request.prompt.length
      })
    }

    if (!isValidDuration(request.durationSeconds)) {
      throw createMovieError('request_duration_invalid', {
        requestedDuration: request.durationSeconds
      })
    }

    if (!request.s3Uri) {
      throw createMovieError('request_s3_uri_missing')
    }

    if (!request.s3Uri.startsWith('s3://')) {
      throw createMovieError('request_s3_scheme_invalid', {
        s3UriToken: toS3UriToken(request.s3Uri)
      })
    }

    if (request.seed !== undefined && (request.seed < 0 || request.seed > 2147483646)) {
      throw createMovieError('request_seed_out_of_range', {
        seed: request.seed
      })
    }

    // Validate input images
    if (request.inputImages && request.inputImages.length > 0) {
      // For TEXT_VIDEO (6 seconds), only allow single image
      if (request.durationSeconds === 6 && request.inputImages.length > 1) {
        throw createMovieError('text_video_image_limit', {
          imageCount: request.inputImages.length
        })
      }

      // Validate each image file
      for (let i = 0; i < request.inputImages.length; i++) {
        const imagePath = request.inputImages[i]
        const ext = imagePath.toLowerCase().split('.').pop()
        if (!ext || !['png', 'jpg', 'jpeg'].includes(ext)) {
          throw createMovieError('input_image_format_invalid', {
            imageIndex: i,
            fileName: toFileToken(imagePath),
            extension: ext || '[unknown]'
          })
        }
      }

      // Validate prompts if provided
      if (request.prompts) {
        if (request.prompts.length !== request.inputImages.length) {
          throw createMovieError('prompt_image_mismatch', {
            imageCount: request.inputImages.length,
            promptCount: request.prompts.length
          })
        }

        request.prompts.forEach((prompt, index) => {
          if (!prompt || prompt.trim().length === 0) {
            throw createMovieError('prompt_missing_for_image', {
              imageIndex: index
            })
          }
          if (prompt.length > 4000) {
            throw createMovieError('prompt_too_long_for_image', {
              imageIndex: index,
              promptLength: prompt.length
            })
          }
        })
      }
    }

    // If prompts provided without images, that's an error
    if (request.prompts && !request.inputImages) {
      throw createMovieError('prompts_require_images')
    }
  }

  /**
   * Detect image format from file extension
   */
  private detectImageFormat(imagePath: string): 'png' | 'jpeg' {
    const safePath = this.resolveImagePath(imagePath)
    const ext = safePath.toLowerCase().split('.').pop()
    if (ext === 'png') return 'png'
    if (ext === 'jpg' || ext === 'jpeg') return 'jpeg'
    throw createMovieError('input_image_format_invalid', {
      fileName: toFileToken(safePath),
      extension: ext || '[unknown]'
    })
  }

  /**
   * Read image file and convert to base64
   */
  private async readImageAsBase64(imagePath: string): Promise<string> {
    try {
      const { buffer } = await this.readSafeImageBuffer(imagePath)
      return buffer.toString('base64')
    } catch (error) {
      if (hasErrorCause(error)) {
        throw error
      }

      throw createMovieError('read_image_failed', {
        fileName: toFileToken(imagePath),
        reason: sanitizeErrorMessage(error)
      })
    }
  }

  /**
   * Upload image to S3 and return the S3 URI
   */
  private async uploadImageToS3(imagePath: string, s3BaseUri: string): Promise<string> {
    try {
      // Parse S3 base URI to get bucket
      const s3Match = s3BaseUri.match(/^s3:\/\/([^/]+)/)
      if (!s3Match) {
        throw createMovieError('s3_uri_invalid', {
          s3UriToken: toS3UriToken(s3BaseUri)
        })
      }

      const bucket = s3Match[1]
      const timestamp = Date.now()
      const { buffer, safePath } = await this.readSafeImageBuffer(imagePath)
      const fileName = path.basename(safePath)
      const s3Key = `temp-images/${timestamp}/${fileName}`

      // Detect content type
      const format = this.detectImageFormat(safePath)
      const contentType = format === 'png' ? 'image/png' : 'image/jpeg'

      // Upload to S3
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: s3Key,
        Body: buffer,
        ContentType: contentType
      })

      await this.s3Client.send(command)

      return `s3://${bucket}/${s3Key}`
    } catch (error) {
      if (hasErrorCause(error)) {
        throw error
      }

      throw createMovieError('s3_upload_failed', {
        fileName: toFileToken(imagePath),
        s3UriToken: toS3UriToken(s3BaseUri),
        reason: sanitizeErrorMessage(error)
      })
    }
  }

  /**
   * Build shots array for MULTI_SHOT_MANUAL
   */
  private async buildShotsArray(request: GenerateMovieRequest): Promise<Shot[]> {
    if (!request.inputImages || request.inputImages.length === 0) {
      throw createMovieError('shots_images_required')
    }

    const shots: Shot[] = []

    for (let i = 0; i < request.inputImages.length; i++) {
      const imagePath = request.inputImages[i]
      const prompt = request.prompts ? request.prompts[i] : request.prompt

      // Upload image to S3
      const s3Uri = await this.uploadImageToS3(imagePath, request.s3Uri)

      // Create shot with image
      const shot: Shot = {
        text: prompt,
        image: {
          format: this.detectImageFormat(imagePath),
          source: {
            s3Location: {
              uri: s3Uri
            }
          }
        }
      }

      shots.push(shot)
    }

    return shots
  }

  private async buildNovaReelRequest(request: GenerateMovieRequest): Promise<NovaReelRequest> {
    const hasInputImages = Boolean(request.inputImages && request.inputImages.length > 0)
    const modelId = getNovaReelModelId(this.region)

    // Nova Reel v1.0 only supports TEXT_VIDEO format - it doesn't support MULTI_SHOT_AUTOMATED
    if (isNovaReelV1_0(modelId)) {
      const textToVideoParams: any = {
        text: request.prompt
      }

      // Add image for TEXT_VIDEO with single image
      if (hasInputImages && request.inputImages!.length === 1) {
        const imagePath = request.inputImages![0]
        const base64Data = await this.readImageAsBase64(imagePath)

        textToVideoParams.images = [
          {
            format: this.detectImageFormat(imagePath),
            source: {
              bytes: base64Data
            }
          }
        ]
      }

      return {
        taskType: 'TEXT_VIDEO',
        textToVideoParams,
        videoGenerationConfig: {
          durationSeconds: request.durationSeconds,
          fps: NOVA_REEL_FPS,
          dimension: NOVA_REEL_RESOLUTION,
          seed: request.seed || Math.floor(Math.random() * 2147483647)
        }
      }
    }

    // Nova Reel v1.1 supports the full API with different task types
    const taskType = getTaskTypeForRequest(request.durationSeconds, hasInputImages)

    if (taskType === 'TEXT_VIDEO') {
      const textToVideoParams: any = {
        text: request.prompt
      }

      // Add image for TEXT_VIDEO with single image
      if (hasInputImages && request.inputImages!.length === 1) {
        const imagePath = request.inputImages![0]
        const base64Data = await this.readImageAsBase64(imagePath)

        textToVideoParams.images = [
          {
            format: this.detectImageFormat(imagePath),
            source: {
              bytes: base64Data
            }
          }
        ]
      }

      return {
        taskType,
        textToVideoParams,
        videoGenerationConfig: {
          durationSeconds: request.durationSeconds,
          fps: NOVA_REEL_FPS,
          dimension: NOVA_REEL_RESOLUTION,
          seed: request.seed || Math.floor(Math.random() * 2147483647)
        }
      }
    } else if (taskType === 'MULTI_SHOT_MANUAL') {
      // Build shots array with uploaded images
      const shots = await this.buildShotsArray(request)

      // For MULTI_SHOT_MANUAL, don't include durationSeconds in videoGenerationConfig
      // Duration is determined by the number of shots
      return {
        taskType,
        multiShotManualParams: {
          shots
        },
        videoGenerationConfig: {
          fps: NOVA_REEL_FPS,
          dimension: NOVA_REEL_RESOLUTION,
          seed: request.seed || Math.floor(Math.random() * 2147483647)
        }
      }
    } else {
      // MULTI_SHOT_AUTOMATED
      return {
        taskType,
        multiShotAutomatedParams: {
          text: request.prompt
        },
        videoGenerationConfig: {
          durationSeconds: request.durationSeconds,
          fps: NOVA_REEL_FPS,
          dimension: NOVA_REEL_RESOLUTION,
          seed: request.seed || Math.floor(Math.random() * 2147483647)
        }
      }
    }
  }

  async startVideoGeneration(request: GenerateMovieRequest): Promise<GeneratedMovie> {
    this.validateRequest(request)

    const novaReelRequest = await this.buildNovaReelRequest(request)

    // Get the dynamic model ID for the current region
    const modelId = getNovaReelModelId(this.region)

    try {
      // Add detailed logging for debugging
      log.debug('Prepared Nova Reel request', summarizeNovaReelRequest(novaReelRequest))
      log.debug('Using Nova Reel model for region', {
        modelId,
        region: this.region
      })

      const command = new StartAsyncInvokeCommand({
        modelId,
        modelInput: novaReelRequest as any, // AWS SDK expects DocumentType
        outputDataConfig: {
          s3OutputDataConfig: {
            s3Uri: request.s3Uri
          }
        }
      })

      log.debug('Prepared AWS command payload', {
        modelId,
        hasOutputUri: !!request.s3Uri,
        requestSummary: summarizeNovaReelRequest(novaReelRequest)
      })

      const response = await this.runtimeClient.send(command)

      if (!response.invocationArn) {
        throw createMovieError('start_video_no_invocation')
      }

      return {
        invocationArn: response.invocationArn,
        status: {
          invocationArn: response.invocationArn,
          modelId,
          status: 'InProgress',
          submitTime: new Date(),
          outputDataConfig: {
            s3OutputDataConfig: {
              s3Uri: request.s3Uri
            }
          }
        }
      }
    } catch (error: any) {
      log.error('Failed to start video generation', {
        errorMessage: sanitizeErrorMessage(error),
        errorName: error instanceof Error ? error.name : undefined
      })

      // If MULTI_SHOT_MANUAL fails with validation error, try fallback to MULTI_SHOT_AUTOMATED
      if (
        error.name === 'ValidationException' &&
        novaReelRequest.taskType === 'MULTI_SHOT_MANUAL' &&
        error.message?.includes('textToVideoParams')
      ) {
        log.debug('MULTI_SHOT_MANUAL failed, attempting fallback to MULTI_SHOT_AUTOMATED...')

        try {
          // Create fallback request with combined prompts
          const combinedPrompt = request.prompts ? request.prompts.join('. ') : request.prompt

          const fallbackRequest: NovaReelRequest = {
            taskType: 'MULTI_SHOT_AUTOMATED',
            multiShotAutomatedParams: {
              text: combinedPrompt
            },
            videoGenerationConfig: {
              ...novaReelRequest.videoGenerationConfig,
              durationSeconds: request.durationSeconds // Add back durationSeconds for MULTI_SHOT_AUTOMATED
            }
          }

          log.debug('Prepared fallback Nova Reel request', summarizeNovaReelRequest(fallbackRequest))

          const fallbackCommand = new StartAsyncInvokeCommand({
            modelId,
            modelInput: fallbackRequest as any,
            outputDataConfig: {
              s3OutputDataConfig: {
                s3Uri: request.s3Uri
              }
            }
          })

          const response = await this.runtimeClient.send(fallbackCommand)

          if (!response.invocationArn) {
            throw createMovieError('start_video_no_invocation')
          }

          log.debug('Fallback succeeded! Note: Images were not used due to API limitations.')

          return {
            invocationArn: response.invocationArn,
            status: {
              invocationArn: response.invocationArn,
              modelId,
              status: 'InProgress',
              submitTime: new Date(),
              outputDataConfig: {
                s3OutputDataConfig: {
                  s3Uri: request.s3Uri
                }
              }
            }
          }
        } catch (fallbackError) {
          log.error('Fallback also failed', {
            originalError: sanitizeErrorMessage(error),
            fallbackError: sanitizeErrorMessage(fallbackError)
          })
          throw createMovieError('fallback_failed', {
            originalError: sanitizeErrorMessage(error),
            fallbackError: sanitizeErrorMessage(fallbackError)
          })
        }
      }

      if (error.name === 'UnrecognizedClientException') {
        throw new Error('AWS authentication failed. Please check your credentials and permissions.')
      }
      if (error.name === 'ValidationException') {
        throw createMovieError('invalid_request_parameters', {
          errorMessage: sanitizeErrorMessage(error)
        })
      }
      if (error.name === 'AccessDeniedException') {
        throw new Error('Access denied. Please ensure you have permissions for Bedrock and S3.')
      }
      if (error.name === 'ThrottlingException') {
        throw new Error('Request was throttled. Please try again later.')
      }

      if (hasErrorCause(error)) {
        throw error
      }

      throw createMovieError('start_video_failed', {
        errorMessage: sanitizeErrorMessage(error),
        errorName: error instanceof Error ? error.name : undefined
      })
    }
  }

  async getJobStatus(invocationArn: string): Promise<AsyncInvocationStatus> {
    try {
      const command = new GetAsyncInvokeCommand({
        invocationArn
      })

      const response = await this.runtimeClient.send(command)

      // Get the dynamic model ID for the current region
      const modelId = getNovaReelModelId(this.region)

      return {
        invocationArn: response.invocationArn || invocationArn,
        modelId, // Use dynamic model ID based on region
        status: response.status as 'InProgress' | 'Completed' | 'Failed',
        submitTime: response.submitTime || new Date(),
        endTime: response.endTime,
        outputDataConfig: response.outputDataConfig as any, // Type assertion for AWS SDK compatibility
        failureMessage: response.failureMessage
      }
    } catch (error: any) {
      log.error('Error getting job status:', { error })
      throw error
    }
  }

  async downloadVideoFromS3(s3Uri: string, localPath: string): Promise<string> {
    try {
      // Parse S3 URI (s3://bucket/key)
      const s3Match = s3Uri.match(/^s3:\/\/([^/]+)\/(.+)$/)
      if (!s3Match) {
        throw createMovieError('s3_uri_invalid', {
          s3UriToken: toS3UriToken(s3Uri)
        })
      }

      const [, bucket, key] = s3Match

      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key
      })

      const response = await this.s3Client.send(command)

      if (!response.Body) {
        throw new Error('No data received from S3')
      }

      // Ensure output directory exists
      const outputDir = path.dirname(localPath)
      await fs.mkdir(outputDir, { recursive: true })

      // Stream the file to local storage
      const writeStream = createWriteStream(localPath)
      await pipeline(response.Body as NodeJS.ReadableStream, writeStream)

      return localPath
    } catch (error: any) {
      log.error('Error downloading video from S3:', { error })
      throw error
    }
  }

  async waitForCompletion(
    invocationArn: string,
    options: {
      maxWaitTime?: number // Maximum wait time in milliseconds (default: 30 minutes)
      pollInterval?: number // Polling interval in milliseconds (default: 30 seconds)
      onProgress?: (status: AsyncInvocationStatus) => void
    } = {}
  ): Promise<AsyncInvocationStatus> {
    const {
      maxWaitTime = 30 * 60 * 1000, // 30 minutes
      pollInterval = 30 * 1000, // 30 seconds
      onProgress
    } = options

    const startTime = Date.now()

    while (Date.now() - startTime < maxWaitTime) {
      const status = await this.getJobStatus(invocationArn)

      if (onProgress) {
        onProgress(status)
      }

      if (status.status === 'Completed') {
        return status
      }

      if (status.status === 'Failed') {
        throw createMovieError('video_generation_failed', {
          status: status.status,
          failureMessage: status.failureMessage
        })
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollInterval))
    }

    throw createMovieError('video_generation_timeout', {
      maxWaitTimeMs: maxWaitTime
    })
  }

  async generateVideo(request: GenerateMovieRequest): Promise<GeneratedMovie> {
    // Start the generation job
    const initialResult = await this.startVideoGeneration(request)

    // Wait for completion
    const finalStatus = await this.waitForCompletion(initialResult.invocationArn, {
      onProgress: (status) => {
        log.debug('Video generation status update', {
          status: status.status
        })
      }
    })

    // Download the video if completed successfully
    let localPath: string | undefined
    if (
      finalStatus.status === 'Completed' &&
      finalStatus.outputDataConfig?.s3OutputDataConfig?.s3Uri
    ) {
      if (request.outputPath) {
        // Ensure the file has a .mp4 extension
        const outputPath = request.outputPath.endsWith('.mp4')
          ? request.outputPath
          : `${request.outputPath}.mp4`

        localPath = await this.downloadVideoFromS3(
          finalStatus.outputDataConfig.s3OutputDataConfig.s3Uri,
          outputPath
        )
      }
    }

    return {
      invocationArn: initialResult.invocationArn,
      status: finalStatus,
      outputLocation: finalStatus.outputDataConfig?.s3OutputDataConfig?.s3Uri,
      localPath,
      error: finalStatus.status === 'Failed' ? finalStatus.failureMessage : undefined
    }
  }
}
