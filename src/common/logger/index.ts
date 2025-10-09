import { createLogger } from 'winston'
import path from 'path'
import { LogLevel, LoggerConfig, defaultLoggerConfig } from './config'
import { createFileTransport, getLogFilePaths } from './transports/file'
import { createConsoleTransport } from './transports/console'
import { mainLogFormat } from './formatters'

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

/**
 * Logger API for direct logging
 */
export const log = {
  error: (message: string, ...meta: any[]) => {
    if (logger) {
      logger.error(message, ...meta)
    } else {
      console.error(message, ...meta)
    }
  },
  warn: (message: string, ...meta: any[]) => {
    if (logger) {
      logger.warn(message, ...meta)
    } else {
      console.warn(message, ...meta)
    }
  },
  info: (message: string, ...meta: any[]) => {
    if (logger) {
      logger.info(message, ...meta)
    } else {
      console.info(message, ...meta)
    }
  },
  debug: (message: string, ...meta: any[]) => {
    if (logger) {
      logger.debug(message, ...meta)
    } else {
      console.debug(message, ...meta)
    }
  },
  verbose: (message: string, ...meta: any[]) => {
    if (logger) {
      logger.verbose(message, ...meta)
    } else {
      console.log(message, ...meta)
    }
  }
}

/**
 * Create a category-specific logger
 */
export const createCategoryLogger = (category: string) => {
  return {
    error: (message: string, ...meta: any[]) => {
      if (logger) {
        logger.error(message, { ...Object.assign({}, ...meta), category })
      } else {
        console.error(`[${category}] ${message}`, ...meta)
      }
    },
    warn: (message: string, ...meta: any[]) => {
      if (logger) {
        logger.warn(message, { ...Object.assign({}, ...meta), category })
      } else {
        console.warn(`[${category}] ${message}`, ...meta)
      }
    },
    info: (message: string, ...meta: any[]) => {
      if (logger) {
        logger.info(message, { ...Object.assign({}, ...meta), category })
      } else {
        console.info(`[${category}] ${message}`, ...meta)
      }
    },
    debug: (message: string, ...meta: any[]) => {
      if (logger) {
        logger.debug(message, { ...Object.assign({}, ...meta), category })
      } else {
        console.debug(`[${category}] ${message}`, ...meta)
      }
    },
    verbose: (message: string, ...meta: any[]) => {
      if (logger) {
        logger.verbose(message, { ...Object.assign({}, ...meta), category })
      } else {
        console.log(`[${category}] ${message}`, ...meta)
      }
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
