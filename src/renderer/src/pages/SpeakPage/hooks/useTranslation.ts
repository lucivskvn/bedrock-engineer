import { rendererLogger as log } from '@renderer/lib/logger';
import React, { useState, useCallback, useRef, useMemo } from 'react'

export interface TranslationState {
  translatedText: string
  sourceLanguage: string
  targetLanguage: string
  isTranslating: boolean
  error: string | null
  appliedSettings?: {
    profanity?: string
    formality?: string
  }
}

export interface TranslationOptions {
  sourceLanguage?: string
  targetLanguage: string
  debounceMs?: number
  cacheEnabled?: boolean
}

export interface UseTranslationResult {
  translationStates: Map<string, TranslationState>
  translateText: (text: string, options?: Partial<TranslationOptions>) => Promise<void>
  getTranslation: (text: string) => TranslationState | undefined
  clearTranslations: () => void
  clearTranslation: (text: string) => void
  isAnyTranslating: boolean
  cacheStats: { size: number; maxSize: number } | null
  refreshCacheStats: () => Promise<void>
  clearCache: () => Promise<void>
  retryTranslation: (text: string, options?: Partial<TranslationOptions>) => Promise<void>
}

const DEFAULT_OPTIONS: TranslationOptions = {
  sourceLanguage: 'auto',
  targetLanguage: 'ja',
  debounceMs: 500,
  cacheEnabled: true
}

/**
 * リアルタイム翻訳機能を提供するカスタムフック
 */
export function useTranslation(
  defaultOptions: Partial<TranslationOptions> = {}
): UseTranslationResult {
  const [translationStates, setTranslationStates] = useState<Map<string, TranslationState>>(
    new Map()
  )
  const [cacheStats, setCacheStats] = useState<{ size: number; maxSize: number } | null>(null)

  const options = useMemo(() => ({ ...DEFAULT_OPTIONS, ...defaultOptions }), [defaultOptions])
  const debounceTimeouts = useRef<Map<string, NodeJS.Timeout>>(new Map())
  const abortControllers = useRef<Map<string, AbortController>>(new Map())

  // キャッシュ統計の更新
  const refreshCacheStats = useCallback(async () => {
    try {
      const stats = await window.api.bedrock.getTranslationCacheStats()
      setCacheStats(stats)
    } catch (error) {
      log.error('Failed to refresh cache stats:', error)
    }
  }, [])

  // キャッシュクリア
  const clearCache = useCallback(async () => {
    try {
      await window.api.bedrock.clearTranslationCache()
      await refreshCacheStats()
      log.info('Translation cache cleared')
    } catch (error) {
      log.error('Failed to clear translation cache:', error)
    }
  }, [refreshCacheStats])

  // 翻訳状態を更新するヘルパー関数
  const updateTranslationState = useCallback(
    (text: string, update: Partial<TranslationState>) => {
      setTranslationStates((prev) => {
        const newMap = new Map(prev)
        const current = newMap.get(text) || {
          translatedText: '',
          sourceLanguage: '',
          targetLanguage: options.targetLanguage,
          isTranslating: false,
          error: null
        }
        newMap.set(text, { ...current, ...update })
        return newMap
      })
    },
    [options.targetLanguage]
  )

  // テキストの翻訳を実行
  const performTranslation = useCallback(
    async (text: string, translationOptions: TranslationOptions) => {
      const { sourceLanguage, targetLanguage, cacheEnabled } = translationOptions

      // 既存のリクエストをキャンセル
      const existingController = abortControllers.current.get(text)
      if (existingController) {
        existingController.abort()
      }

      // 新しいAbortControllerを作成
      const controller = new AbortController()
      abortControllers.current.set(text, controller)

      try {
        // 翻訳開始状態に設定
        updateTranslationState(text, {
          isTranslating: true,
          error: null,
          targetLanguage
        })

        // キャッシュをチェック（有効な場合）
        if (cacheEnabled) {
          try {
            const cached = await window.api.bedrock.getCachedTranslation({
              text,
              sourceLanguage: sourceLanguage || 'auto',
              targetLanguage
            })

            if (cached && !controller.signal.aborted) {
              updateTranslationState(text, {
                translatedText: cached.translatedText,
                sourceLanguage: cached.sourceLanguage,
                targetLanguage: cached.targetLanguage,
                isTranslating: false,
                error: null,
                appliedSettings: cached.appliedSettings
              })

              log.debug('Translation cache hit', { text: text.substring(0, 50) })
              return
            }
          } catch (cacheError) {
            log.warn('Cache lookup failed, proceeding with API call', cacheError)
          }
        }

        // リクエストがキャンセルされていないかチェック
        if (controller.signal.aborted) {
          return
        }

        // API呼び出し
        const result = await window.api.bedrock.translateText({
          text,
          sourceLanguage,
          targetLanguage,
          cacheKey: cacheEnabled ? undefined : `no-cache-${Date.now()}`
        })

        // リクエストがキャンセルされていないかチェック
        if (controller.signal.aborted) {
          return
        }

        // 成功状態に更新
        updateTranslationState(text, {
          translatedText: result.translatedText,
          sourceLanguage: result.sourceLanguage,
          targetLanguage: result.targetLanguage,
          isTranslating: false,
          error: null,
          appliedSettings: result.appliedSettings
        })

        log.info('Translation completed', {
          textPreview: text.substring(0, 50),
          sourceLanguage: result.sourceLanguage,
          targetLanguage: result.targetLanguage
        })

        // キャッシュ統計を更新
        await refreshCacheStats()
      } catch (error) {
        // リクエストがキャンセルされた場合は何もしない
        if (controller.signal.aborted) {
          return
        }

        const errorMessage = error instanceof Error ? error.message : 'Translation failed'

        updateTranslationState(text, {
          isTranslating: false,
          error: errorMessage
        })

        log.error('Translation failed', {
          textPreview: text.substring(0, 50),
          error: errorMessage
        })
      } finally {
        // AbortControllerをクリーンアップ
        abortControllers.current.delete(text)
      }
    },
    [updateTranslationState, refreshCacheStats]
  )

  // デバウンス付きの翻訳関数
  const translateText = useCallback(
    async (text: string, partialOptions: Partial<TranslationOptions> = {}) => {
      const translationOptions = { ...options, ...partialOptions }

      // 空のテキストはスキップ
      if (!text.trim()) {
        return
      }

      // 既存のデバウンスタイマーをクリア
      const existingTimeout = debounceTimeouts.current.get(text)
      if (existingTimeout) {
        clearTimeout(existingTimeout)
      }

      // デバウンス処理
      const timeout = setTimeout(() => {
        performTranslation(text, translationOptions)
        debounceTimeouts.current.delete(text)
      }, translationOptions.debounceMs)

      debounceTimeouts.current.set(text, timeout)
    },
    [options, performTranslation]
  )

  // リトライ機能
  const retryTranslation = useCallback(
    async (text: string, partialOptions: Partial<TranslationOptions> = {}) => {
      const translationOptions = { ...options, ...partialOptions, debounceMs: 0 } // リトライ時はデバウンスなし
      await performTranslation(text, translationOptions)
    },
    [options, performTranslation]
  )

  // 特定テキストの翻訳状態を取得
  const getTranslation = useCallback(
    (text: string): TranslationState | undefined => {
      return translationStates.get(text)
    },
    [translationStates]
  )

  // すべての翻訳をクリア
  const clearTranslations = useCallback(() => {
    // 進行中のリクエストをキャンセル
    abortControllers.current.forEach((controller) => controller.abort())
    abortControllers.current.clear()

    // デバウンスタイマーをクリア
    debounceTimeouts.current.forEach((timeout) => clearTimeout(timeout))
    debounceTimeouts.current.clear()

    setTranslationStates(new Map())
    log.info('All translations cleared')
  }, [])

  // 特定の翻訳をクリア
  const clearTranslation = useCallback((text: string) => {
    // 進行中のリクエストをキャンセル
    const controller = abortControllers.current.get(text)
    if (controller) {
      controller.abort()
      abortControllers.current.delete(text)
    }

    // デバウンスタイマーをクリア
    const timeout = debounceTimeouts.current.get(text)
    if (timeout) {
      clearTimeout(timeout)
      debounceTimeouts.current.delete(text)
    }

    setTranslationStates((prev) => {
      const newMap = new Map(prev)
      newMap.delete(text)
      return newMap
    })
  }, [])

  // 翻訳中のアイテムがあるかどうか
  const isAnyTranslating = useMemo(() => {
    return Array.from(translationStates.values()).some((state) => state.isTranslating)
  }, [translationStates])

  // クリーンアップ（コンポーネントアンマウント時）
  const cleanup = useCallback(() => {
    abortControllers.current.forEach((controller) => controller.abort())
    abortControllers.current.clear()
    debounceTimeouts.current.forEach((timeout) => clearTimeout(timeout))
    debounceTimeouts.current.clear()
  }, [])

  // 初期化時にキャッシュ統計を取得
  React.useEffect(() => {
    refreshCacheStats()

    return cleanup
  }, [refreshCacheStats, cleanup])

  return {
    translationStates,
    translateText,
    getTranslation,
    clearTranslations,
    clearTranslation,
    isAnyTranslating,
    cacheStats,
    refreshCacheStats,
    clearCache,
    retryTranslation
  }
}

export default useTranslation
