/**
 * Tool Error Handler
 *
 * Handles tool execution errors with:
 * - Retry logic for transient failures
 * - Fallback mechanisms
 * - User-friendly error reporting
 */

import type { ToolCall, ToolResult, RecoveryResult } from '@nachos/types';

/**
 * Error categories for classification
 */
export type ErrorCategory =
  | 'transient' // Temporary errors that may succeed on retry
  | 'configuration' // Configuration or setup errors
  | 'validation' // Parameter validation errors
  | 'authorization' // Permission or policy errors
  | 'resource' // Resource not found or unavailable
  | 'fatal'; // Unrecoverable errors

/**
 * Retry configuration
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxRetries: number;

  /** Initial backoff delay in milliseconds */
  initialBackoff: number;

  /** Backoff multiplier for exponential backoff */
  backoffMultiplier: number;

  /** Maximum backoff delay in milliseconds */
  maxBackoff: number;
}

/**
 * Default retry configuration
 */
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialBackoff: 1000, // 1 second
  backoffMultiplier: 2,
  maxBackoff: 10000, // 10 seconds
};

/**
 * Tool error handler
 */
export class ToolErrorHandler {
  private retryConfig: RetryConfig;

  constructor(retryConfig: Partial<RetryConfig> = {}) {
    this.retryConfig = {
      ...DEFAULT_RETRY_CONFIG,
      ...retryConfig,
    };
  }

  /**
   * Handle a tool execution error and determine recovery action
   */
  async handleError(call: ToolCall, error: ToolResult): Promise<RecoveryResult> {
    const category = this.categorizeError(error);

    switch (category) {
      case 'transient':
        return this.handleTransientError(call, error);

      case 'configuration':
        return this.handleConfigurationError(call, error);

      case 'validation':
        return this.handleValidationError(call, error);

      case 'authorization':
        return this.handleAuthorizationError(call, error);

      case 'resource':
        return this.handleResourceError(call, error);

      case 'fatal':
      default:
        return this.handleFatalError(call, error);
    }
  }

  /**
   * Execute a tool call with automatic retry on transient failures
   */
  async executeWithRetry(
    call: ToolCall,
    executor: (call: ToolCall) => Promise<ToolResult>
  ): Promise<ToolResult> {
    let lastError: ToolResult | null = null;
    let backoff = this.retryConfig.initialBackoff;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        const result = await executor(call);

        // If successful, return immediately
        if (result.success) {
          return result;
        }

        // If error is not retriable, return immediately
        const category = this.categorizeError(result);
        if (category !== 'transient') {
          return result;
        }

        lastError = result;

        // If this was the last attempt, return the error
        if (attempt === this.retryConfig.maxRetries) {
          break;
        }

        // Wait before retrying
        await this.sleep(backoff);

        // Exponential backoff
        backoff = Math.min(
          backoff * this.retryConfig.backoffMultiplier,
          this.retryConfig.maxBackoff
        );
      } catch (error) {
        // Unexpected error, wrap it
        lastError = {
          success: false,
          content: [],
          error: {
            code: 'UNEXPECTED_ERROR',
            message: error instanceof Error ? error.message : 'Unknown error',
            details: error,
          },
        };

        // Don't retry unexpected errors
        break;
      }
    }

    // All retries exhausted or non-retriable error
    return (
      lastError ?? {
        success: false,
        content: [],
        error: {
          code: 'UNKNOWN_ERROR',
          message: 'Unknown error occurred',
        },
      }
    );
  }

  /**
   * Categorize an error for appropriate handling
   */
  private categorizeError(error: ToolResult): ErrorCategory {
    if (!error.error) {
      return 'fatal';
    }

    const code = error.error.code.toUpperCase();

    // Transient errors (retriable)
    if (
      code.includes('TIMEOUT') ||
      code.includes('CONNECTION') ||
      code.includes('RATE_LIMIT') ||
      code === 'TOOL_NOT_AVAILABLE' ||
      code === 'NO_SPACE'
    ) {
      return 'transient';
    }

    // Configuration errors
    if (
      code.includes('CONFIG') ||
      code.includes('INITIALIZATION') ||
      code.includes('SETUP')
    ) {
      return 'configuration';
    }

    // Validation errors
    if (code.includes('VALIDATION') || code.includes('INVALID')) {
      return 'validation';
    }

    // Authorization errors
    if (
      code.includes('POLICY') ||
      code.includes('PERMISSION') ||
      code.includes('AUTHORIZATION') ||
      code.includes('DENIED')
    ) {
      return 'authorization';
    }

    // Resource errors
    if (
      code.includes('NOT_FOUND') ||
      code.includes('ENOENT') ||
      code.includes('MISSING')
    ) {
      return 'resource';
    }

    // Default to fatal
    return 'fatal';
  }

  /**
   * Handle transient errors (retry)
   */
  private handleTransientError(_call: ToolCall, _error: ToolResult): RecoveryResult {
    return {
      action: 'retry',
      maxRetries: this.retryConfig.maxRetries,
      backoff: this.retryConfig.initialBackoff,
    };
  }

  /**
   * Handle configuration errors (report)
   */
  private handleConfigurationError(
    call: ToolCall,
    error: ToolResult
  ): RecoveryResult {
    return {
      action: 'report',
      message: this.formatUserMessage(
        call,
        error,
        '⚙️ Configuration Error',
        'Please check the tool configuration and try again.'
      ),
    };
  }

  /**
   * Handle validation errors (report)
   */
  private handleValidationError(call: ToolCall, error: ToolResult): RecoveryResult {
    return {
      action: 'report',
      message: this.formatUserMessage(
        call,
        error,
        '❌ Validation Error',
        'Please check the parameters and try again.'
      ),
    };
  }

  /**
   * Handle authorization errors (report)
   */
  private handleAuthorizationError(
    call: ToolCall,
    error: ToolResult
  ): RecoveryResult {
    return {
      action: 'report',
      message: this.formatUserMessage(
        call,
        error,
        '🔒 Authorization Error',
        'This operation requires additional permissions.'
      ),
    };
  }

  /**
   * Handle resource errors (report with suggestion)
   */
  private handleResourceError(call: ToolCall, error: ToolResult): RecoveryResult {
    return {
      action: 'report',
      message: this.formatUserMessage(
        call,
        error,
        '📁 Resource Not Found',
        'The requested resource could not be found. Please verify the path or identifier.'
      ),
    };
  }

  /**
   * Handle fatal errors (report)
   */
  private handleFatalError(call: ToolCall, error: ToolResult): RecoveryResult {
    return {
      action: 'report',
      message: this.formatUserMessage(
        call,
        error,
        '💥 Error',
        'An unexpected error occurred.'
      ),
    };
  }

  /**
   * Format a user-friendly error message
   */
  private formatUserMessage(
    call: ToolCall,
    error: ToolResult,
    title: string,
    hint: string
  ): string {
    const parts = [
      title,
      '',
      `**Tool**: ${call.tool}`,
      `**Error**: ${error.error?.message ?? 'Unknown error'}`,
    ];

    if (error.error?.code) {
      parts.push(`**Code**: ${error.error.code}`);
    }

    parts.push('', hint);

    return parts.join('\n');
  }

  /**
   * Check if an error is retriable
   */
  isRetriable(error: ToolResult): boolean {
    const category = this.categorizeError(error);
    return category === 'transient';
  }

  /**
   * Get recommended retry delay for an error
   */
  getRetryDelay(error: ToolResult, attempt: number): number {
    // Extract retry-after from error if available
    if (error.error?.details && typeof error.error.details === 'object') {
      const details = error.error.details as Record<string, unknown>;
      if (typeof details.retryAfterSeconds === 'number') {
        return details.retryAfterSeconds * 1000;
      }
    }

    // Calculate exponential backoff
    const backoff = this.retryConfig.initialBackoff * Math.pow(
      this.retryConfig.backoffMultiplier,
      attempt
    );

    return Math.min(backoff, this.retryConfig.maxBackoff);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Create a summary of errors from multiple tool calls
   */
  summarizeErrors(results: Array<{ call: ToolCall; result: ToolResult }>): string {
    const errors = results.filter((r) => !r.result.success);

    if (errors.length === 0) {
      return 'All operations completed successfully.';
    }

    const summary = [
      `❌ ${errors.length} operation(s) failed:`,
      '',
    ];

    for (const { call, result } of errors) {
      summary.push(
        `• **${call.tool}**: ${result.error?.message ?? 'Unknown error'}`
      );
    }

    return summary.join('\n');
  }
}
