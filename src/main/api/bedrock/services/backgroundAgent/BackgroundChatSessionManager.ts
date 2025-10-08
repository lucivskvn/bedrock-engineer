import path from 'path'
import fs from 'fs'
import Store from 'electron-store'
import { v4 as uuidv4 } from 'uuid'
import { BackgroundMessage } from './types'
import { store } from '../../../../../preload/store'
import { createCategoryLogger } from '../../../../../common/logger'
import { ensureValidStorageKey } from '../../../../../common/security/pathGuards'

const logger = createCategoryLogger('background-agent:chat-session')

export interface BackgroundSessionMetadata {
  sessionId: string
  taskId?: string
  agentId: string
  modelId: string
  projectDirectory?: string
  createdAt: number
  updatedAt: number
  messageCount: number
  executionType: 'scheduled' | 'manual'
}

export interface BackgroundChatSession {
  sessionId: string
  taskId?: string
  agentId: string
  modelId: string
  projectDirectory?: string
  createdAt: number
  updatedAt: number
  messages: BackgroundMessage[]
  executionMetadata?: {
    executedAt: number
    success: boolean
    error?: string
  }
}

export interface CreateSessionOptions {
  taskId?: string
  agentId?: string
  modelId?: string
  projectDirectory?: string
  executionType?: 'scheduled' | 'manual'
}

/**
 * BackgroundAgentのセッション永続化管理クラス
 * 既存のChatSessionManagerを参考に実装
 */
export class BackgroundChatSessionManager {
  private readonly sessionsDir: string
  private metadataStore: Store<{
    metadata: { [key: string]: BackgroundSessionMetadata }
  }>

  constructor() {
    const userDataPath = store.get('userDataPath')
    if (!userDataPath) {
      throw new Error('userDataPath is not set in store')
    }

    // BackgroundAgentのセッションファイルを保存するディレクトリを作成
    this.sessionsDir = path.join(userDataPath, 'background-agent-sessions')
    fs.mkdirSync(this.sessionsDir, { recursive: true })

    // メタデータ用のストアを初期化
    this.metadataStore = new Store({
      name: 'background-agent-sessions-meta',
      defaults: {
        metadata: {} as { [key: string]: BackgroundSessionMetadata }
      }
    })

    // 初回起動時、既存のセッションからメタデータを生成
    this.initializeMetadata()

    logger.info('BackgroundChatSessionManager initialized', {
      sessionsDir: this.sessionsDir
    })
  }

  private initializeMetadata(): void {
    const metadata = this.metadataStore.get('metadata')
    if (Object.keys(metadata).length === 0) {
      try {
        const files = fs.readdirSync(this.sessionsDir)
        const sessionFiles = files.filter((file) => file.endsWith('.json'))

        for (const file of sessionFiles) {
          try {
            const sessionId = this.normalizeSessionId(file.replace('.json', ''))
            const session = this.readSessionFile(sessionId)
            if (session) {
              this.updateMetadata(sessionId, session)
            }
          } catch (error: any) {
            logger.warn('Skipping background session metadata initialization', {
              file,
              error: error.message
            })
          }
        }

        logger.info('Background session metadata initialized', {
          sessionCount: sessionFiles.length
        })
      } catch (error: any) {
        logger.error('Error initializing background session metadata', {
          error: error.message
        })
      }
    }
  }

  private normalizeSessionId(sessionId: string): string {
    return ensureValidStorageKey(sessionId, {
      label: 'Background session ID',
      maxLength: 200
    })
  }

  private getSessionFilePath(sessionId: string): string {
    const safeSessionId = this.normalizeSessionId(sessionId)
    return path.join(this.sessionsDir, `${safeSessionId}.json`)
  }

  private readSessionFile(sessionId: string): BackgroundChatSession | null {
    const filePath = this.getSessionFilePath(sessionId)
    try {
      if (!fs.existsSync(filePath)) {
        return null
      }

      const data = fs.readFileSync(filePath, 'utf-8')

      // Check if file is empty or contains only whitespace
      if (!data || data.trim().length === 0) {
        logger.warn('Session file is empty, removing corrupted file', {
          sessionId,
          filePath
        })
        this.removeCorruptedSessionFile(sessionId)
        return null
      }

      const session = JSON.parse(data) as BackgroundChatSession

      // Validate session structure
      if (!session.sessionId || !session.messages || !Array.isArray(session.messages)) {
        logger.warn('Session file has invalid structure, removing corrupted file', {
          sessionId,
          filePath,
          hasSessionId: !!session.sessionId,
          hasMessages: !!session.messages,
          messagesIsArray: Array.isArray(session.messages)
        })
        this.removeCorruptedSessionFile(sessionId)
        return null
      }

      return session
    } catch (error: any) {
      logger.warn('Error reading background session file, removing corrupted file', {
        sessionId,
        error: error.message,
        filePath
      })

      // Remove corrupted file to prevent repeated errors
      this.removeCorruptedSessionFile(sessionId)
      return null
    }
  }

  private async writeSessionFile(sessionId: string, session: BackgroundChatSession): Promise<void> {
    const filePath = this.getSessionFilePath(sessionId)
    const tempFilePath = `${filePath}.tmp-${uuidv4()}`

    // リトライ機能付きでファイル書き込みを実行（原子操作）
    const maxRetries = 3
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // 一時ファイルに書き込み
        await fs.promises.writeFile(tempFilePath, JSON.stringify(session, null, 2))

        // 原子的にリネーム（一時ファイル → 本ファイル）
        await fs.promises.rename(tempFilePath, filePath)

        logger.debug('Background session file written atomically', {
          sessionId,
          messageCount: session.messages.length,
          attempt,
          tempFilePath
        })
        return // 成功時は即座に終了
      } catch (error: any) {
        lastError = error
        logger.warn(`Error writing background session file (attempt ${attempt}/${maxRetries})`, {
          sessionId,
          error: error.message,
          filePath,
          tempFilePath
        })

        // 一時ファイルのクリーンアップ
        try {
          if (fs.existsSync(tempFilePath)) {
            await fs.promises.unlink(tempFilePath)
          }
        } catch (cleanupError: any) {
          logger.debug('Error cleaning up temp file', {
            tempFilePath,
            error: cleanupError.message
          })
        }

        // 最後の試行でない場合は少し待機
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 100 * attempt))
        }
      }
    }

    // 全ての試行が失敗した場合はエラーを投げる
    logger.error('Failed to write background session file after all retries', {
      sessionId,
      error: lastError?.message,
      filePath,
      maxRetries
    })
    throw new Error(
      `Failed to write session file after ${maxRetries} attempts: ${lastError?.message}`
    )
  }

  /**
   * Remove corrupted session file and its metadata
   */
  private removeCorruptedSessionFile(sessionId: string): void {
    try {
      const filePath = this.getSessionFilePath(sessionId)
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
        logger.debug('Removed corrupted session file', { sessionId, filePath })
      }

      // Remove from metadata store as well
      const metadata = this.metadataStore.get('metadata')
      if (metadata[sessionId]) {
        delete metadata[sessionId]
        this.metadataStore.set('metadata', metadata)
        logger.debug('Removed corrupted session from metadata', { sessionId })
      }
    } catch (error: any) {
      logger.error('Failed to remove corrupted session file', {
        sessionId,
        error: error.message
      })
    }
  }

  private updateMetadata(sessionId: string, session: BackgroundChatSession): void {
    const metadata: BackgroundSessionMetadata = {
      sessionId: session.sessionId,
      taskId: session.taskId,
      agentId: session.agentId,
      modelId: session.modelId,
      projectDirectory: session.projectDirectory,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: session.messages.length,
      executionType: session.taskId ? 'scheduled' : 'manual'
    }

    const current = this.metadataStore.get('metadata')
    this.metadataStore.set('metadata', {
      ...current,
      [sessionId]: metadata
    })

    logger.debug('Background session metadata updated', {
      sessionId,
      messageCount: metadata.messageCount
    })
  }

  /**
   * 新しいセッションを作成
   */
  async createSession(sessionId: string, options: CreateSessionOptions = {}): Promise<void> {
    const safeSessionId = this.normalizeSessionId(sessionId)

    if (this.hasValidSession(safeSessionId)) {
      logger.warn('Background session already exists', { sessionId: safeSessionId })
      return
    }

    const session: BackgroundChatSession = {
      sessionId: safeSessionId,
      taskId: options.taskId,
      agentId: options.agentId || '',
      modelId: options.modelId || '',
      projectDirectory: options.projectDirectory,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: []
    }

    await this.writeSessionFile(safeSessionId, session)
    this.updateMetadata(safeSessionId, session)

    logger.info('Background session created', {
      sessionId: safeSessionId,
      taskId: options.taskId,
      agentId: options.agentId,
      projectDirectory: options.projectDirectory
    })
  }

  /**
   * セッションが存在し、有効かチェック
   */
  hasSession(sessionId: string): boolean {
    const safeSessionId = this.normalizeSessionId(sessionId)
    const session = this.readSessionFile(safeSessionId)
    return session !== null
  }

  /**
   * セッションが有効かどうかをチェック（ファイル存在 + 有効なJSON構造）
   */
  hasValidSession(sessionId: string): boolean {
    return this.hasSession(sessionId)
  }

  /**
   * セッションにメッセージを追加
   */
  async addMessage(sessionId: string, message: BackgroundMessage): Promise<void> {
    const safeSessionId = this.normalizeSessionId(sessionId)
    let session = this.readSessionFile(safeSessionId)

    // セッションが存在しない場合は作成
    if (!session) {
      try {
        await this.createSession(safeSessionId)
        session = this.readSessionFile(safeSessionId)
        if (!session) {
          const error = new Error(`Failed to create session for message: ${safeSessionId}`)
          logger.error('Failed to create session for message', {
            sessionId: safeSessionId,
            messageId: message.id,
            error: error.message
          })
          throw error
        }
      } catch (error: any) {
        logger.error('Error creating session for message', {
          sessionId: safeSessionId,
          messageId: message.id,
          error: error.message
        })
        throw new Error(`Failed to create session for message: ${error.message}`)
      }
    }

    // メッセージを追加
    session.messages.push(message)
    session.updatedAt = Date.now()

    try {
      // ファイル書き込み（リトライ機能付き）
      await this.writeSessionFile(safeSessionId, session)
      this.updateMetadata(safeSessionId, session)

      logger.debug('Message added to background session', {
        sessionId: safeSessionId,
        messageId: message.id,
        role: message.role,
        totalMessages: session.messages.length
      })
    } catch (error: any) {
      logger.error('Failed to save message to session', {
        sessionId: safeSessionId,
        messageId: message.id,
        role: message.role,
        error: error.message
      })

      // メッセージ追加に失敗した場合は、メモリ上のセッションからもメッセージを削除
      session.messages.pop()

      throw new Error(`Failed to save message to session: ${error.message}`)
    }
  }

  /**
   * セッションの会話履歴を取得
   */
  getHistory(sessionId: string): BackgroundMessage[] {
    const session = this.readSessionFile(sessionId)
    if (!session) {
      logger.debug('Background session not found, returning empty history', { sessionId })
      return []
    }

    logger.debug('Retrieved background session history', {
      sessionId,
      messageCount: session.messages.length
    })

    return [...session.messages] // コピーを返す
  }

  /**
   * セッションを削除
   */
  deleteSession(sessionId: string): boolean {
    const safeSessionId = this.normalizeSessionId(sessionId)
    const filePath = this.getSessionFilePath(safeSessionId)
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
      }

      // メタデータからも削除
      const metadata = this.metadataStore.get('metadata')
      delete metadata[safeSessionId]
      this.metadataStore.set('metadata', metadata)

      logger.info('Background session deleted', { sessionId: safeSessionId })
      return true
    } catch (error: any) {
      logger.error('Error deleting background session', {
        sessionId: safeSessionId,
        error: error.message
      })
      return false
    }
  }

  /**
   * 全セッションID一覧を取得
   */
  listSessions(): string[] {
    try {
      const files = fs.readdirSync(this.sessionsDir)
      const sessionIds = files
        .filter((file) => file.endsWith('.json'))
        .map((file) => {
          try {
            return this.normalizeSessionId(file.replace('.json', ''))
          } catch (error: any) {
            logger.warn('Skipping invalid background session file during listing', {
              file,
              error: error.message
            })
            return null
          }
        })
        .filter((id): id is string => id !== null)

      logger.debug('Listed background sessions', { count: sessionIds.length })
      return sessionIds
    } catch (error: any) {
      logger.error('Error listing background sessions', {
        error: error.message
      })
      return []
    }
  }

  /**
   * セッション統計情報を取得
   */
  getSessionStats(sessionId: string): {
    exists: boolean
    messageCount: number
    userMessages: number
    assistantMessages: number
    metadata?: BackgroundSessionMetadata
  } {
    const safeSessionId = this.normalizeSessionId(sessionId)
    const session = this.readSessionFile(safeSessionId)
    if (!session) {
      return {
        exists: false,
        messageCount: 0,
        userMessages: 0,
        assistantMessages: 0
      }
    }

    const userMessages = session.messages.filter((m) => m.role === 'user').length
    const assistantMessages = session.messages.filter((m) => m.role === 'assistant').length
    const metadata = this.metadataStore.get('metadata')[safeSessionId]

    return {
      exists: true,
      messageCount: session.messages.length,
      userMessages,
      assistantMessages,
      metadata
    }
  }

  /**
   * 全セッションの統計情報を取得
   */
  getAllSessionStats(): {
    totalSessions: number
    totalMessages: number
    averageMessagesPerSession: number
  } {
    const sessionIds = this.listSessions()
    let totalMessages = 0

    for (const sessionId of sessionIds) {
      const session = this.readSessionFile(sessionId)
      if (session) {
        totalMessages += session.messages.length
      }
    }

    const averageMessagesPerSession = sessionIds.length > 0 ? totalMessages / sessionIds.length : 0

    return {
      totalSessions: sessionIds.length,
      totalMessages,
      averageMessagesPerSession: Math.round(averageMessagesPerSession * 100) / 100
    }
  }

  /**
   * セッションメタデータを取得
   */
  getSessionMetadata(sessionId: string): BackgroundSessionMetadata | undefined {
    const safeSessionId = this.normalizeSessionId(sessionId)
    return this.metadataStore.get('metadata')[safeSessionId]
  }

  /**
   * 全セッションメタデータを取得
   */
  getAllSessionsMetadata(): BackgroundSessionMetadata[] {
    const metadata = this.metadataStore.get('metadata')
    return Object.values(metadata)
      .filter((meta) => {
        // ファイルが実際に存在することを確認
        const filePath = this.getSessionFilePath(meta.sessionId)
        return fs.existsSync(filePath)
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /**
   * プロジェクトディレクトリでセッションをフィルタ
   */
  getSessionsByProjectDirectory(projectDirectory: string): BackgroundSessionMetadata[] {
    return this.getAllSessionsMetadata().filter(
      (session) => session.projectDirectory === projectDirectory
    )
  }

  /**
   * エージェントIDでセッションをフィルタ
   */
  getSessionsByAgentId(agentId: string): BackgroundSessionMetadata[] {
    return this.getAllSessionsMetadata().filter((session) => session.agentId === agentId)
  }

  /**
   * タスクIDでセッションをフィルタ
   */
  getSessionsByTaskId(taskId: string): BackgroundSessionMetadata[] {
    return this.getAllSessionsMetadata().filter((session) => session.taskId === taskId)
  }

  /**
   * 実行メタデータを更新
   */
  async updateExecutionMetadata(
    sessionId: string,
    executionMetadata: BackgroundChatSession['executionMetadata']
  ): Promise<void> {
    const safeSessionId = this.normalizeSessionId(sessionId)
    const session = this.readSessionFile(safeSessionId)
    if (!session) {
      logger.warn('Cannot update execution metadata for non-existent session', { sessionId: safeSessionId })
      return
    }

    session.executionMetadata = executionMetadata
    session.updatedAt = Date.now()

    await this.writeSessionFile(safeSessionId, session)
    this.updateMetadata(safeSessionId, session)

    logger.debug('Execution metadata updated', {
      sessionId: safeSessionId,
      success: executionMetadata?.success
    })
  }

  /**
   * メモリクリーンアップ：古いセッションを削除
   */
  cleanupOldSessions(maxAgeMs: number = 30 * 24 * 60 * 60 * 1000): number {
    const cutoffTime = Date.now() - maxAgeMs
    let cleanedCount = 0

    const metadata = this.metadataStore.get('metadata')
    const sessionsToDelete = Object.values(metadata).filter(
      (session) => session.updatedAt < cutoffTime
    )

    for (const session of sessionsToDelete) {
      if (this.deleteSession(session.sessionId)) {
        cleanedCount++
      }
    }

    if (cleanedCount > 0) {
      logger.info('Cleaned up old background sessions', { cleanedCount })
    }

    return cleanedCount
  }
}
