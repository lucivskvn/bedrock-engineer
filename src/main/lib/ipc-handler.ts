import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { IPCChannels, IPCResult } from '../../types/ipc'
import { log, createCategoryLogger } from '../../common/logger'
import { isTrustedRendererUrl } from '../security/policy'

type LoggerLike = {
  warn: (message: string, meta?: Record<string, unknown>) => void
  error: (message: string, meta?: Record<string, unknown>) => void
  debug: (message: string, meta?: Record<string, unknown>) => void
  verbose?: (message: string, meta?: Record<string, unknown>) => void
}

interface IpcSecurityConfig {
  trustedOrigins: string[]
  allowFileProtocol: boolean
}

let ipcSecurityConfig: IpcSecurityConfig = {
  trustedOrigins: [],
  allowFileProtocol: false
}

export function configureIpcSecurity(config: {
  trustedOrigins: string[]
  allowFileProtocol: boolean
}): void {
  ipcSecurityConfig = {
    trustedOrigins: Array.from(new Set(config.trustedOrigins)),
    allowFileProtocol: config.allowFileProtocol
  }
}

type AnyIpcEvent = IpcMainEvent | IpcMainInvokeEvent

function extractEventUrl(event: AnyIpcEvent): string | null {
  const potentialUrls = new Set<string>()

  const invokeEvent = event as IpcMainInvokeEvent
  if (invokeEvent?.senderFrame?.url) {
    potentialUrls.add(invokeEvent.senderFrame.url)
  }

  const sender = event.sender as WebContents | undefined
  if (sender && typeof sender.getURL === 'function') {
    const url = sender.getURL()
    if (url) {
      potentialUrls.add(url)
    }
  }

  const mainFrameUrl = (sender as unknown as { mainFrame?: { url?: string } })?.mainFrame?.url
  if (typeof mainFrameUrl === 'string') {
    potentialUrls.add(mainFrameUrl)
  }

  for (const url of potentialUrls) {
    if (url && url !== 'about:blank') {
      return url
    }
  }

  return null
}

function ensureTrustedRenderer(event: AnyIpcEvent, channel: string, logger: LoggerLike): void {
  const sourceUrl = extractEventUrl(event)

  if (
    sourceUrl &&
    isTrustedRendererUrl(sourceUrl, ipcSecurityConfig.trustedOrigins, ipcSecurityConfig.allowFileProtocol)
  ) {
    return
  }

  logger.warn('Rejected IPC request from untrusted renderer', {
    channel,
    sourceUrl: sourceUrl ?? 'unknown',
    trustedOrigins: ipcSecurityConfig.trustedOrigins
  })

  throw new Error('Renderer origin is not allowed for this channel')
}

type IpcHandlerFn<C extends IPCChannels> = (
  event: IpcMainInvokeEvent,
  ...args: any[]
) => Promise<IPCResult<C>> | IPCResult<C>

/**
 * 型安全なIPCハンドラー登録用ラッパー
 */
export function registerIpcHandler<C extends IPCChannels>(
  channel: C,
  handler: IpcHandlerFn<C>,
  options?: {
    loggerCategory?: string
  }
): void {
  const logger = options?.loggerCategory ? createCategoryLogger(options.loggerCategory) : log

  ipcMain.handle(channel, async (event, ...args) => {
    try {
      ensureTrustedRenderer(event, channel, logger)

      logger.debug(`IPC handler invoked: ${channel}`, {
        channel,
        argsLength: args.length
      })

      const result = await handler(event, ...args)

      logger.debug(`IPC handler completed: ${channel}`, {
        channel,
        success: true
      })

      return result
    } catch (error) {
      logger.error(`IPC handler error: ${channel}`, {
        channel,
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  })

  logger.verbose(`IPC handler registered: ${channel}`)
}

/**
 * 一括登録用ユーティリティ
 */
export function registerIpcHandlers<T extends Record<IPCChannels, IpcHandlerFn<any>>>(
  handlers: Partial<T>,
  options?: {
    loggerCategory?: string
  }
): void {
  Object.entries(handlers).forEach(([channel, handler]) => {
    registerIpcHandler(channel as IPCChannels, handler, options)
  })
}

/**
 * ログ専用のIPCハンドラー（onを使用）
 */
export function registerLogHandler(): void {
  const logger = log

  ipcMain.on('logger:log', (event, logData) => {
    try {
      ensureTrustedRenderer(event, 'logger:log', logger)
    } catch (error) {
      logger.warn('Blocked logger IPC event from untrusted renderer', {
        error: error instanceof Error ? error.message : String(error)
      })
      return
    }

    const { level, message, process: processType, category, ...meta } = logData

    // If a category is specified, use a category logger
    const categoryLogger = category ? createCategoryLogger(category) : logger

    // Include process type in metadata for filtering
    const metaWithProcess = {
      ...meta,
      process: processType || 'unknown'
    }

    switch (level) {
      case 'error':
        categoryLogger.error(message, metaWithProcess)
        break
      case 'warn':
        categoryLogger.warn(message, metaWithProcess)
        break
      case 'info':
        categoryLogger.info(message, metaWithProcess)
        break
      case 'debug':
        categoryLogger.debug(message, metaWithProcess)
        break
      case 'verbose':
        categoryLogger.verbose(message, metaWithProcess)
        break
      default:
        categoryLogger.info(message, metaWithProcess)
    }
  })

  logger.verbose('Log IPC handler registered')
}
