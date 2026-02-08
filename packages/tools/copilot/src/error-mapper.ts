/**
 * Error Code Mapper for GitHub Copilot CLI Tool
 *
 * Maps CLI exit codes and stderr messages to structured error responses
 */

/**
 * Standard error codes for the Copilot tool
 */
export const ERROR_CODES = {
  CLI_NOT_FOUND: 'CLI_NOT_FOUND',
  CLI_NOT_AUTHENTICATED: 'CLI_NOT_AUTHENTICATED',
  TIMEOUT: 'TIMEOUT',
  RATE_LIMIT: 'RATE_LIMIT',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  SENSITIVE_DATA_DETECTED: 'SENSITIVE_DATA_DETECTED',
  OUTPUT_TOO_LARGE: 'OUTPUT_TOO_LARGE',
  EXECUTION_ERROR: 'EXECUTION_ERROR',
} as const;

/**
 * Error information with code and message
 */
export interface ErrorInfo {
  code: string;
  message: string;
}

/**
 * Map CLI execution errors to structured error codes and messages
 */
export function mapCLIError(exitCode: number, stderr: string, signal?: string): ErrorInfo {
  // Timeout (killed by SIGTERM)
  if (signal === 'SIGTERM') {
    return {
      code: ERROR_CODES.TIMEOUT,
      message: 'GitHub Copilot CLI execution timed out',
    };
  }

  // Authentication errors (gh CLI exit code 4 or auth-related stderr)
  if (exitCode === 4 || stderr.includes('not logged in') || stderr.includes('authentication')) {
    return {
      code: ERROR_CODES.CLI_NOT_AUTHENTICATED,
      message: 'GitHub CLI not authenticated. Run: gh auth login',
    };
  }

  // Rate limit errors
  if (
    stderr.includes('rate limit') ||
    stderr.includes('429') ||
    stderr.includes('too many requests')
  ) {
    return {
      code: ERROR_CODES.RATE_LIMIT,
      message: 'GitHub API rate limit exceeded. Try again later.',
    };
  }

  // Network errors
  if (stderr.includes('network') || stderr.includes('connection') || stderr.includes('timeout')) {
    return {
      code: ERROR_CODES.EXECUTION_ERROR,
      message: 'Network error connecting to GitHub API',
    };
  }

  // Extension not installed
  if (stderr.includes('extension') || stderr.includes('not found')) {
    return {
      code: ERROR_CODES.CLI_NOT_FOUND,
      message:
        'GitHub Copilot CLI extension not installed. Run: gh extension install github/gh-copilot',
    };
  }

  // Generic error with stderr content
  return {
    code: ERROR_CODES.EXECUTION_ERROR,
    message: stderr.trim() || `Command failed with exit code ${exitCode}`,
  };
}
