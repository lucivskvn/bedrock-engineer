import {
  TranslateClient,
  TranslateTextCommand,
  TranslateTextRequest
} from '@aws-sdk/client-translate'
import { createCategoryLogger } from '../../../../common/logger'
import type { AwsClientConfig } from '../types' // Changed AWSCredentials to AwsClientConfig
import { createTranslateClient } from '../client'

export interface TranslateTextOptions {
  sourceLanguage?: string
  targetLanguage: string
  text: string
  /**
   * Cache key for avoiding duplicate translations
   */
  cacheKey?: string
}

export interface TranslationResult {
  translatedText: string
  sourceLanguage: string
  targetLanguage: string
  originalText: string
  appliedTerminologies?: string[]
  appliedSettings?: {
    profanity?: string
    formality?: string
  }
}

export interface TranslationError {
  code: string
  message: string
  originalText: string
  requestId?: string
}

export class TranslateService {
  private client: TranslateClient
  private translationCache = new Map<string, TranslationResult>()
  private maxCacheSize = 1000
  private readonly logger = createCategoryLogger('TranslateService')

  constructor(awsConfig: AwsClientConfig) { // Changed parameter name and type
    this.client = createTranslateClient(awsConfig)
    this.logger.info('TranslateService initialized')
  }

  /**
   * Translate text from source language to target language
   */
  async translateText(options: TranslateTextOptions): Promise<TranslationResult> {
    const { sourceLanguage = 'auto', targetLanguage, text, cacheKey } = options

    // Check cache first
    const key = cacheKey || this.getCacheKey(text, sourceLanguage, targetLanguage)
    if (this.translationCache.has(key)) {
      this.logger.debug('Translation cache hit', { cacheKey: key })
      return this.translationCache.get(key)!
    }

    // Validate input
    if (!text.trim()) {
      throw new Error('Text cannot be empty')
    }

    if (text.length > 10000) {
      throw new Error('Text too long (max 10,000 characters)')
    }

    try {
      const request: TranslateTextRequest = {
        Text: text,
        SourceLanguageCode: sourceLanguage,
        TargetLanguageCode: targetLanguage,
        Settings: {
          Profanity: 'MASK', // Mask profane content
          Formality: 'FORMAL' // Use formal tone
        }
      }

      this.logger.debug('Translating text', {
        sourceLanguage,
        targetLanguage,
        textLength: text.length,
        textPreview: text.substring(0, 100)
      })

      const command = new TranslateTextCommand(request)
      const response = await this.client.send(command)

      if (!response.TranslatedText) {
        throw new Error('No translation received from AWS Translate')
      }

      const result: TranslationResult = {
        translatedText: response.TranslatedText,
        sourceLanguage: response.SourceLanguageCode || sourceLanguage,
        targetLanguage: response.TargetLanguageCode || targetLanguage,
        originalText: text,
        appliedTerminologies: response.AppliedTerminologies?.map((t) => t.Name).filter(
          Boolean
        ) as string[],
        appliedSettings: response.AppliedSettings
          ? {
              profanity: response.AppliedSettings.Profanity,
              formality: response.AppliedSettings.Formality
            }
          : undefined
      }

      // Cache the result
      this.cacheTranslation(key, result)

      this.logger.info('Translation completed', {
        sourceLanguage: result.sourceLanguage,
        targetLanguage: result.targetLanguage,
        originalLength: text.length,
        translatedLength: result.translatedText.length
      })

      return result
    } catch (error) {
      const translationError: TranslationError = {
        code: error instanceof Error ? error.name : 'UnknownError',
        message: error instanceof Error ? error.message : 'Unknown translation error',
        originalText: text,
        requestId: (error as any)?.$metadata?.requestId
      }

      this.logger.error('Translation failed', {
        error: translationError,
        sourceLanguage,
        targetLanguage,
        textLength: text.length
      })

      throw translationError
    }
  }

  /**
   * Translate multiple texts in batch (for future optimization)
   */
  async translateBatch(
    texts: Array<Omit<TranslateTextOptions, 'cacheKey'>>
  ): Promise<TranslationResult[]> {
    this.logger.debug('Batch translation started', { count: texts.length })

    const results = await Promise.allSettled(
      texts.map((options) =>
        this.translateText({
          ...options,
          cacheKey: this.getCacheKey(
            options.text,
            options.sourceLanguage || 'auto',
            options.targetLanguage
          )
        })
      )
    )

    const successful: TranslationResult[] = []
    const failed: Array<{ index: number; error: any }> = []

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        successful.push(result.value)
      } else {
        failed.push({ index, error: result.reason })
      }
    })

    if (failed.length > 0) {
      this.logger.warn('Some batch translations failed', {
        successful: successful.length,
        failed: failed.length,
        failedItems: failed
      })
    }

    return successful
  }

  /**
   * Get cached translation if available
   */
  getCachedTranslation(
    text: string,
    sourceLanguage: string,
    targetLanguage: string
  ): TranslationResult | null {
    const key = this.getCacheKey(text, sourceLanguage, targetLanguage)
    return this.translationCache.get(key) || null
  }

  /**
   * Clear translation cache
   */
  clearCache(): void {
    this.translationCache.clear()
    this.logger.info('Translation cache cleared')
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; maxSize: number; hitRate?: number } {
    return {
      size: this.translationCache.size,
      maxSize: this.maxCacheSize
    }
  }

  private getCacheKey(text: string, sourceLanguage: string, targetLanguage: string): string {
    // Use first 100 chars + hash of full text to create cache key
    const textPreview = text.substring(0, 100)
    const textHash = this.simpleHash(text)
    return `${sourceLanguage}-${targetLanguage}-${textPreview}-${textHash}`
  }

  private cacheTranslation(key: string, result: TranslationResult): void {
    // Implement LRU cache behavior
    if (this.translationCache.size >= this.maxCacheSize) {
      // Remove oldest entry (first key)
      const firstKey = this.translationCache.keys().next().value
      if (firstKey) {
        this.translationCache.delete(firstKey)
      }
    }

    this.translationCache.set(key, result)
  }

  private simpleHash(str: string): string {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = (hash << 5) - hash + char
      hash = hash & hash // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36)
  }

  /**
   * Check if the translation service is healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Try a simple translation to test connectivity
      await this.translateText({
        text: 'Hello',
        sourceLanguage: 'en',
        targetLanguage: 'ja'
      })
      return true
    } catch (error) {
      this.logger.error('Translation service health check failed', { error })
      return false
    }
  }
}

export default TranslateService
