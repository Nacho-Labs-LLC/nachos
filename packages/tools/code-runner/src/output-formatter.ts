/**
 * Output Formatter
 *
 * Formats code execution output with:
 * - Size limits (max 10KB)
 * - Middle truncation (preserve start and end)
 * - Exit code formatting
 */

export interface ExecutionOutput {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  truncated: boolean;
}

export interface FormattedOutput {
  output: string;
  truncated: boolean;
  exitCode: number | null;
}

/**
 * Maximum output size in bytes (10KB)
 */
const MAX_OUTPUT_SIZE = 10 * 1024;

/**
 * Number of bytes to keep from start and end when truncating
 */
const TRUNCATE_KEEP_BYTES = 4 * 1024;

/**
 * Output formatter for code execution results
 */
export class OutputFormatter {
  /**
   * Format execution output with truncation and exit code
   */
  format(execution: ExecutionOutput): FormattedOutput {
    const combined = this.combineOutput(execution.stdout, execution.stderr);
    const { text, truncated } = this.truncateOutput(combined);

    // Add exit code information if non-zero
    let output = text;
    if (execution.exitCode !== null && execution.exitCode !== 0) {
      output += `\n\n[Process exited with code ${execution.exitCode}]`;
    }

    if (execution.signal) {
      output += `\n[Process killed by signal ${execution.signal}]`;
    }

    return {
      output,
      truncated: truncated || execution.truncated,
      exitCode: execution.exitCode,
    };
  }

  /**
   * Combine stdout and stderr into single output
   */
  private combineOutput(stdout: string, stderr: string): string {
    const parts: string[] = [];

    if (stdout.trim()) {
      parts.push(stdout.trim());
    }

    if (stderr.trim()) {
      if (parts.length > 0) {
        parts.push('\n--- stderr ---');
      }
      parts.push(stderr.trim());
    }

    return parts.join('\n');
  }

  /**
   * Truncate output using middle truncation strategy
   * Keeps first and last portions to preserve context
   */
  private truncateOutput(text: string): { text: string; truncated: boolean } {
    if (text.length <= MAX_OUTPUT_SIZE) {
      return { text, truncated: false };
    }

    // Calculate how much to keep from start and end
    const startBytes = TRUNCATE_KEEP_BYTES;
    const endBytes = TRUNCATE_KEEP_BYTES;

    // Extract start and end portions
    const start = text.substring(0, startBytes);
    const end = text.substring(text.length - endBytes);

    // Calculate truncated size
    const truncatedBytes = text.length - (startBytes + endBytes);

    const truncationMessage = `\n\n... [truncated ${this.formatBytes(truncatedBytes)}] ...\n\n`;

    return {
      text: start + truncationMessage + end,
      truncated: true,
    };
  }

  /**
   * Format byte count in human-readable form
   */
  private formatBytes(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} bytes`;
    }

    const kb = bytes / 1024;
    if (kb < 1024) {
      return `${kb.toFixed(1)} KB`;
    }

    const mb = kb / 1024;
    return `${mb.toFixed(1)} MB`;
  }

  /**
   * Check if output would be truncated
   */
  wouldTruncate(text: string): boolean {
    return text.length > MAX_OUTPUT_SIZE;
  }

  /**
   * Get maximum output size
   */
  getMaxSize(): number {
    return MAX_OUTPUT_SIZE;
  }
}
