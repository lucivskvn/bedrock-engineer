import { IpcMainInvokeEvent, BrowserWindow } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { log } from '../../common/logger'

// グローバルなタスク履歴ウィンドウの参照
let taskHistoryWindow: BrowserWindow | null = null

/**
 * タスク履歴ウィンドウを強制終了する
 * アプリケーション終了時に呼び出される
 */
export const forceCloseTaskHistoryWindow = (): void => {
  log.info('Force closing task history window...')

  if (taskHistoryWindow && !taskHistoryWindow.isDestroyed()) {
    try {
      // closeイベントリスナーを削除してデフォルトの閉じる動作を復元
      taskHistoryWindow.removeAllListeners('close')

      // ウィンドウを強制終了
      taskHistoryWindow.close()

      log.info('Task history window force closed successfully')
    } catch (error) {
      log.error('Failed to force close task history window', {
        error: error instanceof Error ? error.message : String(error)
      })

      // エラーが発生した場合はdestroy()で強制破棄
      try {
        taskHistoryWindow.destroy()
        log.info('Task history window destroyed as fallback')
      } catch (destroyError) {
        log.error('Failed to destroy task history window', {
          error: destroyError instanceof Error ? destroyError.message : String(destroyError)
        })
      }
    }

    taskHistoryWindow = null
  } else {
    log.debug('No task history window to close')
  }
}

/**
 * タスク履歴ウィンドウをプリロードする
 * アプリ起動時に非表示で事前作成しておく
 */
export const preloadTaskHistoryWindow = async (): Promise<void> => {
  log.info('Preloading task history window...')

  try {
    // すでにプリロード済みの場合はスキップ
    if (taskHistoryWindow && !taskHistoryWindow.isDestroyed()) {
      log.info('Task history window already preloaded')
      return
    }

    // プリロード用のウィンドウを作成（非表示）
    taskHistoryWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 800,
      minHeight: 600,
      parent: undefined,
      modal: false,
      show: false, // 非表示で作成
      alwaysOnTop: false,
      skipTaskbar: true, // プリロード中はタスクバーに表示しない
      autoHideMenuBar: true,
      title: 'Task Execution History',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        devTools: true
      }
    })

    // ダミーURLでページを読み込み（React アプリケーションの初期化）
    const dummyUrl =
      is.dev && process.env['ELECTRON_RENDERER_URL']
        ? `${process.env['ELECTRON_RENDERER_URL']}#/background-agent/task-history/preload`
        : `file://${join(__dirname, '../renderer/index.html')}#/background-agent/task-history/preload`

    await taskHistoryWindow.loadURL(dummyUrl)

    // ウィンドウが閉じられる時の処理（隠すのみ）
    taskHistoryWindow.on('close', (event) => {
      log.debug('Task history window close requested - hiding instead')
      event.preventDefault() // デフォルトの閉じる動作をキャンセル
      taskHistoryWindow!.hide()
      taskHistoryWindow!.setSkipTaskbar(true) // タスクバーからも隠す
    })

    // ウィンドウが実際に破棄された時の処理
    taskHistoryWindow.on('closed', () => {
      log.debug('Task history window actually destroyed')
      taskHistoryWindow = null
    })

    // プリロード完了のログ
    taskHistoryWindow.webContents.once('did-finish-load', () => {
      log.info('Task history window preload completed')
    })

    log.info('Task history window preload initiated')
  } catch (error) {
    log.error('Failed to preload task history window', {
      error: error instanceof Error ? error.message : String(error)
    })
    if (taskHistoryWindow) {
      taskHistoryWindow.destroy()
      taskHistoryWindow = null
    }
  }
}

export const windowHandlers = {
  'window:isFocused': async (event: IpcMainInvokeEvent) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    return window?.isFocused() ?? false
  },

  'window:openTaskHistory': async (_event: IpcMainInvokeEvent, taskId: string) => {
    log.info('Opening task history window for taskId', { taskId })

    // Build URL for the task history page
    const taskHistoryUrl =
      is.dev && process.env['ELECTRON_RENDERER_URL']
        ? `${process.env['ELECTRON_RENDERER_URL']}#/background-agent/task-history/${taskId}`
        : `file://${join(__dirname, '../renderer/index.html')}#/background-agent/task-history/${taskId}`

    log.debug('Target URL for task history window', { url: taskHistoryUrl })

    // Check if task history window already exists and is not destroyed
    if (taskHistoryWindow && !taskHistoryWindow.isDestroyed()) {
      log.debug('Using preloaded/existing task history window')

      try {
        // If window was preloaded and hidden, enable taskbar display before showing
        if (!taskHistoryWindow.isVisible()) {
          taskHistoryWindow.setSkipTaskbar(false)
        }

        // Update URL to show new task (much faster than creating new window)
        await taskHistoryWindow.loadURL(taskHistoryUrl)

        // Show and focus the window
        taskHistoryWindow.show()
        taskHistoryWindow.focus()

        log.info('Preloaded window updated with new task', { taskId })
        return { success: true, windowId: taskHistoryWindow.id, reused: true, preloaded: true }
      } catch (error) {
        log.error('Failed to update preloaded window', {
          error: error instanceof Error ? error.message : String(error)
        })
        // If update fails, destroy the old window and create a new one
        taskHistoryWindow.destroy()
        taskHistoryWindow = null
      }
    }

    // Create new task history window (fallback if preload failed)
    log.info('Creating new task history window (preload not available)')

    taskHistoryWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 800,
      minHeight: 600,
      parent: undefined,
      modal: false,
      show: false,
      alwaysOnTop: false,
      skipTaskbar: false,
      autoHideMenuBar: true,
      title: 'Task Execution History',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        devTools: true
      }
    })

    try {
      await taskHistoryWindow.loadURL(taskHistoryUrl)
      log.debug('Task history window URL loaded successfully')
    } catch (error) {
      log.error('Failed to load task history window URL', {
        error: error instanceof Error ? error.message : String(error)
      })
      taskHistoryWindow.destroy()
      taskHistoryWindow = null
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }

    // Open DevTools in development mode for debugging
    if (is.dev) {
      taskHistoryWindow.webContents.openDevTools({ mode: 'right' })
    }

    // Show window immediately since preload wasn't available
    taskHistoryWindow.show()

    // ウィンドウが閉じられる時の処理（隠すのみ）
    taskHistoryWindow.on('close', (event) => {
      log.debug('Task history window close requested - hiding instead')
      event.preventDefault() // デフォルトの閉じる動作をキャンセル
      taskHistoryWindow!.hide()
      taskHistoryWindow!.setSkipTaskbar(true) // タスクバーからも隠す
    })

    // ウィンドウが実際に破棄された時の処理
    taskHistoryWindow.on('closed', () => {
      log.debug('Task history window actually destroyed')
      taskHistoryWindow = null

      // Preload a new window for next time (background task)
      setTimeout(() => {
        preloadTaskHistoryWindow().catch((err) => {
          log.error('Failed to preload task history window after close', {
            error: err instanceof Error ? err.message : String(err)
          })
        })
      }, 2000) // 2秒後にプリロード
    })

    // Log when window is actually shown
    taskHistoryWindow.on('show', () => {
      log.debug('Task history window is now visible')
    })

    return { success: true, windowId: taskHistoryWindow.id, reused: false, preloaded: false }
  }
} as const
