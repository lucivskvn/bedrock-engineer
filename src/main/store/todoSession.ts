import path from 'path'
import fs from 'fs'
import Store from 'electron-store'
import { store } from '../../preload/store'
import { log } from '../../common/logger'
import { ensureValidStorageKey } from '../../common/security/pathGuards'

export interface TodoItem {
  id: string
  description: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  createdAt: string
  updatedAt: string
}

export interface TodoList {
  id: string
  items: TodoItem[]
  createdAt: string
  updatedAt: string
  sessionId: string
  projectPath: string
}

export interface TodoItemUpdate {
  id: string
  status?: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  description?: string
}

export interface TodoMetadata {
  id: string
  sessionId: string
  projectPath: string
  itemCount: number
  createdAt: string
  updatedAt: string
}

export interface TodoUpdateResult {
  success: boolean
  updatedList?: TodoList
  currentList?: TodoList
  error?: string
}

type TodoMetadataStoreState = {
  activeTodoListId?: string
  recentTodos: string[]
  metadata: Record<string, TodoMetadata>
}

type TodoMetadataStore = {
  get<K extends keyof TodoMetadataStoreState>(key: K): TodoMetadataStoreState[K]
  set<K extends keyof TodoMetadataStoreState>(key: K, value: TodoMetadataStoreState[K]): void
  delete(key: keyof TodoMetadataStoreState): void
  store: TodoMetadataStoreState
}

export class TodoSessionManager {
  private readonly todosDir: string
  private metadataStore: TodoMetadataStore

  constructor() {
    const userDataPath = store.get('userDataPath')
    if (!userDataPath) {
      throw new Error('userDataPath is not set in store')
    }

    // TODOファイルを保存するディレクトリを作成
    this.todosDir = path.join(userDataPath, 'todos')
    fs.mkdirSync(this.todosDir, { recursive: true })

    // メタデータ用のストアを初期化
    this.metadataStore = new Store<TodoMetadataStoreState>({
      name: 'todo-sessions-meta',
      defaults: {
        recentTodos: [],
        metadata: {}
      }
    }) as unknown as TodoMetadataStore

    // 初回起動時またはメタデータが空の場合、既存のTODOリストからメタデータを生成
    this.initializeMetadata()
  }

  private initializeMetadata(): void {
    const metadata = this.metadataStore.get('metadata')
    if (Object.keys(metadata).length === 0) {
      try {
        const files = fs.readdirSync(this.todosDir)
        const todoFiles = files.filter((file) => file.endsWith('_todos.json'))

        for (const file of todoFiles) {
          try {
            const fileId = file.replace('_todos.json', '')
            const safeSessionId = this.normalizeSessionId(fileId)
            const todoList = this.readTodoFile(safeSessionId)
          if (todoList) {
              this.updateMetadata(safeSessionId, todoList)
          }
          } catch (error) {
            log.warn('Skipping todo metadata initialization for malformed session id', {
              file,
              error: error instanceof Error ? error.message : String(error)
            })
          }
        }

        log.debug('Todo metadata initialized successfully')
        } catch (error) {
          log.error('Error initializing todo metadata:', { error })
        }
    }
  }

  private normalizeSessionId(sessionId: string): string {
    return ensureValidStorageKey(sessionId, {
      label: 'Todo session ID',
      prefix: 'session_',
      maxLength: 160
    })
  }

  private getTodoFilePath(sessionId: string): string {
    const safeSessionId = this.normalizeSessionId(sessionId)
    return path.join(this.todosDir, `${safeSessionId}_todos.json`)
  }

  private readTodoFile(sessionId: string): TodoList | null {
    const filePath = this.getTodoFilePath(sessionId)
    try {
      const data = fs.readFileSync(filePath, 'utf-8')
      return JSON.parse(data) as TodoList
      } catch (error) {
        log.error('Failed to read todo session file', {
          sessionId,
          error: error instanceof Error ? error.message : String(error)
        })
        return null
      }
  }

  private async writeTodoFile(sessionId: string, todoList: TodoList): Promise<void> {
    const filePath = this.getTodoFilePath(sessionId)
    try {
      await fs.promises.writeFile(filePath, JSON.stringify(todoList, null, 2))
      } catch (error) {
        log.error('Failed to write todo session file', {
          sessionId,
          error: error instanceof Error ? error.message : String(error)
        })
      }
  }

  private updateMetadata(sessionId: string, todoList: TodoList): void {
    const metadata: TodoMetadata = {
      id: todoList.id,
      sessionId: todoList.sessionId,
      projectPath: todoList.projectPath,
      itemCount: todoList.items.length,
      createdAt: todoList.createdAt,
      updatedAt: todoList.updatedAt
    }

    const current = this.metadataStore.get('metadata')
    this.metadataStore.set('metadata', {
      ...current,
      [sessionId]: metadata
    })
  }

  async createTodoList(sessionId: string, projectPath: string, items: string[]): Promise<TodoList> {
    const safeSessionId = this.normalizeSessionId(sessionId)
    const todoId = `todolist-${Date.now()}`
    const now = new Date().toISOString()

    const todoList: TodoList = {
      id: todoId,
      items: items.map((description, index) => ({
        id: `task-${Date.now()}-${index}`,
        description,
        status: 'pending' as const,
        createdAt: now,
        updatedAt: now
      })),
      createdAt: now,
      updatedAt: now,
      sessionId: safeSessionId,
      projectPath
    }

    await this.writeTodoFile(safeSessionId, todoList)
    this.updateMetadata(safeSessionId, todoList)
    this.updateRecentTodos(safeSessionId)

    return todoList
  }

  async updateTodoList(sessionId: string, updates: TodoItemUpdate[]): Promise<TodoUpdateResult> {
    try {
      const safeSessionId = this.normalizeSessionId(sessionId)
      const todoList = this.readTodoFile(safeSessionId)
      if (!todoList) {
        return {
          success: false,
          error: 'No todo list found. Please initialize a todo list first using todoInit.'
        }
      }

      const updatedItems = [...todoList.items]
      const now = new Date().toISOString()

      for (const update of updates) {
        const itemIndex = updatedItems.findIndex((item) => item.id === update.id)
        if (itemIndex === -1) {
          return {
            success: false,
            error: `Task with ID "${update.id}" not found`,
            currentList: todoList
          }
        }

        if (update.status) {
          updatedItems[itemIndex].status = update.status
        }
        if (update.description) {
          updatedItems[itemIndex].description = update.description
        }
        updatedItems[itemIndex].updatedAt = now
      }

      const updatedList: TodoList = {
        ...todoList,
        items: updatedItems,
        updatedAt: now
      }

      await this.writeTodoFile(safeSessionId, updatedList)
      this.updateMetadata(safeSessionId, updatedList)
      this.updateRecentTodos(safeSessionId)

      return {
        success: true,
        updatedList
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  getTodoList(sessionId: string): TodoList | null {
    try {
      return this.readTodoFile(this.normalizeSessionId(sessionId))
    } catch (error) {
      log.warn('Rejected todo list access for invalid session id', {
        sessionId,
        error: error instanceof Error ? error.message : String(error)
      })
      return null
    }
  }

  deleteTodoList(sessionId: string): void {
    try {
      const safeSessionId = this.normalizeSessionId(sessionId)
      const filePath = this.getTodoFilePath(safeSessionId)
    try {
      fs.unlinkSync(filePath)

      // メタデータからも削除
      const metadata = this.metadataStore.get('metadata')
        delete metadata[safeSessionId]
      this.metadataStore.set('metadata', metadata)
      } catch (error) {
        log.error('Failed to delete todo session file', {
          sessionId,
          error: error instanceof Error ? error.message : String(error)
        })
      }

    const recentTodos = this.metadataStore.get('recentTodos')
    this.metadataStore.set(
      'recentTodos',
      recentTodos.filter((id) => id !== safeSessionId)
    )
    } catch (error) {
      log.warn('Failed to delete todo list due to invalid session id', {
        sessionId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private updateRecentTodos(sessionId: string): void {
    const safeSessionId = this.normalizeSessionId(sessionId)
    const recentTodos = this.metadataStore.get('recentTodos')
    const updated = [safeSessionId, ...recentTodos.filter((id) => id !== safeSessionId)].slice(0, 10)
    this.metadataStore.set('recentTodos', updated)
  }

  getRecentTodos(): TodoMetadata[] {
    const recentIds = this.metadataStore.get('recentTodos')
    const metadata = this.metadataStore.get('metadata')
    return recentIds
      .map((id) => metadata[id])
      .filter((meta): meta is TodoMetadata => {
        if (!meta) return false
        // TODOファイルが実際に存在することを確認
        const filePath = this.getTodoFilePath(meta.sessionId)
        return fs.existsSync(filePath)
      })
      .filter((meta) => meta.itemCount > 0)
  }

  getAllTodoMetadata(): TodoMetadata[] {
    const metadata = this.metadataStore.get('metadata')
    return Object.values(metadata)
      .filter((meta) => {
        // メタデータが存在し、対応するファイルも存在することを確認
        const filePath = this.getTodoFilePath(meta.sessionId)
        return fs.existsSync(filePath)
      })
      .filter((meta) => meta.itemCount > 0)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }

  setActiveTodoList(sessionId: string | undefined): void {
    const value = sessionId ? this.normalizeSessionId(sessionId) : undefined
    this.metadataStore.set('activeTodoListId', value)
  }

  getActiveTodoListId(): string | undefined {
    const stored = this.metadataStore.get('activeTodoListId')
    if (!stored) {
      return undefined
    }
    try {
      return this.normalizeSessionId(stored)
    } catch (error) {
      log.warn('Removing invalid active todo session id', {
        sessionId: stored,
        error: error instanceof Error ? error.message : String(error)
      })
      this.metadataStore.delete('activeTodoListId')
      return undefined
    }
  }
}
