import { rendererLogger as log } from '@renderer/lib/logger';
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FiCopy, FiCheck, FiAlertTriangle } from 'react-icons/fi'
import toast from 'react-hot-toast'

interface ErrorDisplayProps {
  error?: string
  stderr?: string
  exitCode?: number
}

export const ErrorDisplay: React.FC<ErrorDisplayProps> = ({ error, stderr, exitCode }) => {
  const { t } = useTranslation('tools')
  const [copied, setCopied] = useState(false)

  // 表示するエラー内容を決定
  const errorContent = error || stderr

  const handleCopy = async () => {
    if (!errorContent) return

    try {
      await navigator.clipboard.writeText(errorContent)
      setCopied(true)
      toast.success(
        t('code interpreter display.Error copied to clipboard', 'Error copied to clipboard')
      )
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      log.error('Failed to copy error', { error: err })
      toast.error(t('code interpreter display.Failed to copy error', 'Failed to copy error'))
    }
  }

  // Pythonエラーのスタックトレースを解析してハイライト
  const formatPythonError = (errorText: string) => {
    const lines = errorText.split('\n')

    return lines.map((line, index) => {
      // Traceback行の判定
      if (line.trim().startsWith('Traceback')) {
        return (
          <div key={index} className="text-red-400 font-semibold">
            {line}
          </div>
        )
      }

      // ファイル行の判定
      if (line.trim().startsWith('File ')) {
        return (
          <div key={index} className="text-blue-400">
            {line}
          </div>
        )
      }

      // エラータイプ行の判定（例: ValueError:, TypeError: など）
      if (line.match(/^\w+Error:/)) {
        return (
          <div key={index} className="text-red-300 font-medium">
            {line}
          </div>
        )
      }

      // その他の行
      return (
        <div key={index} className="text-gray-300">
          {line}
        </div>
      )
    })
  }

  if (!errorContent && (!exitCode || exitCode === 0)) {
    return null
  }

  return (
    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-red-100 dark:bg-red-900/30 border-b border-red-200 dark:border-red-800">
        <div className="flex items-center gap-2">
          <FiAlertTriangle className="text-red-600 dark:text-red-400" />
          <span className="text-sm font-medium text-red-800 dark:text-red-200">
            {t('code interpreter display.Execution Error', 'Execution Error')}
          </span>
          {exitCode !== undefined && exitCode !== 0 && (
            <span className="text-xs bg-red-200 dark:bg-red-800 text-red-800 dark:text-red-200 px-2 py-1 rounded">
              {t('code interpreter display.Exit Code', 'Exit Code')}: {exitCode}
            </span>
          )}
        </div>

        {errorContent && (
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-1 text-xs text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-200 hover:bg-red-200 dark:hover:bg-red-800 rounded transition-colors"
            title={t('code interpreter display.Copy error', 'Copy error')}
          >
            {copied ? (
              <>
                <FiCheck className="size-3" />
                <span>{t('code interpreter display.Copied', 'Copied')}</span>
              </>
            ) : (
              <>
                <FiCopy className="size-3" />
                <span>{t('code interpreter display.Copy', 'Copy')}</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Error content */}
      {errorContent && (
        <div className="p-4 max-h-[30vh] overflow-auto">
          <div className="bg-gray-900 text-gray-100 p-4 rounded font-mono text-sm leading-relaxed">
            {formatPythonError(errorContent)}
          </div>
        </div>
      )}

      {/* Error hints */}
      <div className="px-4 py-3 bg-red-50 dark:bg-red-900/10 border-t border-red-200 dark:border-red-800">
        <div className="text-xs text-red-700 dark:text-red-300">
          <span className="font-medium">{t('code interpreter display.Hint', 'Hint')}:</span>
          <span className="ml-1">
            {t(
              'code interpreter display.Check your code for syntax errors, undefined variables, or incorrect function calls.',
              'Check your code for syntax errors, undefined variables, or incorrect function calls.'
            )}
          </span>
        </div>
      </div>
    </div>
  )
}
