import { rendererLogger as log } from '@renderer/lib/logger';
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FiCopy, FiCheck } from 'react-icons/fi'
import toast from 'react-hot-toast'

interface OutputDisplayProps {
  stdout: string
  output: string
}

export const OutputDisplay: React.FC<OutputDisplayProps> = ({ stdout, output }) => {
  const { t } = useTranslation('tools')
  const [copied, setCopied] = useState(false)

  // 表示する内容を決定（stdoutがあればそれを優先、なければoutputを使用）
  const displayContent = stdout || output

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(displayContent)
      setCopied(true)
      toast.success(
        t('code interpreter display.Output copied to clipboard', 'Output copied to clipboard')
      )
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      log.error('Failed to copy output:', err)
      toast.error(t('code interpreter display.Failed to copy output', 'Failed to copy output'))
    }
  }

  if (!displayContent) {
    return (
      <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <p className="text-gray-500 dark:text-gray-400 text-sm italic">
          {t('code interpreter display.No output produced', 'No output produced')}
        </p>
      </div>
    )
  }

  return (
    <div className="bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <span className="text-xs text-gray-600 dark:text-gray-400 font-medium">
          {t('code interpreter display.Console Output', 'Console Output')}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
          title={t('code interpreter display.Copy output', 'Copy output')}
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
      </div>

      {/* Content */}
      <div className="p-4 max-h-[30vh] overflow-auto">
        <pre className="whitespace-pre-wrap text-sm font-mono text-gray-800 dark:text-gray-200 leading-relaxed">
          {displayContent}
        </pre>
      </div>
    </div>
  )
}
