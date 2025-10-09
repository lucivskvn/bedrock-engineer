import { app, shell, BrowserWindow, Menu, MenuItem, session } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../build/icon.ico?asset'
import { server } from './api'
import type { Server as HTTPServer } from 'http'
import Store from 'electron-store'
import getRandomPort from '../preload/lib/random-port'
import { store, storeReady } from '../preload/store'
import { resolveProxyConfig, convertToElectronProxyConfig } from './lib/proxy-utils'
import { isUrlAllowed, getAllowedHosts } from './lib/url-utils'
import { randomBytes } from 'crypto'
import fixPath from 'fix-path'
import {
  initLoggerConfig,
  initLogger,
  registerGlobalErrorHandlers,
  log,
  createCategoryLogger
} from '../common/logger'
import { isApiTokenStrong, normalizeApiToken, MIN_API_TOKEN_LENGTH } from '../common/security'
import { configureIpcSecurity, registerIpcHandlers, registerLogHandler } from './lib/ipc-handler'
import { bedrockHandlers } from './handlers/bedrock-handlers'
import { fileHandlers } from './handlers/file-handlers'
import { pdfHandlers } from './handlers/pdf-handlers'
import { docxHandlers } from './handlers/docx-handlers'
import {
  windowHandlers,
  preloadTaskHistoryWindow,
  forceCloseTaskHistoryWindow
} from './handlers/window-handlers'
import { agentHandlers } from './handlers/agent-handlers'
import { utilHandlers } from './handlers/util-handlers'
import { screenHandlers } from './handlers/screen-handlers'
import { cameraHandlers } from './handlers/camera-handlers'
import { registerProxyHandlers } from './handlers/proxy-handlers'
import {
  backgroundAgentHandlers,
  shutdownBackgroundAgentScheduler
} from './handlers/background-agent-handlers'
import { pubsubHandlers } from './handlers/pubsub-handlers'
import { todoHandlers } from './handlers/todo-handlers'
import type {
  PermissionRequest,
  WebContents,
  Session,
  DisplayMediaRequestHandlerHandlerRequest,
  OnBeforeRequestListenerDetails
} from 'electron'
import {
  getAllowedPermissions,
  isPermissionAllowed,
  isTrustedRendererUrl
} from './security/policy'
import { isLoopbackHostname, normalizeHttpOrigin } from '../common/security/urlGuards'

app.enableSandbox()

try {
  fixPath()
} catch (error) {
  log.error('Failed to initialize fix-path module', {
    error: error instanceof Error ? error.message : String(error)
  })
}

// No need to track project path anymore as we always read from disk
Store.initRenderer()

app.on('select-client-certificate', (event, webContents, url) => {
  event.preventDefault()
  const ownerUrl = webContents && typeof webContents.getURL === 'function' ? webContents.getURL() : undefined
  log.warn('Blocked client certificate selection request', {
    url,
    ownerUrl
  })
})

// Initialize category loggers
const apiLogger = createCategoryLogger('api')
const agentsLogger = createCategoryLogger('agents')

// プロキシ認証情報を保存するグローバル変数
let currentProxyConfig: any = null

const isDevelopmentEnvironment =
  is.dev || process.env.NODE_ENV === 'development' || !!process.env.ELECTRON_RENDERER_URL

function tryNormalizeTrustedOrigin(origin: string): string | null {
  try {
    return normalizeHttpOrigin(origin, { allowLoopbackHttp: true })
  } catch {
    return null
  }
}

function resolveTrustedOrigins(): string[] {
  const origins = new Set<string>()
  const envOrigins = process.env.ALLOWED_ORIGINS
  if (envOrigins) {
    envOrigins
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0 && origin !== '*')
      .forEach((origin) => {
        const sanitized = tryNormalizeTrustedOrigin(origin)
        if (sanitized) {
          origins.add(sanitized)
        } else {
          log.warn('Ignoring invalid origin in ALLOWED_ORIGINS for navigation trust', { origin })
        }
      })
  }

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) {
    const sanitizedRenderer = tryNormalizeTrustedOrigin(rendererUrl)
    if (sanitizedRenderer) {
      origins.add(sanitizedRenderer)
    }
  }

  if (isDevelopmentEnvironment) {
    origins.add('http://localhost:5173')
    origins.add('http://127.0.0.1:5173')
    origins.add('http://[::1]:5173')
  }

  return Array.from(origins)
}

const trustedOrigins = resolveTrustedOrigins()

app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  event.preventDefault()

  const ownerUrl = webContents && typeof webContents.getURL === 'function' ? webContents.getURL() : undefined

  log.warn('Blocked navigation due to TLS certificate error', {
    url,
    ownerUrl,
    error,
    certificateSubject: certificate?.subjectName,
    certificateIssuer: certificate?.issuerName
  })

  callback(false)
})

const allowFileProtocol = !isDevelopmentEnvironment

configureIpcSecurity({
  trustedOrigins,
  allowFileProtocol
})

const allowedPermissions = Array.from(getAllowedPermissions())

const hardenedSessions = new WeakSet<Session>()

function shouldBlockRendererRequest(url: string): boolean {
  if (!url || url.startsWith('blob:') || url.startsWith('data:')) {
    return false
  }

  try {
    const parsed = new URL(url)
    const protocol = parsed.protocol

    if (protocol === 'file:' || protocol === 'app:' || protocol === 'devtools:' || protocol === 'chrome-devtools:') {
      return false
    }

    if (protocol === 'http:' || protocol === 'ws:') {
      if (isLoopbackHostname(parsed.hostname)) {
        return false
      }

      if (isDevelopmentEnvironment || process.env.ALLOW_HTTP_ORIGINS === 'true') {
        return false
      }

      return true
    }

    if (protocol === 'https:' || protocol === 'wss:') {
      return false
    }

    return true
  } catch {
    return true
  }
}

function applySessionSecurity(targetSession: Session): void {
  if (hardenedSessions.has(targetSession)) {
    return
  }

  hardenedSessions.add(targetSession)

  targetSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestDetails = details as PermissionRequest & { requestingOrigin?: string }
    const origin = requestDetails.requestingOrigin || requestDetails.requestingUrl || webContents.getURL()

    if (
      !isTrustedRendererUrl(origin, trustedOrigins, allowFileProtocol) ||
      !isPermissionAllowed(permission, details, {
        allowedOrigins: trustedOrigins,
        allowFileProtocol,
        origin
      })
    ) {
      log.warn('Denied permission request', {
        permission,
        origin,
        ownerUrl: webContents.getURL()
      })
      callback(false)
      return
    }

    log.debug('Permission request approved', {
      permission,
      origin,
      ownerUrl: webContents.getURL()
    })
    callback(true)
  })

  targetSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    const origin = requestingOrigin || details?.requestingUrl || webContents?.getURL() || ''

    if (
      origin &&
      (!isTrustedRendererUrl(origin, trustedOrigins, allowFileProtocol) ||
        !isPermissionAllowed(permission, details, {
          allowedOrigins: trustedOrigins,
          allowFileProtocol,
          origin
        }))
    ) {
      return false
    }

    return isPermissionAllowed(permission, details, {
      allowedOrigins: trustedOrigins,
      allowFileProtocol,
      origin
    })
  })

  targetSession.setDisplayMediaRequestHandler(
    (request: DisplayMediaRequestHandlerHandlerRequest, callback) => {
      const origin = request.securityOrigin
      if (!origin || !isTrustedRendererUrl(origin, trustedOrigins, allowFileProtocol)) {
        log.warn('Blocked untrusted display media request', {
          origin: origin || 'unknown'
        })
        callback({})
        return
      }

      log.warn('Rejected direct display media request; use vetted screen capture APIs', {
        origin
      })
      callback({})
    },
    { useSystemPicker: false }
  )

  targetSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details: OnBeforeRequestListenerDetails, callback) => {
    if (!details.webContentsId) {
      callback({})
      return
    }

    if (shouldBlockRendererRequest(details.url)) {
      log.warn('Blocked renderer network request to insecure target', {
        url: details.url,
        resourceType: details.resourceType
      })
      callback({ cancel: true })
      return
    }

    callback({})
  })

  const storagePath = typeof targetSession.getStoragePath === 'function' ? targetSession.getStoragePath() : undefined
  const persistent = typeof targetSession.isPersistent === 'function' ? targetSession.isPersistent() : undefined

  log.info('Applied session hardening', {
    storagePath: storagePath || 'memory',
    persistent
  })
}

function attachContentSecurityHooks(contents: WebContents): void {
  const currentUrl = typeof contents.getURL === 'function' ? contents.getURL() : ''
  if (currentUrl.startsWith('devtools://')) {
    return
  }

  contents.on('will-attach-webview', (event, _webPreferences, params) => {
    event.preventDefault()
    log.warn('Blocked attempt to attach <webview>', {
      targetUrl: params?.src,
      ownerUrl: contents.getURL()
    })
  })

  contents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url, trustedOrigins, allowFileProtocol)) {
      event.preventDefault()
      log.warn('Blocked navigation to untrusted URL', {
        targetUrl: url,
        ownerUrl: contents.getURL()
      })
    }
  })

  contents.setWindowOpenHandler((details) => {
    if (isUrlAllowed(details.url, getAllowedHosts())) {
      void shell.openExternal(details.url)
    } else {
      log.warn('Blocked attempt to open external window', {
        targetUrl: details.url,
        ownerUrl: contents.getURL()
      })
    }
    return { action: 'deny' }
  })
}

function setupSessionPermissionHandlers(): void {
  const defaultSession = session.defaultSession
  if (!defaultSession) {
    log.warn('Default session unavailable; skipping permission hardening')
    return
  }

  applySessionSecurity(defaultSession)

  app.on('session-created', (createdSession) => {
    applySessionSecurity(createdSession)
  })

  log.info('Permission handlers registered', {
    allowedPermissions
  })
}

app.on('web-contents-created', (_event, contents) => {
  attachContentSecurityHooks(contents)
})

/**
 * プロキシ認証ハンドラーを設定
 */
function setupProxyAuthHandler(_window: BrowserWindow, proxyConfig: any): void {
  // 現在のプロキシ設定を保存
  currentProxyConfig = proxyConfig

  log.debug('Proxy authentication handler configured', {
    host: proxyConfig.host,
    port: proxyConfig.port,
    hasUsername: !!proxyConfig.username,
    hasPassword: !!proxyConfig.password
  })
}

/**
 * BrowserWindow Session のプロキシ設定を適用
 */
async function setupSessionProxy(window: BrowserWindow): Promise<void> {
  try {
    // ストアからAWS設定を読み取り
    const awsConfig = store.get('aws') as any

    // プロキシ設定を決定
    const proxyConfig = resolveProxyConfig(awsConfig?.proxyConfig)
    log.debug('Resolved proxy configuration', { proxyConfig })

    if (proxyConfig) {
      const electronProxyRules = convertToElectronProxyConfig(proxyConfig)

      if (electronProxyRules) {
        await window.webContents.session.setProxy({
          mode: 'fixed_servers',
          proxyRules: electronProxyRules
        })

        // プロキシ認証ハンドラーの設定
        if (proxyConfig.username && proxyConfig.password) {
          setupProxyAuthHandler(window, proxyConfig)
        }

        log.info('Session proxy configured', {
          host: proxyConfig.host,
          port: proxyConfig.port,
          proxyRules: electronProxyRules,
          hasAuth: !!(proxyConfig.username && proxyConfig.password)
        })
      }
    } else {
      // プロキシなしの場合は直接接続
      await window.webContents.session.setProxy({
        mode: 'direct'
      })

      log.debug('Session proxy disabled - using direct connection')
    }
  } catch (error) {
    log.error('Failed to setup session proxy', {
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

function createMenu(window: BrowserWindow) {
  const isMac = process.platform === 'darwin'
  const template = [
    // Application Menu (macOS only)
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ]
      : []),
    // Edit Menu
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac
          ? [{ role: 'pasteAndMatchStyle' }, { role: 'delete' }, { role: 'selectAll' }]
          : [{ role: 'delete' }, { type: 'separator' }, { role: 'selectAll' }])
      ]
    },
    // View Menu
    {
      label: 'View',
      submenu: [
        ...(is.dev
          ? [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }]
          : []),
        {
          label: 'Zoom In',
          accelerator: 'CommandOrControl+Plus',
          click: () => {
            const currentZoom = window.webContents.getZoomFactor()
            window.webContents.setZoomFactor(currentZoom + 0.1)
          }
        },
        {
          label: 'Zoom Out',
          accelerator: 'CommandOrControl+-',
          click: () => {
            const currentZoom = window.webContents.getZoomFactor()
            window.webContents.setZoomFactor(Math.max(0.1, currentZoom - 0.1))
          }
        },
        {
          label: 'Reset Zoom',
          accelerator: 'CommandOrControl+0',
          click: () => {
            window.webContents.setZoomFactor(1.0)
          }
        },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    // Window Menu
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? [
              {
                label: 'Hide Window',
                accelerator: 'Cmd+W',
                click: () => {
                  if (mainWindow) {
                    mainWindow.hide()
                  }
                }
              },
              { type: 'separator' },
              { role: 'front' },
              { role: 'window' }
            ]
          : [{ role: 'close' }])
      ]
    },
    // Help Menu
    {
      role: 'help',
      submenu: [
        {
          label: 'GitHub Repository',
          click: async () => {
            await shell.openExternal('https://github.com/daisuke-awaji/bedrock-engineer')
          }
        }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template as any)
  Menu.setApplicationMenu(menu)
}

async function createWindow(): Promise<void> {
  await storeReady
  // Create the browser window.
  mainWindow = new BrowserWindow({
    minWidth: 640,
    minHeight: 416,
    width: 1800,
    height: 1340,
    show: false,
    autoHideMenuBar: false,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      spellcheck: false,
      // Zoom related settings
      zoomFactor: 1.0,
      enableWebSQL: false
    }
  })

  // Create menu with mainWindow
  createMenu(mainWindow)

  // セッションレベルでプロキシを設定
  await setupSessionProxy(mainWindow)

  // Add zoom-related shortcut keys
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control || input.meta) {
      if (input.key === '=' || input.key === '+') {
        const currentZoom = mainWindow!.webContents.getZoomFactor()
        mainWindow!.webContents.setZoomFactor(currentZoom + 0.1)
        event.preventDefault()
      } else if (input.key === '-') {
        const currentZoom = mainWindow!.webContents.getZoomFactor()
        mainWindow!.webContents.setZoomFactor(Math.max(0.1, currentZoom - 0.1))
        event.preventDefault()
      } else if (input.key === '0') {
        mainWindow!.webContents.setZoomFactor(1.0)
        event.preventDefault()
      } else if (is.dev && input.key === 'r') {
        mainWindow!.reload()
        event.preventDefault()
      }
    }
  })

  // Create context menu
  const contextMenu = new Menu()
  contextMenu.append(
    new MenuItem({
      label: 'Copy',
      role: 'copy'
    })
  )
  contextMenu.append(
    new MenuItem({
      label: 'Paste',
      role: 'paste'
    })
  )

  // Handle context menu events
  mainWindow.webContents.on('context-menu', () => {
    contextMenu.popup()
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
  })

  // Handle window close event with platform-specific behavior
  mainWindow.on('close', (event) => {
    if (process.platform === 'darwin' && !isQuitting) {
      // macOS: Hide instead of close unless explicitly quitting
      event.preventDefault()
      mainWindow!.hide()
    } else {
      // Windows/Linux: Perform cleanup and close
      if (process.platform === 'win32') {
        // Windows-specific cleanup before closing
        try {
          // Force shutdown Background Agent Scheduler
          shutdownBackgroundAgentScheduler()
          log.info('Windows: Background Agent Scheduler shutdown completed during window close')
        } catch (error) {
          log.error('Windows: Failed to shutdown Background Agent Scheduler during window close', {
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
      mainWindow = null
    }
  })

  // Handle window closed event for final cleanup
  mainWindow.on('closed', () => {
    mainWindow = null
    // Ensure all background processes are terminated
    if (process.platform === 'win32') {
      log.info('Windows: Main window closed, ensuring process termination')
      // Force process exit after a brief delay to allow cleanup
      setTimeout(() => {
        process.exit(0)
      }, 1000)
    }
  })

  const envToken = normalizeApiToken(process.env.API_AUTH_TOKEN)
  if (process.env.API_AUTH_TOKEN && !envToken) {
    apiLogger.warn('Ignoring weak API_AUTH_TOKEN value from environment', {
      minLength: MIN_API_TOKEN_LENGTH
    })
  }

  const storedTokenValue = store.get('apiAuthToken')
  const normalizedStoredToken = normalizeApiToken(storedTokenValue)

  if (
    typeof storedTokenValue === 'string' &&
    normalizedStoredToken === null &&
    storedTokenValue.trim().length > 0
  ) {
    apiLogger.warn('Stored API token failed strength validation; regenerating a new token')
  }

  const storedToken = normalizedStoredToken ?? undefined

  let apiAuthToken = envToken ?? storedToken ?? randomBytes(32).toString('hex')

  if (!isApiTokenStrong(apiAuthToken)) {
    apiLogger.warn('Generated API token did not meet strength requirements; regenerating')
    apiAuthToken = randomBytes(32).toString('hex')
  }

  if (!storedToken || storedToken !== apiAuthToken) {
    store.set('apiAuthToken', apiAuthToken)
  }

  process.env.API_AUTH_TOKEN = apiAuthToken

  const port = await getRandomPort()
  store.set('apiEndpoint', `http://127.0.0.1:${port}`)

  apiServer = server.listen(port, '127.0.0.1', () => {
    apiLogger.info('API server started', {
      endpoint: `http://127.0.0.1:${port}`
    })
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    mainWindow.webContents.openDevTools({
      mode: 'right'
    })
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Get userDataPath early to ensure it's available for logger initialization
const userDataPath = app.getPath('userData')
// Initialize logger configuration and instance early
initLoggerConfig(userDataPath)
// Create the logger instance explicitly after configuration is set
initLogger()
registerGlobalErrorHandlers()

// Global reference to main window
let mainWindow: BrowserWindow | null = null
// Track app quit state for macOS
let isQuitting = false
// Reference to running API HTTP server
let apiServer: HTTPServer | null = null

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  await storeReady
  // Set userDataPath in store
  store.set('userDataPath', userDataPath)

  log.info('Application started', {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    userDataPath
  })

  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  setupSessionPermissionHandlers()

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // プロキシ認証ハンドラーの設定（アプリケーションレベル）
  app.on('login', (event, _webContents, _authenticationResponseDetails, authInfo, callback) => {
    // プロキシ認証のリクエストかチェック
    if (authInfo.isProxy && currentProxyConfig?.username && currentProxyConfig?.password) {
      event.preventDefault()
      callback(currentProxyConfig.username, currentProxyConfig.password)

      log.debug('Proxy authentication provided', {
        host: authInfo.host,
        port: authInfo.port,
        realm: authInfo.realm
      })
    }
  })

  // IPCハンドラーの一括登録
  registerIpcHandlers(bedrockHandlers, { loggerCategory: 'bedrock:ipc' })
  registerIpcHandlers(fileHandlers, { loggerCategory: 'file:ipc' })
  registerIpcHandlers(pdfHandlers, { loggerCategory: 'pdf:ipc' })
  registerIpcHandlers(docxHandlers, { loggerCategory: 'docx:ipc' })
  registerIpcHandlers(windowHandlers, { loggerCategory: 'window:ipc' })
  registerIpcHandlers(agentHandlers, { loggerCategory: 'agents:ipc' })
  registerIpcHandlers(utilHandlers, { loggerCategory: 'utils:ipc' })
  registerIpcHandlers(screenHandlers, { loggerCategory: 'screen:ipc' })
  registerIpcHandlers(cameraHandlers, { loggerCategory: 'camera:ipc' })
  registerIpcHandlers(backgroundAgentHandlers, { loggerCategory: 'background-agent:ipc' })
  registerIpcHandlers(pubsubHandlers, { loggerCategory: 'pubsub:ipc' })
  registerIpcHandlers(todoHandlers, { loggerCategory: 'todo:ipc' })

  // プロキシ関連IPCハンドラーの登録
  registerProxyHandlers()

  // ログハンドラーの登録
  registerLogHandler()

  // Initial load of shared agents (optional - for logging purposes only)
  agentHandlers['read-shared-agents'](null as any)
    .then((result) => {
      agentsLogger.info(`Found shared agents at startup`, {
        count: result.agents.length,
        agentIds: result.agents.map((agent) => agent.id)
      })
    })
    .catch((err) => {
      agentsLogger.error('Failed to load shared agents', {
        error: err instanceof Error ? err.message : String(err)
      })
    })
  createWindow()

  // Preload task history window in the background for faster access
  setTimeout(() => {
    preloadTaskHistoryWindow().catch((err) => {
      log.error('Failed to preload task history window at startup', {
        error: err instanceof Error ? err.message : String(err)
      })
    })
  }, 3000) // 3秒後にプリロード（メインウィンドウの初期化完了後）

  // Log where Electron Store saves config.json
  log.debug('Electron Store configuration directory', {
    userDataDir: app.getPath('userData'),
    configFile: `${app.getPath('userData')}/config.json`
  })

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (mainWindow === null) {
      createWindow()
    } else if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show()
    }
  })

  // Handle before-quit with enhanced cleanup
  app.on('before-quit', (event) => {
    isQuitting = true

    log.info('Application before-quit event triggered', {
      platform: process.platform,
      quitRequested: isQuitting
    })

    // Prevent immediate quit to allow proper cleanup
    if (!isQuitting) {
      event.preventDefault()
    }

    // タスク履歴ウィンドウの強制終了処理
    try {
      forceCloseTaskHistoryWindow()
      log.info('Task history window force close completed')
    } catch (error) {
      log.error('Failed to force close task history window', {
        error: error instanceof Error ? error.message : String(error)
      })
    }

    // Close API server to release port
    if (apiServer) {
      try {
        apiServer.close(() => {
          log.info('API server closed')
        })
      } catch (error) {
        log.error('Failed to close API server', {
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    // Background Agent Schedulerのシャットダウン処理（強化版）
    try {
      shutdownBackgroundAgentScheduler()
      log.info('Background Agent Scheduler shutdown completed')

      // Windows環境では追加の確認処理
      if (process.platform === 'win32') {
        // プロセス終了前の最終確認
        setTimeout(() => {
          log.info('Windows: Final cleanup completed, terminating process')
          // 強制終了（Windows環境のみ）
          process.exit(0)
        }, 2000) // 2秒後に強制終了
      }
    } catch (error) {
      log.error('Failed to shutdown Background Agent Scheduler', {
        error: error instanceof Error ? error.message : String(error)
      })

      // エラーが発生してもWindows環境では強制終了
      if (process.platform === 'win32') {
        setTimeout(() => {
          log.error('Windows: Force exit due to cleanup error')
          process.exit(1)
        }, 3000)
      }
    }
  })
})

// Quit when all windows are closed, with platform-specific behavior
app.on('window-all-closed', () => {
  log.info('All windows closed', {
    platform: process.platform,
    willQuit: process.platform !== 'darwin'
  })

  if (process.platform !== 'darwin') {
    // Windows/Linux: Quit immediately
    if (process.platform === 'win32') {
      // Windows: Ensure background processes are terminated
      try {
        shutdownBackgroundAgentScheduler()
        log.info('Windows: Final scheduler shutdown on window-all-closed')
      } catch (error) {
        log.error('Windows: Error during final scheduler shutdown', {
          error: error instanceof Error ? error.message : String(error)
        })
      }

      // Force quit after brief cleanup
      setTimeout(() => {
        log.info('Windows: Force quit after all windows closed')
        process.exit(0)
      }, 1500)
    } else {
      // Linux: Normal quit
      app.quit()
    }
  }
  // macOS: Keep running (dock behavior)
})

/**
 * プロキシ設定変更時の動的適用（再起動不要）
 */
export async function updateProxySettings(): Promise<void> {
  if (!mainWindow) {
    log.warn('Cannot update proxy settings: mainWindow is null')
    return
  }

  try {
    // セッションプロキシを再設定
    await setupSessionProxy(mainWindow)

    // AWS SDKクライアントは次回作成時に新しい設定が適用される
    log.info('Proxy settings updated successfully')
  } catch (error) {
    log.error('Failed to update proxy settings', {
      error: error instanceof Error ? error.message : String(error)
    })
    throw error
  }
}

// In this file you can include the rest of your app"s specific main process
// code. You can also put them in separate files and require them here.
