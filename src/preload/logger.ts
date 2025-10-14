import { ipcRenderer } from 'electron'
import { LogLevel } from '../common/logger/config'

/**
 * Send log message to main process via IPC
 * This allows preload and renderer processes to use the centralized logging system
 */
const sendLogToMain = (level: LogLevel, message: string, meta: any = {}) => {
  if (!ipcRenderer || typeof ipcRenderer.send !== 'function') {
    if (process.env.NODE_ENV !== 'test') {
      process.emitWarning('ipcRenderer unavailable, skipping preload log dispatch', {
        code: 'IPC_LOGGER_FALLBACK',
        detail: JSON.stringify({ level, message })
      })
    }
    return
  }

  ipcRenderer.send('logger:log', {
    level,
    message,
    timestamp: new Date().toISOString(),
    process: 'preload',
    ...(typeof meta === 'object' ? meta : { value: meta })
  })
}

const mergeMeta = (meta: any[]) => (meta.length > 0 ? Object.assign({}, ...meta) : {})

/**
 * Preload logger API
 * This implementation forwards logs to the main process via IPC
 */
export const preloadLogger = {
  error: (message: string, ...meta: any[]) => {
    sendLogToMain('error', 'Preload error log', {
      forwardedMessage: message,
      ...mergeMeta(meta)
    })
  },
  warn: (message: string, ...meta: any[]) => {
    sendLogToMain('warn', 'Preload warning log', {
      forwardedMessage: message,
      ...mergeMeta(meta)
    })
  },
  info: (message: string, ...meta: any[]) => {
    sendLogToMain('info', message, mergeMeta(meta))
  },
  debug: (message: string, ...meta: any[]) => {
    sendLogToMain('debug', message, mergeMeta(meta))
  },
  verbose: (message: string, ...meta: any[]) => {
    sendLogToMain('verbose', message, mergeMeta(meta))
  }
}

/**
 * Create a category-specific logger for preload
 */
export const createPreloadCategoryLogger = (category: string) => {
  return {
    error: (message: string, ...meta: any[]) => {
      preloadLogger.error(message, { ...mergeMeta(meta), category })
    },
    warn: (message: string, ...meta: any[]) => {
      preloadLogger.warn(message, { ...mergeMeta(meta), category })
    },
    info: (message: string, ...meta: any[]) => {
      preloadLogger.info(message, { ...mergeMeta(meta), category })
    },
    debug: (message: string, ...meta: any[]) => {
      preloadLogger.debug(message, { ...mergeMeta(meta), category })
    },
    verbose: (message: string, ...meta: any[]) => {
      preloadLogger.verbose(message, { ...mergeMeta(meta), category })
    }
  }
}

/**
 * Renderer logger API - exposed to the renderer process
 */
export const rendererLogger = {
  error: (message: string, ...meta: any[]) => {
    sendLogToMain('error', 'Renderer error log', {
      forwardedMessage: message,
      ...mergeMeta(meta),
      process: 'renderer'
    })
  },
  warn: (message: string, ...meta: any[]) => {
    sendLogToMain('warn', 'Renderer warning log', {
      forwardedMessage: message,
      ...mergeMeta(meta),
      process: 'renderer'
    })
  },
  info: (message: string, ...meta: any[]) => {
    sendLogToMain('info', message, { ...mergeMeta(meta), process: 'renderer' })
  },
  debug: (message: string, ...meta: any[]) => {
    sendLogToMain('debug', message, { ...mergeMeta(meta), process: 'renderer' })
  },
  verbose: (message: string, ...meta: any[]) => {
    sendLogToMain('verbose', message, { ...mergeMeta(meta), process: 'renderer' })
  }
}

/**
 * Create a category-specific logger for renderer
 */
export const createRendererCategoryLogger = (category: string) => {
  return {
    error: (message: string, ...meta: any[]) => {
      rendererLogger.error(message, { ...mergeMeta(meta), category })
    },
    warn: (message: string, ...meta: any[]) => {
      rendererLogger.warn(message, { ...mergeMeta(meta), category })
    },
    info: (message: string, ...meta: any[]) => {
      rendererLogger.info(message, { ...mergeMeta(meta), category })
    },
    debug: (message: string, ...meta: any[]) => {
      rendererLogger.debug(message, { ...mergeMeta(meta), category })
    },
    verbose: (message: string, ...meta: any[]) => {
      rendererLogger.verbose(message, { ...mergeMeta(meta), category })
    }
  }
}

export type PreloadLogger = typeof preloadLogger
export type PreloadCategoryLogger = ReturnType<typeof createPreloadCategoryLogger>
export type RendererLogger = typeof rendererLogger
export type RendererCategoryLogger = ReturnType<typeof createRendererCategoryLogger>

// Create and export default logger
export const log = preloadLogger
