/**
 * Unified error classes for tool system
 */

import { ToolErrorType, ToolErrorMetadata } from './types'

/**
 * Base error class for all tool-related errors
 */
export class ToolError extends Error {
  public readonly type: ToolErrorType
  public readonly metadata: ToolErrorMetadata

  constructor(message: string, type: ToolErrorType, metadata: ToolErrorMetadata) {
    super(message)
    this.name = 'ToolError'
    this.type = type
    this.metadata = metadata

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ToolError)
    }
  }

  /**
   * Convert error to JSON format for logging
   */
  toJSON(): Record<string, any> {
    return {
      name: this.name,
      message: this.message,
      type: this.type,
      metadata: this.metadata,
      stack: this.stack
    }
  }

  /**
   * Create a formatted error response
   */
  toResponse(): string {
    return JSON.stringify({
      success: false,
      error: this.message,
      type: this.type,
      ...this.metadata
    })
  }
}

/**
 * Error thrown when tool validation fails
 */
export class ValidationError extends ToolError {
  constructor(message: string, toolName: string, input?: any) {
    super(message, ToolErrorType.VALIDATION, {
      toolName,
      input
    })
    this.name = 'ValidationError'
  }
}

/**
 * Error thrown when tool execution fails
 */
export class ExecutionError extends ToolError {
  constructor(message: string, toolName: string, cause?: Error, additionalData?: any) {
    super(message, ToolErrorType.EXECUTION, {
      toolName,
      cause,
      ...additionalData
    })
    this.name = 'ExecutionError'
  }
}

/**
 * Error thrown when a tool is not found
 */
export class ToolNotFoundError extends ToolError {
  constructor(toolName: string) {
    super('Tool not found.', ToolErrorType.NOT_FOUND, {
      toolName
    })
    this.name = 'ToolNotFoundError'
  }
}

/**
 * Error thrown when permission is denied
 */
export class PermissionDeniedError extends ToolError {
  constructor(detailMessage: string | undefined, toolName: string, operation?: string) {
    super('Tool permission denied.', ToolErrorType.PERMISSION_DENIED, {
      toolName,
      operation,
      detailMessage
    })
    this.name = 'PermissionDeniedError'
  }
}

/**
 * Error thrown when rate limit is exceeded
 */
export class RateLimitError extends ToolError {
  constructor(message: string, toolName: string, suggestedAlternatives?: string[]) {
    super('Tool rate limit exceeded.', ToolErrorType.RATE_LIMIT, {
      toolName,
      suggestedAlternatives,
      detailMessage: message
    })
    this.name = 'RateLimitError'
  }
}

/**
 * Error thrown for network-related issues
 */
export class NetworkError extends ToolError {
  constructor(
    message: string,
    toolName: string,
    url?: string,
    statusCode?: number,
    additionalData?: Record<string, unknown>
  ) {
    super(message, ToolErrorType.NETWORK, {
      toolName,
      url,
      statusCode,
      ...additionalData
    })
    this.name = 'NetworkError'
  }
}

/**
 * Helper function to wrap unknown errors
 */
export function wrapError(error: unknown, toolName: string): ToolError {
  if (error instanceof ToolError) {
    return error
  }

  if (error instanceof Error) {
    // Check for specific error types
    if (error.name === 'ThrottlingException') {
      return new RateLimitError(error.message, toolName)
    }

    return new ExecutionError('Tool execution failed.', toolName, error, {
      causeName: error.name,
      causeMessage: error.message || undefined
    })
  }

  // Handle non-Error objects
  return new ExecutionError('Tool execution failed.', toolName, undefined, {
    originalError: error
  })
}

/**
 * Type guard to check if an error is a ToolError
 */
export function isToolError(error: unknown): error is ToolError {
  return error instanceof ToolError
}

/**
 * Type guard for specific tool error types
 */
export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError
}

export function isExecutionError(error: unknown): error is ExecutionError {
  return error instanceof ExecutionError
}

export function isToolNotFoundError(error: unknown): error is ToolNotFoundError {
  return error instanceof ToolNotFoundError
}

export function isPermissionDeniedError(error: unknown): error is PermissionDeniedError {
  return error instanceof PermissionDeniedError
}

export function isRateLimitError(error: unknown): error is RateLimitError {
  return error instanceof RateLimitError
}

export function isNetworkError(error: unknown): error is NetworkError {
  return error instanceof NetworkError
}
