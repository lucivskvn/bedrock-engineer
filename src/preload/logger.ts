import { ipcRenderer } from 'electron'
import { LogLevel } from '../common/logger/config'

/**
 * Send log message to main process via IPC
 * This allows preload and renderer processes to use the centralized logging system
 */
const sendLogToMain = (level: LogLevel, message: string, meta: Record<string, any> = {}) => {
  ipcRenderer.send('logger:log', {
    level,
    message,
    timestamp: new Date().toISOString(),
    process: 'preload', // Changed from 'renderer' to 'preload' for clarity
    ...meta
  })
}

/**
 * Preload logger API
 * This implementation forwards logs to the main process via IPC
 */
export const preloadLogger = {
  error: (message: string, meta: Record<string, any> = {}) => {
    sendLogToMain('error', message, meta)
  },
  warn: (message: string, meta: Record<string, any> = {}) => {
    sendLogToMain('warn', message, meta)
  },
  info: (message: string, meta: Record<string, any> = {}) => {
    sendLogToMain('info', message, meta)
  },
  debug: (message: string, meta: Record<string, any> = {}) => {
    sendLogToMain('debug', message, meta)
  },
  verbose: (message: string, meta: Record<string, any> = {}) => {
    sendLogToMain('verbose', message, meta)
  }
}

/**
 * Create a category-specific logger for preload
 */
export const createPreloadCategoryLogger = (category: string) => {
  return {
    error: (message: string, meta: Record<string, any> = {}) => {
      preloadLogger.error(message, { ...meta, category })
    },
    warn: (message: string, meta: Record<string, any> = {}) => {
      preloadLogger.warn(message, { ...meta, category })
    },
    info: (message: string, meta: Record<string, any> = {}) => {
      preloadLogger.info(message, { ...meta, category })
    },
    debug: (message: string, meta: Record<string, any> = {}) => {
      preloadLogger.debug(message, { ...meta, category })
    },
    verbose: (message: string, meta: Record<string, any> = {}) => {
      preloadLogger.verbose(message, { ...meta, category })
    }
  }
}

/**
 * Renderer logger API - exposed to the renderer process
 */
export const rendererLogger = {
  error: (message: string, meta: Record<string, any> = {}) => {
    sendLogToMain('error', message, { ...meta, process: 'renderer' })
  },
  warn: (message: string, meta: Record<string, any> = {}) => {
    sendLogToMain('warn', message, { ...meta, process: 'renderer' })
  },
  info: (message: string, meta: Record<string, any> = {}) => {
    sendLogToMain('info', message, { ...meta, process: 'renderer' })
  },
  debug: (message: string, meta: Record<string, any> = {}) => {
    sendLogToMain('debug', message, { ...meta, process: 'renderer' })
  },
  verbose: (message: string, meta: Record<string, any> = {}) => {
    sendLogToMain('verbose', message, { ...meta, process: 'renderer' })
  }
}

/**
 * Create a category-specific logger for renderer
 */
export const createRendererCategoryLogger = (category: string) => {
  return {
    error: (message: string, meta: Record<string, any> = {}) => {
      rendererLogger.error(message, { ...meta, category })
    },
    warn: (message: string, meta: Record<string, any> = {}) => {
      rendererLogger.warn(message, { ...meta, category })
    },
    info: (message: string, meta: Record<string, any> = {}) => {
      rendererLogger.info(message, { ...meta, category })
    },
    debug: (message: string, meta: Record<string, any> = {}) => {
      rendererLogger.debug(message, { ...meta, category })
    },
    verbose: (message: string, meta: Record<string, any> = {}) => {
      rendererLogger.verbose(message, { ...meta, category })
    }
  }
}

export type PreloadLogger = typeof preloadLogger
export type PreloadCategoryLogger = ReturnType<typeof createPreloadCategoryLogger>
export type RendererLogger = typeof rendererLogger
export type RendererCategoryLogger = ReturnType<typeof createRendererCategoryLogger>

// Create and export default logger
export const log = preloadLogger
