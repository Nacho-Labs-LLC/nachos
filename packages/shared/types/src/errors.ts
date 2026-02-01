/**
 * Nachos Error Types and Factory Functions
 *
 * Provides standardized error handling across all Nachos components.
 * All errors include component attribution, correlation IDs, and structured details.
 */

// ============================================================================
// Error Codes
// ============================================================================

/**
 * All Nachos error codes with descriptions
 */
export const NachosErrorCodes = {
  /** Configuration error */
  CONFIG: 'NACHOS_ERR_CONFIG',
  /** Policy denied the requested action */
  POLICY_DENIED: 'NACHOS_ERR_POLICY_DENIED',
  /** Rate limit exceeded */
  RATE_LIMITED: 'NACHOS_ERR_RATE_LIMITED',
  /** LLM request failed */
  LLM_FAILED: 'NACHOS_ERR_LLM_FAILED',
  /** Tool execution failed */
  TOOL_FAILED: 'NACHOS_ERR_TOOL_FAILED',
  /** Channel operation failed */
  CHANNEL_FAILED: 'NACHOS_ERR_CHANNEL_FAILED',
  /** Session not found */
  SESSION_NOT_FOUND: 'NACHOS_ERR_SESSION_NOT_FOUND',
  /** Operation timed out */
  TIMEOUT: 'NACHOS_ERR_TIMEOUT',
  /** Internal error */
  INTERNAL: 'NACHOS_ERR_INTERNAL',
  /** Validation error */
  VALIDATION: 'NACHOS_ERR_VALIDATION',
  /** Message bus connection error */
  BUS_CONNECTION: 'NACHOS_ERR_BUS_CONNECTION',
  /** Message bus publish error */
  BUS_PUBLISH: 'NACHOS_ERR_BUS_PUBLISH',
  /** Message bus subscribe error */
  BUS_SUBSCRIBE: 'NACHOS_ERR_BUS_SUBSCRIBE',
  /** Invalid message format */
  INVALID_MESSAGE: 'NACHOS_ERR_INVALID_MESSAGE',
  /** Authentication failed */
  AUTH_FAILED: 'NACHOS_ERR_AUTH_FAILED',
  /** Permission denied */
  PERMISSION_DENIED: 'NACHOS_ERR_PERMISSION_DENIED',
  /** Resource not found */
  NOT_FOUND: 'NACHOS_ERR_NOT_FOUND',
  /** Resource already exists */
  ALREADY_EXISTS: 'NACHOS_ERR_ALREADY_EXISTS',
  /** Invalid state for operation */
  INVALID_STATE: 'NACHOS_ERR_INVALID_STATE',
} as const;

export type NachosErrorCode = (typeof NachosErrorCodes)[keyof typeof NachosErrorCodes];

// ============================================================================
// Error Interface
// ============================================================================

/**
 * Structured Nachos error
 */
export interface NachosErrorData {
  /** Error code */
  code: NachosErrorCode;
  /** Human-readable error message */
  message: string;
  /** Component that generated the error */
  component: string;
  /** Additional error details */
  details?: Record<string, unknown>;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Correlation ID for tracing */
  correlationId?: string;
  /** Original error if wrapping another error */
  cause?: Error;
}

// ============================================================================
// NachosError Class
// ============================================================================

/**
 * Base error class for all Nachos errors
 * Extends standard Error with additional context for debugging and logging
 */
export class NachosError extends Error {
  /** Error code */
  readonly code: NachosErrorCode;
  /** Component that generated the error */
  readonly component: string;
  /** Additional error details */
  readonly details?: Record<string, unknown>;
  /** ISO 8601 timestamp */
  readonly timestamp: string;
  /** Correlation ID for tracing */
  readonly correlationId?: string;

  constructor(data: NachosErrorData) {
    super(data.message);
    this.name = 'NachosError';
    this.code = data.code;
    this.component = data.component;
    this.details = data.details;
    this.timestamp = data.timestamp;
    this.correlationId = data.correlationId;

    // Maintain proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, NachosError);
    }

    // Preserve the cause if provided
    if (data.cause) {
      this.cause = data.cause;
    }
  }

  /**
   * Convert to a plain object for serialization
   */
  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      message: this.message,
      component: this.component,
      details: this.details,
      timestamp: this.timestamp,
      correlationId: this.correlationId,
    };
  }

  /**
   * Create a string representation
   */
  override toString(): string {
    return `[${this.code}] ${this.message} (component: ${this.component})`;
  }
}

// ============================================================================
// Error Factory Functions
// ============================================================================

/**
 * Options for creating errors
 */
export interface CreateErrorOptions {
  /** Component that generated the error */
  component: string;
  /** Additional error details */
  details?: Record<string, unknown>;
  /** Correlation ID for tracing */
  correlationId?: string;
  /** Original error if wrapping */
  cause?: Error;
}

/**
 * Create a configuration error
 */
export function createConfigError(message: string, options: CreateErrorOptions): NachosError {
  return new NachosError({
    code: NachosErrorCodes.CONFIG,
    message,
    timestamp: new Date().toISOString(),
    ...options,
  });
}

/**
 * Create a policy denied error
 */
export function createPolicyDeniedError(message: string, options: CreateErrorOptions): NachosError {
  return new NachosError({
    code: NachosErrorCodes.POLICY_DENIED,
    message,
    timestamp: new Date().toISOString(),
    ...options,
  });
}

/**
 * Create a rate limited error
 */
export function createRateLimitedError(message: string, options: CreateErrorOptions): NachosError {
  return new NachosError({
    code: NachosErrorCodes.RATE_LIMITED,
    message,
    timestamp: new Date().toISOString(),
    ...options,
  });
}

/**
 * Create an LLM failed error
 */
export function createLLMFailedError(message: string, options: CreateErrorOptions): NachosError {
  return new NachosError({
    code: NachosErrorCodes.LLM_FAILED,
    message,
    timestamp: new Date().toISOString(),
    ...options,
  });
}

/**
 * Create a tool failed error
 */
export function createToolFailedError(message: string, options: CreateErrorOptions): NachosError {
  return new NachosError({
    code: NachosErrorCodes.TOOL_FAILED,
    message,
    timestamp: new Date().toISOString(),
    ...options,
  });
}

/**
 * Create a channel failed error
 */
export function createChannelFailedError(
  message: string,
  options: CreateErrorOptions
): NachosError {
  return new NachosError({
    code: NachosErrorCodes.CHANNEL_FAILED,
    message,
    timestamp: new Date().toISOString(),
    ...options,
  });
}

/**
 * Create a session not found error
 */
export function createSessionNotFoundError(
  message: string,
  options: CreateErrorOptions
): NachosError {
  return new NachosError({
    code: NachosErrorCodes.SESSION_NOT_FOUND,
    message,
    timestamp: new Date().toISOString(),
    ...options,
  });
}

/**
 * Create a timeout error
 */
export function createTimeoutError(message: string, options: CreateErrorOptions): NachosError {
  return new NachosError({
    code: NachosErrorCodes.TIMEOUT,
    message,
    timestamp: new Date().toISOString(),
    ...options,
  });
}

/**
 * Create an internal error
 */
export function createInternalError(message: string, options: CreateErrorOptions): NachosError {
  return new NachosError({
    code: NachosErrorCodes.INTERNAL,
    message,
    timestamp: new Date().toISOString(),
    ...options,
  });
}

/**
 * Create a validation error
 */
export function createValidationError(message: string, options: CreateErrorOptions): NachosError {
  return new NachosError({
    code: NachosErrorCodes.VALIDATION,
    message,
    timestamp: new Date().toISOString(),
    ...options,
  });
}

/**
 * Create a bus connection error
 */
export function createBusConnectionError(
  message: string,
  options: CreateErrorOptions
): NachosError {
  return new NachosError({
    code: NachosErrorCodes.BUS_CONNECTION,
    message,
    timestamp: new Date().toISOString(),
    ...options,
  });
}

/**
 * Create an invalid message error
 */
export function createInvalidMessageError(
  message: string,
  options: CreateErrorOptions
): NachosError {
  return new NachosError({
    code: NachosErrorCodes.INVALID_MESSAGE,
    message,
    timestamp: new Date().toISOString(),
    ...options,
  });
}

/**
 * Create an authentication failed error
 */
export function createAuthFailedError(message: string, options: CreateErrorOptions): NachosError {
  return new NachosError({
    code: NachosErrorCodes.AUTH_FAILED,
    message,
    timestamp: new Date().toISOString(),
    ...options,
  });
}

/**
 * Create a permission denied error
 */
export function createPermissionDeniedError(
  message: string,
  options: CreateErrorOptions
): NachosError {
  return new NachosError({
    code: NachosErrorCodes.PERMISSION_DENIED,
    message,
    timestamp: new Date().toISOString(),
    ...options,
  });
}

/**
 * Create a not found error
 */
export function createNotFoundError(message: string, options: CreateErrorOptions): NachosError {
  return new NachosError({
    code: NachosErrorCodes.NOT_FOUND,
    message,
    timestamp: new Date().toISOString(),
    ...options,
  });
}

/**
 * Create an already exists error
 */
export function createAlreadyExistsError(
  message: string,
  options: CreateErrorOptions
): NachosError {
  return new NachosError({
    code: NachosErrorCodes.ALREADY_EXISTS,
    message,
    timestamp: new Date().toISOString(),
    ...options,
  });
}

/**
 * Create an invalid state error
 */
export function createInvalidStateError(message: string, options: CreateErrorOptions): NachosError {
  return new NachosError({
    code: NachosErrorCodes.INVALID_STATE,
    message,
    timestamp: new Date().toISOString(),
    ...options,
  });
}

// ============================================================================
// Error Utilities
// ============================================================================

/**
 * Check if an error is a NachosError
 */
export function isNachosError(error: unknown): error is NachosError {
  return error instanceof NachosError;
}

/**
 * Check if an error has a specific error code
 */
export function hasErrorCode(error: unknown, code: NachosErrorCode): boolean {
  return isNachosError(error) && error.code === code;
}

/**
 * Wrap any error as a NachosError
 * If already a NachosError, returns as-is. Otherwise wraps as internal error.
 */
export function wrapError(error: unknown, options: CreateErrorOptions): NachosError {
  if (isNachosError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return createInternalError(error.message, {
      ...options,
      cause: error,
    });
  }

  return createInternalError(String(error), options);
}

/**
 * Extract error information suitable for logging
 */
export function extractErrorInfo(error: unknown): Record<string, unknown> {
  if (isNachosError(error)) {
    return error.toJSON();
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: String(error),
  };
}
