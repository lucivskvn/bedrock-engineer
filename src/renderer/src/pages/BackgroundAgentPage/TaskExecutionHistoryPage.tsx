import { rendererLogger as log } from '@renderer/lib/logger';
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import {
  CheckCircleIcon,
  XCircleIcon,
  ArrowPathIcon,
  ChatBubbleBottomCenterTextIcon,
  DocumentTextIcon,
  UserIcon,
  CpuChipIcon,
  WrenchIcon,
  ClipboardDocumentListIcon,
  ClockIcon
} from '@heroicons/react/24/outline'
import { useBackgroundAgent, ScheduledTask, TaskExecutionResult } from './hooks/useBackgroundAgent'
import JSONViewer from '../../components/JSONViewer'
import { BackgroundAgentTextArea } from './components/BackgroundAgentTextArea'

interface HistoryFilter {
  status: 'all' | 'success' | 'failure'
  dateRange: 'all' | 'today' | 'week' | 'month'
}

const TaskExecutionHistoryPage: React.FC = () => {
  const { t } = useTranslation()
  const { taskId } = useParams<{ taskId: string }>()

  const { tasks, getTaskExecutionHistory, getSessionHistory, continueSession } =
    useBackgroundAgent()

  const [task, setTask] = useState<ScheduledTask | null>(null)
  const [history, setHistory] = useState<TaskExecutionResult[]>([])
  const [filteredHistory, setFilteredHistory] = useState<TaskExecutionResult[]>([])
  const [selectedExecution, setSelectedExecution] = useState<TaskExecutionResult | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [sessionHistories, setSessionHistories] = useState<Record<string, any[]>>({})
  const [loadingSessions, setLoadingSessions] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<HistoryFilter>({
    status: 'all',
    dateRange: 'all'
  })
  const [isInitialLoading, setIsInitialLoading] = useState(true)

  // 会話継続用の状態
  const [showChatMode, setShowChatMode] = useState(false)
  const [chatMessage, setChatMessage] = useState('')
  const [isSendingMessage, setIsSendingMessage] = useState(false)
  const [sessionError, setSessionError] = useState<string | null>(null)

  // 自動スクロール用のref
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)

  // タスクを取得
  useEffect(() => {
    if (taskId && tasks.length > 0) {
      const foundTask = tasks.find((t) => t.id === taskId)
      setTask(foundTask || null)
      setIsInitialLoading(false)
    } else if (taskId && tasks.length === 0) {
      // まだタスクが読み込まれていない可能性があるので待機
      setIsInitialLoading(true)
    }
  }, [taskId, tasks])

  // 最下部へのスクロール関数
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  // ユーザーが最下部近くにいるかを判定
  const isNearBottom = useCallback(() => {
    const container = messagesContainerRef.current
    if (!container) return true

    const { scrollTop, scrollHeight, clientHeight } = container
    const threshold = 150 // 150px以内なら「最下部近く」と判定
    return scrollHeight - scrollTop - clientHeight < threshold
  }, [])

  // 履歴データを取得
  const fetchHistory = async () => {
    if (!task) return

    try {
      setIsLoading(true)
      const historyData = await getTaskExecutionHistory(task.id)
      setHistory(historyData)
    } catch (error) {
      log.error('Failed to fetch execution history:', error)
    } finally {
      setIsLoading(false)
    }
  }

  // フィルタリング処理
  const applyFilters = () => {
    let filtered = [...history]

    // ステータスフィルタ
    if (filter.status !== 'all') {
      filtered = filtered.filter((item) =>
        filter.status === 'success' ? item.status === 'success' : item.status === 'failed'
      )
    }

    // 日付フィルタ
    if (filter.dateRange !== 'all') {
      const now = Date.now()
      const cutoffTimes = {
        today: now - 24 * 60 * 60 * 1000,
        week: now - 7 * 24 * 60 * 60 * 1000,
        month: now - 30 * 24 * 60 * 60 * 1000
      }
      const cutoff = cutoffTimes[filter.dateRange]
      filtered = filtered.filter((item) => item.executedAt >= cutoff)
    }

    // 時系列順（最新順）でソート
    filtered.sort((a, b) => b.executedAt - a.executedAt)

    setFilteredHistory(filtered)

    // 現在の選択がフィルタ結果に含まれているかチェック
    if (selectedExecution) {
      const isSelectedInFiltered = filtered.find(
        (ex) => ex.executedAt === selectedExecution.executedAt
      )
      if (!isSelectedInFiltered) {
        // 選択されたアイテムがフィルタ結果にない場合、最初のアイテムを選択するかクリア
        if (filtered.length > 0) {
          setSelectedExecution(filtered[0])
          fetchSessionHistory(filtered[0].sessionId)
        } else {
          setSelectedExecution(null)
        }
      }
    } else if (filtered.length > 0 && !selectedExecution) {
      // 選択がない場合は最初のアイテムを自動選択
      setSelectedExecution(filtered[0])
      fetchSessionHistory(filtered[0].sessionId)
    }
  }

  // 日時をフォーマット
  const formatDateTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString()
  }

  // セッション履歴を取得
  const fetchSessionHistory = async (sessionId: string) => {
    if (sessionHistories[sessionId] || loadingSessions.has(sessionId)) return

    try {
      setLoadingSessions((prev) => new Set([...prev, sessionId]))
      const messages = await getSessionHistory(sessionId)
      setSessionHistories((prev) => ({ ...prev, [sessionId]: messages }))
    } catch (error) {
      log.error('Failed to fetch session history:', error)
    } finally {
      setLoadingSessions((prev) => {
        const newSet = new Set(prev)
        newSet.delete(sessionId)
        return newSet
      })
    }
  }

  // 実行履歴を選択
  const selectExecution = async (execution: TaskExecutionResult) => {
    setSelectedExecution(execution)
    await fetchSessionHistory(execution.sessionId)
  }

  // メッセージタイプを判定
  const getMessageType = (message: any) => {
    if (!Array.isArray(message.content)) return 'text'

    const hasToolUse = message.content.some((item: any) => item.type === 'tool_use')
    const hasToolResult = message.content.some((item: any) => item.type === 'tool_result')

    if (hasToolUse) return 'tool_use'
    if (hasToolResult) return 'tool_result'
    return 'text'
  }

  // メッセージのアイコンを取得（ツールメッセージ含む）
  const getMessageIcon = (message: any) => {
    const messageType = getMessageType(message)

    switch (messageType) {
      case 'tool_use':
        return <WrenchIcon className="h-4 w-4 text-blue-600 dark:text-blue-400" />
      case 'tool_result':
        return <ClipboardDocumentListIcon className="h-4 w-4 text-green-600 dark:text-green-400" />
      default:
        return message.role === 'user' ? (
          <UserIcon className="h-4 w-4 text-blue-600 dark:text-blue-400" />
        ) : (
          <CpuChipIcon className="h-4 w-4 text-green-600 dark:text-green-400" />
        )
    }
  }

  // メッセージの背景色を取得
  const getMessageBackgroundColor = (message: any) => {
    const messageType = getMessageType(message)

    switch (messageType) {
      case 'tool_use':
        return 'bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-400'
      case 'tool_result':
        return 'bg-green-50 dark:bg-green-900/20 border-l-4 border-green-400'
      default:
        return message.role === 'user'
          ? 'bg-blue-50 dark:bg-blue-900/20'
          : 'bg-gray-50 dark:bg-gray-800'
    }
  }

  // JSONを安全に表示するヘルパー関数
  const renderJSONContent = (value: any, maxHeight: string = '300px'): React.ReactNode => {
    // 文字列の場合: JSONパースを試行
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value)
        // textキーのみを持つオブジェクトの場合はテキスト値を表示
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          Object.keys(parsed).length === 1 &&
          'text' in parsed
        ) {
          return (
            <pre
              className="text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded border overflow-auto whitespace-pre-wrap"
              style={{ maxHeight }}
            >
              {parsed.text}
            </pre>
          )
        }
        return <JSONViewer data={parsed} title="" maxHeight={maxHeight} showCopyButton={true} />
      } catch (e) {
        // JSON parse failed, display as plain text
        return (
          <pre
            className="text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded border overflow-auto whitespace-pre-wrap"
            style={{ maxHeight }}
          >
            {value}
          </pre>
        )
      }
    }

    // オブジェクト・配列の場合
    if (typeof value === 'object' && value !== null) {
      // textキーのみを持つオブジェクトの場合はテキスト値を表示
      if (!Array.isArray(value) && Object.keys(value).length === 1 && 'text' in value) {
        return (
          <pre className="overflow-auto whitespace-pre-wrap" style={{ maxHeight }}>
            {value.text}
          </pre>
        )
      }
      // その他のオブジェクト・配列: JSONViewerで表示
      return <JSONViewer data={value} title="" maxHeight={maxHeight} showCopyButton={true} />
    }

    // その他の場合: 文字列として表示
    return (
      <pre className="overflow-auto whitespace-pre-wrap" style={{ maxHeight }}>
        {String(value)}
      </pre>
    )
  }

  // メッセージの内容をフォーマット（シンプル版）
  const formatMessageContent = (message: any): React.ReactNode => {
    const content = message.content

    // contentが配列の場合（従来のAnthropic形式）
    if (Array.isArray(content)) {
      return (
        <div className="space-y-3">
          {content.map((item: any, index: number) => {
            // テキストアイテム
            if (typeof item === 'string') {
              return renderJSONContent(item, '300px')
            }

            if (typeof item === 'object' && item !== null) {
              // テキストタイプ
              if (item.type === 'text' && item.text) {
                return <div key={index}>{renderJSONContent(item.text, '300px')}</div>
              }

              // その他のオブジェクト（tool_use, tool_result等）
              return <div key={index}>{renderJSONContent(item, '300px')}</div>
            }

            return <div key={index}>{renderJSONContent(item, '300px')}</div>
          })}
        </div>
      )
    }

    // contentが単一の値の場合
    return renderJSONContent(content, '400px')
  }

  // メッセージのタイトルを取得
  const getMessageTitle = (message: any) => {
    const messageType = getMessageType(message)

    switch (messageType) {
      case 'tool_use':
        return t('backgroundAgent.history.toolExecution')
      case 'tool_result':
        return t('backgroundAgent.history.toolResult')
      default:
        return message.role === 'user'
          ? t('backgroundAgent.history.user')
          : t('backgroundAgent.history.assistant')
    }
  }

  // 会話継続機能のハンドラー
  const handleContinueSession = async () => {
    if (!selectedExecution || !continueSession || !chatMessage.trim()) return
    const msg = chatMessage
    try {
      setIsSendingMessage(true)
      setSessionError(null) // エラーをクリア
      setChatMessage('')
      await continueSession(selectedExecution.sessionId, task!.id, msg.trim())

      // メッセージ送信後、セッション履歴を再取得
      await fetchSessionHistory(selectedExecution.sessionId)
    } catch (error: any) {
      log.error('Failed to continue session:', error)
      // エラーメッセージを設定
      const errorMessage = error?.message || error || 'Unknown error occurred'
      setSessionError(errorMessage)
      // メッセージを復元
      setChatMessage(msg)
    } finally {
      setIsSendingMessage(false)
    }
  }

  useEffect(() => {
    if (task) {
      fetchHistory()
    }
  }, [task])

  useEffect(() => {
    applyFilters()
  }, [history, filter])

  // リアルタイム更新のための購読設定
  useEffect(() => {
    if (!selectedExecution?.sessionId) return

    const unsubscribe = window.api.pubsub.subscribe(
      `session-update:${selectedExecution.sessionId}`,
      (updateData) => {
        if (
          updateData.type === 'message-added' &&
          updateData.sessionId === selectedExecution.sessionId
        ) {
          // セッション履歴を更新
          setSessionHistories((prev) => ({
            ...prev,
            [selectedExecution.sessionId]: [
              ...(prev[selectedExecution.sessionId] || []),
              updateData.message
            ]
          }))
        }
      }
    )

    return unsubscribe
  }, [selectedExecution?.sessionId])

  // セッション履歴更新時の自動スクロール
  useEffect(() => {
    if (!selectedExecution?.sessionId) return

    const messages = sessionHistories[selectedExecution.sessionId]
    if (!messages || messages.length === 0) return

    // ユーザーが最下部近くにいる場合のみ自動スクロール
    if (isNearBottom()) {
      // 少し遅延させてDOMの更新を待つ
      setTimeout(() => {
        scrollToBottom()
      }, 100)
    }
  }, [sessionHistories, selectedExecution?.sessionId, scrollToBottom, isNearBottom])

  // メッセージ送信後の自動スクロール
  useEffect(() => {
    if (!isSendingMessage && selectedExecution?.sessionId) {
      // 送信完了後は必ずスクロール
      setTimeout(() => {
        scrollToBottom()
      }, 200)
    }
  }, [isSendingMessage, selectedExecution?.sessionId, scrollToBottom])

  // 初回ローディング中の表示
  if (isInitialLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <ArrowPathIcon className="h-12 w-12 mx-auto mb-4 text-blue-600 dark:text-blue-400 animate-spin" />
          <p className="text-gray-600 dark:text-gray-400">読み込み中...</p>
        </div>
      </div>
    )
  }

  // タスクが見つからない場合の表示
  if (!task) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <DocumentTextIcon className="h-12 w-12 mx-auto mb-4 text-gray-400 dark:text-gray-600" />
          <p className="text-gray-500 dark:text-gray-400 mb-4">タスクが見つかりません</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mb-6">
            タスクが削除されたか、まだ読み込み中の可能性があります
          </p>
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center space-x-2 px-4 py-2 text-sm border border-gray-300 rounded bg-white hover:bg-gray-50 text-gray-700 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-600 transition-colors"
          >
            <ArrowPathIcon className="h-4 w-4" />
            <span>ページを再読み込み</span>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900">
        <div className="flex items-center justify-between p-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              {t('backgroundAgent.history.title')}
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{task.name}</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4 p-6 border-b border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800">
        <div className="flex items-center space-x-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('backgroundAgent.history.filterStatus')}:
          </label>
          <select
            value={filter.status}
            onChange={(e) => setFilter((prev) => ({ ...prev, status: e.target.value as any }))}
            className="text-sm border border-gray-300 rounded px-2 py-1 bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-white"
          >
            <option value="all">{t('backgroundAgent.history.all')}</option>
            <option value="success">{t('backgroundAgent.history.successOnly')}</option>
            <option value="failure">{t('backgroundAgent.history.failureOnly')}</option>
          </select>
        </div>

        <div className="flex items-center space-x-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t('backgroundAgent.history.filterDate')}:
          </label>
          <select
            value={filter.dateRange}
            onChange={(e) => setFilter((prev) => ({ ...prev, dateRange: e.target.value as any }))}
            className="text-sm border border-gray-300 rounded px-2 py-1 bg-white dark:bg-gray-800 dark:border-gray-600 dark:text-white"
          >
            <option value="all">{t('backgroundAgent.history.allTime')}</option>
            <option value="today">{t('backgroundAgent.history.today')}</option>
            <option value="week">{t('backgroundAgent.history.thisWeek')}</option>
            <option value="month">{t('backgroundAgent.history.thisMonth')}</option>
          </select>
        </div>

        <button
          onClick={fetchHistory}
          disabled={isLoading}
          className="flex items-center space-x-1 px-3 py-1 text-sm border border-gray-300 rounded bg-white hover:bg-gray-50 text-gray-700 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
        >
          <ArrowPathIcon className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          <span>{t('common.refresh')}</span>
        </button>
      </div>

      {/* Main Content - 2 Column Layout */}
      <div className="flex flex-1 min-h-0" style={{ height: 'calc(100vh - 200px)' }}>
        {/* Left Column - Execution History List */}
        <div className="w-1/4 flex-shrink-0 border-r border-gray-200 dark:border-gray-600 overflow-y-auto">
          <div className="p-4">
            <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
              {t('backgroundAgent.history.executionHistoryList')} ({filteredHistory.length})
            </h2>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <ArrowPathIcon className="h-8 w-8 animate-spin text-blue-600 dark:text-blue-400" />
              </div>
            ) : filteredHistory.length === 0 ? (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                <DocumentTextIcon className="h-12 w-12 mx-auto mb-4 text-gray-400 dark:text-gray-600" />
                <p>{t('backgroundAgent.history.noHistory')}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredHistory.map((execution) => (
                  <div
                    key={`${execution.taskId}-${execution.executedAt}`}
                    onClick={() => selectExecution(execution)}
                    className={`p-2 rounded cursor-pointer transition-colors ${
                      selectedExecution?.executedAt === execution.executedAt
                        ? 'bg-gray-100 dark:bg-gray-800'
                        : 'hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}
                  >
                    <div className="flex items-center space-x-1 mb-1">
                      {execution.status === 'running' ? (
                        <ClockIcon className="h-3 w-3 text-blue-600 dark:text-blue-400 animate-pulse" />
                      ) : execution.status === 'success' ? (
                        <CheckCircleIcon className="h-3 w-3 text-green-600 dark:text-green-400" />
                      ) : (
                        <XCircleIcon className="h-3 w-3 text-red-600 dark:text-red-400" />
                      )}
                      <span className="text-xs font-medium text-gray-900 dark:text-white">
                        {execution.status === 'running'
                          ? t('backgroundAgent.history.running')
                          : execution.status === 'success'
                            ? t('backgroundAgent.history.success')
                            : t('backgroundAgent.history.failure')}
                      </span>
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400">
                      <div className="flex items-center space-x-2">
                        <span>{formatDateTime(execution.executedAt)}</span>
                        <span className="hidden md:inline">•</span>
                        <span className="hidden md:inline">{execution.messageCount}msg</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column - Selected Execution Details */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
          {selectedExecution ? (
            <>
              {/* Execution Details */}
              <div className="p-6 border-b border-gray-200 dark:border-gray-600">
                <div className="flex items-center space-x-2 mb-4">
                  {selectedExecution.status === 'running' ? (
                    <ClockIcon className="h-6 w-6 text-blue-600 dark:text-blue-400 animate-pulse" />
                  ) : selectedExecution.status === 'success' ? (
                    <CheckCircleIcon className="h-6 w-6 text-green-600 dark:text-green-400" />
                  ) : (
                    <XCircleIcon className="h-6 w-6 text-red-600 dark:text-red-400" />
                  )}
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                    {t('backgroundAgent.history.executionDetails')} -{' '}
                    {formatDateTime(selectedExecution.executedAt)}
                  </h3>
                </div>

                <div className="space-y-3 text-sm">
                  <div className="flex items-center space-x-2">
                    <ChatBubbleBottomCenterTextIcon className="h-4 w-4 text-gray-500 flex-shrink-0" />
                    <span className="text-gray-700 dark:text-gray-300">
                      {t('backgroundAgent.history.messageCount')}: {selectedExecution.messageCount}
                    </span>
                  </div>
                  <div className="flex items-start space-x-2">
                    <DocumentTextIcon className="h-4 w-4 text-gray-500 flex-shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="text-gray-700 dark:text-gray-300 text-xs">
                        {t('backgroundAgent.history.sessionId')}:
                      </div>
                      <div className="text-gray-600 dark:text-gray-400 font-mono text-xs break-all">
                        {selectedExecution.sessionId}
                      </div>
                    </div>
                  </div>
                </div>

                {selectedExecution.error && (
                  <div className="mt-4 p-3 bg-red-100 dark:bg-red-900/30 rounded border border-red-200 dark:border-red-800">
                    <div className="flex items-start space-x-2">
                      <XCircleIcon className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                      <div className="text-sm text-red-800 dark:text-red-200">
                        {selectedExecution.error}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Messages */}
              <div className="flex-1 flex flex-col min-h-0">
                <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-600">
                  <h4 className="text-md font-medium text-gray-900 dark:text-white">
                    {t('backgroundAgent.history.sessionHistory')}
                  </h4>
                  <button
                    onClick={() => setShowChatMode(!showChatMode)}
                    className={`text-sm px-3 py-1 rounded border transition-colors ${
                      showChatMode
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-blue-600 border-blue-600 hover:bg-blue-50 dark:bg-gray-700 dark:text-blue-400 dark:border-blue-400 dark:hover:bg-gray-600'
                    }`}
                  >
                    {showChatMode
                      ? t('backgroundAgent.history.showHistoryOnly')
                      : t('backgroundAgent.history.continueConversation')}
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                  {loadingSessions.has(selectedExecution.sessionId) ? (
                    <div className="flex items-center justify-center py-8">
                      <ArrowPathIcon className="h-6 w-6 animate-spin text-blue-600 dark:text-blue-400" />
                    </div>
                  ) : sessionHistories[selectedExecution.sessionId] ? (
                    sessionHistories[selectedExecution.sessionId].length === 0 ? (
                      <div className="text-center text-gray-500 dark:text-gray-400 py-8">
                        <ChatBubbleBottomCenterTextIcon className="h-8 w-8 mx-auto mb-2 text-gray-400 dark:text-gray-600" />
                        <p className="text-sm">{t('backgroundAgent.history.noMessages')}</p>
                      </div>
                    ) : (
                      <div ref={messagesContainerRef} className="space-y-4">
                        {sessionHistories[selectedExecution.sessionId].map((message, index) => (
                          <div
                            key={index}
                            className={`flex items-start space-x-3 p-4 rounded-lg ${getMessageBackgroundColor(message)}`}
                          >
                            <div className="flex-shrink-0 mt-1">{getMessageIcon(message)}</div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-gray-900 dark:text-white mb-2">
                                {getMessageTitle(message)}
                              </div>
                              <div className="text-sm text-gray-800 dark:text-gray-200 break-words">
                                {formatMessageContent(message)}
                              </div>
                            </div>
                          </div>
                        ))}
                        {/* 自動スクロール用の要素 */}
                        <div ref={messagesEndRef} />
                      </div>
                    )
                  ) : (
                    <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                      {t('backgroundAgent.history.loadingMessages')}
                    </div>
                  )}
                </div>

                {/* Chat Input Form */}
                {showChatMode && (
                  <div className="border-t border-gray-200 dark:border-gray-600 p-4 bg-gray-50 dark:bg-gray-800">
                    {/* Session Error Display */}
                    {sessionError && (
                      <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/30 rounded border border-red-200 dark:border-red-800">
                        <div className="flex items-start space-x-2">
                          <XCircleIcon className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-red-800 dark:text-red-200 break-words">
                              {sessionError}
                            </div>
                            <button
                              onClick={() => setSessionError(null)}
                              className="mt-2 text-xs text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-200"
                            >
                              ✕ エラーを閉じる
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                    <BackgroundAgentTextArea
                      value={chatMessage}
                      onChange={setChatMessage}
                      onSubmit={handleContinueSession}
                      disabled={isSendingMessage}
                      placeholder={t('backgroundAgent.history.enterMessage')}
                    />
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-500 dark:text-gray-400">
              <div className="text-center">
                <DocumentTextIcon className="h-12 w-12 mx-auto mb-4 text-gray-400 dark:text-gray-600" />
                <p>{t('backgroundAgent.history.selectExecutionHistory')}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default TaskExecutionHistoryPage
