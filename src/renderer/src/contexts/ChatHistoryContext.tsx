import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { SessionMetadata, ChatSession, ChatMessage } from '@/types/chat/history'

interface ChatHistoryContextType {
  sessions: SessionMetadata[]
  currentSessionId?: string
  getSession: (sessionId: string) => Promise<ChatSession | null>
  createSession: (agentId: string, modelId: string, systemPrompt?: string) => Promise<string>
  addMessage: (sessionId: string, message: ChatMessage) => Promise<void>
  updateSessionTitle: (sessionId: string, title: string) => Promise<void>
  deleteSession: (sessionId: string) => void
  deleteAllSessions: () => void
  setActiveSession: (sessionId: string) => void
  updateMessageContent: (
    sessionId: string,
    messageIndex: number,
    updatedMessage: ChatMessage
  ) => Promise<void>
  deleteMessage: (sessionId: string, messageIndex: number) => Promise<void>
}

const ChatHistoryContext = createContext<ChatHistoryContextType | undefined>(undefined)

export const ChatHistoryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [sessions, setSessions] = useState<SessionMetadata[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | undefined>()

  // 初期化時にセッションをロード
  useEffect(() => {
    loadSessions()

    // アクティブセッションを取得
    const activeSessionId = window.chatHistory.getActiveSessionId()
    if (activeSessionId) {
      setCurrentSessionId(activeSessionId)
    }
  }, [])

  // セッション一覧を読み込む
  const loadSessions = useCallback(() => {
    const sessionMetadata = window.chatHistory.getAllSessionMetadata()
    setSessions(sessionMetadata)
  }, [])

  // セッション情報を取得
  const getSession = useCallback(async (sessionId: string) => {
    return await window.chatHistory.getSession(sessionId)
  }, [])

  // 新規セッションを作成
  const createSession = useCallback(
    async (agentId: string, modelId: string, systemPrompt?: string): Promise<string> => {
      const newSessionId = await window.chatHistory.createSession(agentId, modelId, systemPrompt)
      loadSessions() // セッション一覧を更新
      return newSessionId
    },
    [loadSessions]
  )

  // メッセージを追加
  const addMessage = useCallback(
    async (sessionId: string, message: ChatMessage): Promise<void> => {
      await window.chatHistory.addMessage(sessionId, message)
      loadSessions() // セッション一覧を更新
    },
    [loadSessions]
  )

  // セッションタイトルを更新
  const updateSessionTitle = useCallback(
    async (sessionId: string, title: string): Promise<void> => {
      await window.chatHistory.updateSessionTitle(sessionId, title)
      loadSessions() // セッション一覧を更新
    },
    [loadSessions]
  )

  // セッションを削除
  const deleteSession = useCallback(
    (sessionId: string): void => {
      window.chatHistory.deleteSession(sessionId)
      loadSessions() // セッション一覧を更新
    },
    [loadSessions]
  )

  // 全セッションを削除
  const deleteAllSessions = useCallback((): void => {
    window.chatHistory.deleteAllSessions()
    loadSessions() // セッション一覧を更新
    setCurrentSessionId(undefined)
  }, [loadSessions])

  // アクティブセッションを設定
  const setActiveSession = useCallback((sessionId: string): void => {
    window.chatHistory.setActiveSession(sessionId)
    setCurrentSessionId(sessionId)
  }, [])

  // メッセージ内容を更新
  const updateMessageContent = useCallback(
    async (sessionId: string, messageIndex: number, updatedMessage: ChatMessage): Promise<void> => {
      await window.chatHistory.updateMessageContent(sessionId, messageIndex, updatedMessage)
      loadSessions() // セッション一覧を更新
    },
    [loadSessions]
  )

  // メッセージを削除
  const deleteMessage = useCallback(
    async (sessionId: string, messageIndex: number): Promise<void> => {
      await window.chatHistory.deleteMessage(sessionId, messageIndex)
      loadSessions() // セッション一覧を更新
    },
    [loadSessions]
  )

  const value = {
    sessions,
    currentSessionId,
    getSession,
    createSession,
    addMessage,
    updateSessionTitle,
    deleteSession,
    deleteAllSessions,
    setActiveSession,
    updateMessageContent,
    deleteMessage
  }

  return <ChatHistoryContext.Provider value={value}>{children}</ChatHistoryContext.Provider>
}

// Custom Hook
export const useChatHistory = () => {
  const context = useContext(ChatHistoryContext)
  if (context === undefined) {
    throw new Error('useChatHistory must be used within a ChatHistoryProvider')
  }
  return context
}
