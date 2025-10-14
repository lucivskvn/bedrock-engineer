import path from 'path'
import fs from 'fs'
import Store from 'electron-store'
import { ChatSession, ChatMessage, SessionMetadata } from '../../types/chat/history'
import { store } from '../../preload/store'
import { log } from '../../common/logger'
import { ensureValidStorageKey } from '../../common/security/pathGuards'

type ChatSessionMetadataStoreState = {
  activeSessionId?: string
  recentSessions: string[]
  metadata: Record<string, SessionMetadata>
}

type ChatSessionMetadataStore = {
  get<K extends keyof ChatSessionMetadataStoreState>(key: K): ChatSessionMetadataStoreState[K]
  set<K extends keyof ChatSessionMetadataStoreState>(key: K, value: ChatSessionMetadataStoreState[K]): void
  delete(key: keyof ChatSessionMetadataStoreState): void
  store: ChatSessionMetadataStoreState
}

export class ChatSessionManager {
  private readonly sessionsDir: string
  private metadataStore: ChatSessionMetadataStore

  constructor() {
    const userDataPath = store.get('userDataPath')
    if (!userDataPath) {
      throw new Error('userDataPath is not set in store')
    }

    // セッションファイルを保存するディレクトリを作成
    this.sessionsDir = path.join(userDataPath, 'chat-sessions')
    fs.mkdirSync(this.sessionsDir, { recursive: true })

    // メタデータ用のストアを初期化
    this.metadataStore = new Store<ChatSessionMetadataStoreState>({
      name: 'chat-sessions-meta',
      defaults: {
        recentSessions: [],
        metadata: {}
      }
    }) as unknown as ChatSessionMetadataStore

    // 初回起動時またはメタデータが空の場合、既存のセッションからメタデータを生成
    this.initializeMetadata()
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
          } catch (error) {
            log.warn('Skipping chat session metadata initialization for malformed id', {
              file,
              error: error instanceof Error ? error.message : String(error)
            })
          }
        }

        log.debug('Metadata initialized successfully')
        } catch (error) {
          log.error('Error initializing metadata:', { error })
        }
    }
  }

  private normalizeSessionId(sessionId: string): string {
    return ensureValidStorageKey(sessionId, {
      label: 'Chat session ID',
      prefix: 'session_',
      maxLength: 160
    })
  }

  private getSessionFilePath(sessionId: string): string {
    const safeSessionId = this.normalizeSessionId(sessionId)
    return path.join(this.sessionsDir, `${safeSessionId}.json`)
  }

  private readSessionFile(sessionId: string): ChatSession | null {
    const filePath = this.getSessionFilePath(sessionId)
    try {
      const data = fs.readFileSync(filePath, 'utf-8')
      return JSON.parse(data) as ChatSession
      } catch (error) {
        log.error('Failed to read chat session file', {
          sessionId,
          error: error instanceof Error ? error.message : String(error)
        })
        return null
      }
  }

  private async writeSessionFile(sessionId: string, session: ChatSession): Promise<void> {
    const filePath = this.getSessionFilePath(sessionId)
    try {
      await fs.promises.writeFile(filePath, JSON.stringify(session, null, 2))
      } catch (error) {
        log.error('Failed to write chat session file', {
          sessionId,
          error: error instanceof Error ? error.message : String(error)
        })
      }
  }

  private updateMetadata(sessionId: string, session: ChatSession): void {
    const metadata: SessionMetadata = {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: session.messages.length,
      agentId: session.agentId,
      modelId: session.modelId,
      systemPrompt: session.systemPrompt
    }

    const current = this.metadataStore.get('metadata')
    this.metadataStore.set('metadata', {
      ...current,
      [sessionId]: metadata
    })
  }

  async createSession(agentId: string, modelId: string, systemPrompt?: string): Promise<string> {
    const rawId = `session_${Date.now()}`
    const id = this.normalizeSessionId(rawId)
    const session: ChatSession = {
      id,
      title: `Chat ${new Date().toLocaleString()}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      agentId,
      modelId,
      systemPrompt
    }

    await this.writeSessionFile(id, session)
    this.updateMetadata(id, session)
    this.updateRecentSessions(id)
    return id
  }

  async addMessage(sessionId: string, message: ChatMessage): Promise<void> {
    const safeSessionId = this.normalizeSessionId(sessionId)
    const session = this.readSessionFile(safeSessionId)
    if (!session) return

    session.messages.push(message)
    session.updatedAt = Date.now()

    await this.writeSessionFile(safeSessionId, session)
    this.updateMetadata(safeSessionId, session)
    this.updateRecentSessions(safeSessionId)
  }

  getSession(sessionId: string): ChatSession | null {
    try {
      return this.readSessionFile(this.normalizeSessionId(sessionId))
    } catch (error) {
      log.warn('Rejected chat session access for invalid id', {
        sessionId,
        error: error instanceof Error ? error.message : String(error)
      })
      return null
    }
  }

  async updateSessionTitle(sessionId: string, title: string): Promise<void> {
    const safeSessionId = this.normalizeSessionId(sessionId)
    const session = this.readSessionFile(safeSessionId)
    if (!session) return

    session.title = title

    await this.writeSessionFile(safeSessionId, session)
    this.updateMetadata(safeSessionId, session)
  }

  deleteSession(sessionId: string): void {
    try {
      const safeSessionId = this.normalizeSessionId(sessionId)
      const filePath = this.getSessionFilePath(safeSessionId)
    try {
      fs.unlinkSync(filePath)

      // メタデータからも削除
      const metadata = this.metadataStore.get('metadata')
        delete metadata[safeSessionId]
      this.metadataStore.set('metadata', metadata)
      } catch (error) {
        log.error('Failed to delete chat session file', {
          sessionId,
          error: error instanceof Error ? error.message : String(error)
        })
      }

    const recentSessions = this.metadataStore.get('recentSessions')
    this.metadataStore.set(
      'recentSessions',
      recentSessions.filter((id) => id !== safeSessionId)
    )
    } catch (error) {
      log.warn('Failed to delete chat session due to invalid id', {
        sessionId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  deleteAllSessions(): void {
    try {
      // セッションディレクトリ内のすべてのJSONファイルを削除
      const files = fs.readdirSync(this.sessionsDir)
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this.sessionsDir, file)
          fs.unlinkSync(filePath)
        }
      }

      // メタデータをリセット
      this.metadataStore.set('metadata', {})
      this.metadataStore.set('recentSessions', [])
      this.metadataStore.delete('activeSessionId')

      log.debug('All sessions have been deleted successfully')
      } catch (error) {
        log.error('Error deleting all sessions:', { error })
      }
  }

  private updateRecentSessions(sessionId: string): void {
    const safeSessionId = this.normalizeSessionId(sessionId)
    const recentSessions = this.metadataStore.get('recentSessions')
    const updated = [safeSessionId, ...recentSessions.filter((id) => id !== safeSessionId)].slice(0, 10)
    this.metadataStore.set('recentSessions', updated)
  }

  getRecentSessions(): SessionMetadata[] {
    const recentIds = this.metadataStore.get('recentSessions')
    const metadata = this.metadataStore.get('metadata')
    return recentIds
      .map((id) => metadata[id])
      .filter((meta): meta is SessionMetadata => {
        if (!meta) return false
        // セッションファイルが実際に存在することを確認
        const filePath = this.getSessionFilePath(meta.id)
        return fs.existsSync(filePath)
      })
      .filter((meta) => meta.messageCount > 0)
  }

  getAllSessionMetadata(): SessionMetadata[] {
    const metadata = this.metadataStore.get('metadata')
    return Object.values(metadata)
      .filter((meta) => {
        // メタデータが存在し、対応するファイルも存在することを確認
        const filePath = this.getSessionFilePath(meta.id)
        return fs.existsSync(filePath)
      })
      .filter((meta) => meta.messageCount > 0)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  setActiveSession(sessionId: string | undefined): void {
    const value = sessionId ? this.normalizeSessionId(sessionId) : undefined
    this.metadataStore.set('activeSessionId', value)
  }

  getActiveSessionId(): string | undefined {
    const stored = this.metadataStore.get('activeSessionId')
    if (!stored) {
      return undefined
    }

    try {
      return this.normalizeSessionId(stored)
    } catch (error) {
      log.warn('Removing invalid active chat session id', {
        sessionId: stored,
        error: error instanceof Error ? error.message : String(error)
      })
      this.metadataStore.delete('activeSessionId')
      return undefined
    }
  }

  async updateMessageContent(
    sessionId: string,
    messageIndex: number,
    updatedMessage: ChatMessage
  ): Promise<void> {
    const safeSessionId = this.normalizeSessionId(sessionId)
    const session = this.readSessionFile(safeSessionId)
    if (!session) return

    // 指定されたインデックスが有効な範囲内かチェック
    if (messageIndex < 0 || messageIndex >= session.messages.length) {
      log.error('Invalid chat message index', {
        sessionId: safeSessionId,
        messageIndex,
        messageCount: session.messages.length
      })
      return
    }

    // メッセージを更新
    session.messages[messageIndex] = updatedMessage
    session.updatedAt = Date.now()

    // ファイルとメタデータを更新
    await this.writeSessionFile(safeSessionId, session)
    this.updateMetadata(safeSessionId, session)
  }

  async deleteMessage(sessionId: string, messageIndex: number): Promise<void> {
    const safeSessionId = this.normalizeSessionId(sessionId)
    const session = this.readSessionFile(safeSessionId)
    if (!session) return

    // 指定されたインデックスが有効な範囲内かチェック
    if (messageIndex < 0 || messageIndex >= session.messages.length) {
      log.error('Invalid chat message index', {
        sessionId: safeSessionId,
        messageIndex,
        messageCount: session.messages.length
      })
      return
    }

    // メッセージを削除
    session.messages.splice(messageIndex, 1)
    session.updatedAt = Date.now()

    // ファイルとメタデータを更新
    await this.writeSessionFile(safeSessionId, session)
    this.updateMetadata(safeSessionId, session)
  }
}
