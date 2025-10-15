import { rendererLogger as log } from '@renderer/lib/logger';
import React, { useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus, prism } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { FiCopy, FiCheck } from 'react-icons/fi'
import toast from 'react-hot-toast'

// Constants
const COPY_FEEDBACK_TIMEOUT = 2000
const MAX_CODE_HEIGHT = '40vh'
const LANGUAGE = 'python'

// Style constants
const createLineNumberStyle = (isDark: boolean) => ({
  minWidth: '3em',
  paddingRight: '1em',
  paddingLeft: '0.5em',
  color: isDark ? '#9ca3af' : '#6b7280',
  fontSize: '0.875rem'
})

const createCustomSyntaxStyle = (isDark: boolean) => ({
  margin: 0,
  padding: '1rem',
  background: isDark ? '#1f2937' : '#f9fafb',
  fontSize: '0.875rem',
  lineHeight: '1.5',
  borderRadius: '0'
})

const CODE_TAG_STYLE = {
  fontSize: '0.875rem',
  fontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Monaco, Inconsolata, "Roboto Mono", monospace'
} as const

// CSS class constants
const CSS_CLASSES = {
  container:
    'relative bg-white dark:bg-gray-900 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700',
  header:
    'flex items-center justify-between px-4 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700',
  languageLabel: 'text-xs text-gray-600 dark:text-gray-400 font-medium',
  copyButton:
    'flex items-center gap-1 px-2 py-1 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors',
  icon: 'size-3',
  codeContent: `relative max-h-[${MAX_CODE_HEIGHT}] overflow-auto`
} as const

interface ExecutedCodeBlockProps {
  /** The Python code to display */
  code: string
}

/**
 * ExecutedCodeBlock component displays executed Python code with syntax highlighting
 * and copy functionality
 */
export const ExecutedCodeBlock: React.FC<ExecutedCodeBlockProps> = ({ code }) => {
  const { t } = useTranslation('tools')
  const [copied, setCopied] = useState<boolean>(false)

  /**
   * Detects if the user prefers dark mode
   * Uses document class and system preference as fallback
   */
  const isDarkMode = useMemo(
    () =>
      document.documentElement.classList.contains('dark') ||
      window.matchMedia('(prefers-color-scheme: dark)').matches,
    []
  )

  /**
   * Handles copying code to clipboard with user feedback
   */
  const handleCopy = useCallback(async (): Promise<void> => {
    if (!navigator.clipboard) {
      toast.error(t('code interpreter display.Clipboard not available', 'Clipboard not available'))
      return
    }

    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      toast.success(
        t('code interpreter display.Code copied to clipboard', 'Code copied to clipboard')
      )

      // Reset copied state after timeout
      setTimeout(() => setCopied(false), COPY_FEEDBACK_TIMEOUT)
    } catch (error) {
      log.error('Failed to copy code', { error })
      toast.error(t('code interpreter display.Failed to copy code', 'Failed to copy code'))
    }
  }, [code, t])

  /**
   * Renders the copy button with appropriate icon and text
   */
  const renderCopyButton = (): React.ReactElement => (
    <button
      onClick={handleCopy}
      className={CSS_CLASSES.copyButton}
      title={t('code interpreter display.Copy code', 'Copy code')}
      aria-label={t('code interpreter display.Copy code', 'Copy code')}
    >
      {copied ? (
        <>
          <FiCheck className={CSS_CLASSES.icon} />
          <span>{t('code interpreter display.Copied', 'Copied')}</span>
        </>
      ) : (
        <>
          <FiCopy className={CSS_CLASSES.icon} />
          <span>{t('code interpreter display.Copy', 'Copy')}</span>
        </>
      )}
    </button>
  )

  /**
   * Renders the header section with language label and copy button
   */
  const renderHeader = (): React.ReactElement => (
    <div className={CSS_CLASSES.header}>
      <div className="flex items-center gap-2">
        <span className={CSS_CLASSES.languageLabel}>{LANGUAGE}</span>
      </div>
      {renderCopyButton()}
    </div>
  )

  /**
   * Renders the syntax highlighted code content
   */
  const renderCodeContent = (): React.ReactElement => (
    <div className={CSS_CLASSES.codeContent}>
      <SyntaxHighlighter
        language={LANGUAGE}
        style={isDarkMode ? vscDarkPlus : prism}
        showLineNumbers
        lineNumberStyle={createLineNumberStyle(isDarkMode)}
        customStyle={createCustomSyntaxStyle(isDarkMode)}
        codeTagProps={{ style: CODE_TAG_STYLE }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  )

  return (
    <div className={CSS_CLASSES.container}>
      {renderHeader()}
      {renderCodeContent()}
    </div>
  )
}
