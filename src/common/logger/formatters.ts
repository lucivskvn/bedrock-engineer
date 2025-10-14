import { format } from 'winston'
import { sanitizeMetadataRecord } from './utils'

/**
 * Custom log format that includes timestamp, log level, process, category and message
 */
export const customFormat = format.printf(({ level, message, timestamp, ...metadata }) => {
  const process = metadata.process || 'main'
  const category = metadata.category || 'general'

  // Format additional metadata
  let extraInfo = ''
  if (Object.keys(metadata).length > 0) {
    const metaObj = { ...metadata }
    delete metaObj.process
    delete metaObj.category

    if (Object.keys(metaObj).length > 0) {
      try {
        const sanitizedMetadata = sanitizeMetadataRecord(metaObj)
        if (Object.keys(sanitizedMetadata).length > 0) {
          extraInfo = `\n${JSON.stringify(sanitizedMetadata, null, 2)}`
        }
      } catch {
        extraInfo = `\n[Metadata serialization error]`
      }
    }
  }

  return `${timestamp} [${level}] [${process}:${category}] ${message}${extraInfo}`
})

/**
 * Main log format combining timestamp, error handling, and custom format
 */
export const mainLogFormat = format.combine(
  format.timestamp(),
  format.errors({ stack: true }),
  customFormat
)

/**
 * Console log format with colors for better readability
 */
export const consoleLogFormat = format.combine(format.colorize(), format.timestamp(), customFormat)
