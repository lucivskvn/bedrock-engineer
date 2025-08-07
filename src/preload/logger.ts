import { ipcRenderer } from 'electron'
import { LogLevel } from '../common/logger/config'

/**
 * Send log message to main process via IPC
 * This allows preload and renderer processes to use the centralized logging system
 */
const sendLogToMain = (level: LogLevel, message: string, meta: any = {}) => {
  ipcRenderer.send('logger:log', {
    level,
    message,
    timestamp: new Date().toISOString(),
    process: 'preload',
    ...(typeof meta === 'object' ? meta : { value: meta })
  })
}

/**
 * Preload logger API
 * This implementation forwards logs to the main process via IPC
 */
export const preloadLogger = {
  error: (message: string, ...meta: any[]) => {
    sendLogToMain('error', message, Object.assign({}, ...meta))
  },
  warn: (message: string, ...meta: any[]) => {
    sendLogToMain('warn', message, Object.assign({}, ...meta))
  },
  info: (message: string, ...meta: any[]) => {
    sendLogToMain('info', message, Object.assign({}, ...meta))
  },
  debug: (message: string, ...meta: any[]) => {
    sendLogToMain('debug', message, Object.assign({}, ...meta))
  },
  verbose: (message: string, ...meta: any[]) => {
    sendLogToMain('verbose', message, Object.assign({}, ...meta))
  }
}

/**
 * Create a category-specific logger for preload
 */
export const createPreloadCategoryLogger = (category: string) => {
  return {
    error: (message: string, ...meta: any[]) => {
      preloadLogger.error(message, { ...Object.assign({}, ...meta), category })
    },
    warn: (message: string, ...meta: any[]) => {
      preloadLogger.warn(message, { ...Object.assign({}, ...meta), category })
    },
    info: (message: string, ...meta: any[]) => {
      preloadLogger.info(message, { ...Object.assign({}, ...meta), category })
    },
    debug: (message: string, ...meta: any[]) => {
      preloadLogger.debug(message, { ...Object.assign({}, ...meta), category })
    },
    verbose: (message: string, ...meta: any[]) => {
      preloadLogger.verbose(message, { ...Object.assign({}, ...meta), category })
    }
  }
}

/**
 * Renderer logger API - exposed to the renderer process
 */
export const rendererLogger = {
  error: (message: string, ...meta: any[]) => {
    sendLogToMain('error', message, { ...Object.assign({}, ...meta), process: 'renderer' })
  },
  warn: (message: string, ...meta: any[]) => {
    sendLogToMain('warn', message, { ...Object.assign({}, ...meta), process: 'renderer' })
  },
  info: (message: string, ...meta: any[]) => {
    sendLogToMain('info', message, { ...Object.assign({}, ...meta), process: 'renderer' })
  },
  debug: (message: string, ...meta: any[]) => {
    sendLogToMain('debug', message, { ...Object.assign({}, ...meta), process: 'renderer' })
  },
  verbose: (message: string, ...meta: any[]) => {
    sendLogToMain('verbose', message, { ...Object.assign({}, ...meta), process: 'renderer' })
  }
}

/**
 * Create a category-specific logger for renderer
 */
export const createRendererCategoryLogger = (category: string) => {
  return {
    error: (message: string, ...meta: any[]) => {
      rendererLogger.error(message, { ...Object.assign({}, ...meta), category })
    },
    warn: (message: string, ...meta: any[]) => {
      rendererLogger.warn(message, { ...Object.assign({}, ...meta), category })
    },
    info: (message: string, ...meta: any[]) => {
      rendererLogger.info(message, { ...Object.assign({}, ...meta), category })
    },
    debug: (message: string, ...meta: any[]) => {
      rendererLogger.debug(message, { ...Object.assign({}, ...meta), category })
    },
    verbose: (message: string, ...meta: any[]) => {
      rendererLogger.verbose(message, { ...Object.assign({}, ...meta), category })
    }
  }
}

export type PreloadLogger = typeof preloadLogger
export type PreloadCategoryLogger = ReturnType<typeof createPreloadCategoryLogger>
export type RendererLogger = typeof rendererLogger
export type RendererCategoryLogger = ReturnType<typeof createRendererCategoryLogger>

// Create and export default logger
export const log = preloadLogger
