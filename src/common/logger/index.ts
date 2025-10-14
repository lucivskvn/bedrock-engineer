import { createLogger } from 'winston'
import path from 'path'
import { LogLevel, LoggerConfig, defaultLoggerConfig } from './config'
import { createFileTransport, getLogFilePaths } from './transports/file'
import { createConsoleTransport } from './transports/console'
import { mainLogFormat } from './formatters'
import { prepareLogMetadata, writeConsoleLog } from './utils'

// Current logger configuration instance
let loggerConfig = { ...defaultLoggerConfig }

// Logger instance - will be created when initLogger is called
let logger: ReturnType<typeof createLogger> | null = null

/**
 * Initialize logger configuration with the user data path
 */
export const initLoggerConfig = (userDataPath: string): void => {
  loggerConfig.logDir = path.join(userDataPath, 'logs')
}

/**
 * Create a logger instance with the current configuration
 */
export const createLoggerInstance = () => {
  // Prepare transports based on configuration
  const transports: any[] = []

  if (loggerConfig.fileLogEnabled && loggerConfig.logDir) {
    transports.push(createFileTransport(loggerConfig))
  }

  if (loggerConfig.consoleLogEnabled) {
    transports.push(createConsoleTransport(loggerConfig))
  }

  // Create and return the logger instance
  return createLogger({
    level: loggerConfig.level,
    format: mainLogFormat,
    defaultMeta: { process: 'main' },
    transports
  })
}

/**
 * Initialize the logger with the current configuration
 * @returns The created logger instance
 */
export const initLogger = () => {
  if (!logger) {
    logger = createLoggerInstance()
  }
  return logger
}

/**
 * Update logger configuration and recreate the logger instance
 */
export const updateLoggerConfig = (newConfig: Partial<LoggerConfig>): void => {
  loggerConfig = { ...loggerConfig, ...newConfig }
  if (logger) {
    logger = createLoggerInstance()
  }
}

const emitLog = (
  level: LogLevel,
  message: string,
  meta: unknown[],
  category?: string
) => {
  const sanitizedMeta = prepareLogMetadata(meta, {
    excludeKeys: category ? ['category'] : undefined
  })

  if (logger) {
    const payload: Record<string, unknown> = sanitizedMeta
      ? { ...sanitizedMeta }
      : {}

    if (category) {
      payload.category = category
    }

    logger.log({ level, message, ...payload })
    return
  }

  writeConsoleLog(level, message, sanitizedMeta, category)
}

/**
 * Logger API for direct logging
 */
export const log = {
  error: (message: string, ...meta: unknown[]) => {
    emitLog('error', message, meta)
  },
  warn: (message: string, ...meta: unknown[]) => {
    emitLog('warn', message, meta)
  },
  info: (message: string, ...meta: unknown[]) => {
    emitLog('info', message, meta)
  },
  debug: (message: string, ...meta: unknown[]) => {
    emitLog('debug', message, meta)
  },
  verbose: (message: string, ...meta: unknown[]) => {
    emitLog('verbose', message, meta)
  }
}

/**
 * Create a category-specific logger
 */
export const createCategoryLogger = (category: string) => {
  return {
    error: (message: string, ...meta: unknown[]) => {
      emitLog('error', message, meta, category)
    },
    warn: (message: string, ...meta: unknown[]) => {
      emitLog('warn', message, meta, category)
    },
    info: (message: string, ...meta: unknown[]) => {
      emitLog('info', message, meta, category)
    },
    debug: (message: string, ...meta: unknown[]) => {
      emitLog('debug', message, meta, category)
    },
    verbose: (message: string, ...meta: unknown[]) => {
      emitLog('verbose', message, meta, category)
    }
  }
}

/**
 * Get current logger configuration
 */
export const getLoggerConfig = (): LoggerConfig => {
  return { ...loggerConfig }
}

/**
 * Set log level
 */
export const setLogLevel = (level: LogLevel): void => {
  updateLoggerConfig({ level })
}

/**
 * Get log files paths
 */
export const getLogFiles = (): string[] => {
  return getLogFilePaths(loggerConfig)
}

/**
 * Register global error handlers
 */
export const registerGlobalErrorHandlers = (): void => {
  process.on('uncaughtException', (error) => {
    log.error('Uncaught Exception', { error: error.stack || String(error) })
  })

  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled Promise Rejection', {
      reason: reason instanceof Error ? reason.stack : String(reason)
    })
  })
}
