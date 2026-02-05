/**
 * Output formatter for Nachos CLI
 * Handles both pretty (human-readable) and JSON output modes
 */

import chalk from 'chalk';
import type { CommandOutput } from './types.js';
import { CLIError } from './errors.js';

export class OutputFormatter {
  private startTime: number;

  constructor(
    private readonly jsonMode: boolean,
    private readonly command: string,
    private readonly version: string,
    private readonly configPath?: string,
  ) {
    this.startTime = Date.now();
  }

  /**
   * Check if JSON mode is enabled
   */
  isJsonMode(): boolean {
    return this.jsonMode;
  }

  /**
   * Output success result
   */
  success<T>(data: T): void {
    if (this.jsonMode) {
      this.outputJson({
        ok: true,
        command: this.command,
        data,
        meta: this.buildMeta(),
      });
    }
    // For pretty mode, commands handle their own output
  }

  /**
   * Output error and exit
   */
  error(error: Error | CLIError): never {
    if (this.jsonMode) {
      const output: CommandOutput = {
        ok: false,
        command: this.command,
        error: {
          code: error instanceof CLIError ? error.code : 'UNKNOWN_ERROR',
          message: error.message,
          details: (error as any).details,
        },
        meta: this.buildMeta(),
      };
      this.outputJson(output);
    } else {
      this.prettyError(error);
    }

    const exitCode = error instanceof CLIError ? error.exitCode : 1;
    process.exit(exitCode);
  }

  /**
   * Pretty-print an error
   */
  private prettyError(error: Error | CLIError): void {
    console.error(chalk.red.bold('✗ Error:'), error.message);

    if (error instanceof CLIError && error.suggestion) {
      console.error();
      console.error(chalk.yellow('Suggestion:'));
      console.error(this.indent(error.suggestion, 2));
    }

    if (process.env.DEBUG) {
      console.error();
      console.error(chalk.dim('Stack trace:'));
      console.error(chalk.dim(error.stack));
    }
  }

  /**
   * Output JSON to stdout
   */
  private outputJson(output: CommandOutput): void {
    console.log(JSON.stringify(output, null, 2));
  }

  /**
   * Build metadata object
   */
  private buildMeta() {
    return {
      timestamp: new Date().toISOString(),
      version: this.version,
      config_path: this.configPath,
      duration_ms: Date.now() - this.startTime,
    };
  }

  /**
   * Indent multi-line text
   */
  private indent(text: string, spaces: number): string {
    const prefix = ' '.repeat(spaces);
    return text
      .split('\n')
      .map((line) => prefix + line)
      .join('\n');
  }
}

/**
 * Helper functions for pretty output
 */
export const prettyOutput = {
  /**
   * Print success message with checkmark
   */
  success(message: string): void {
    console.log(chalk.green('✓'), message);
  },

  /**
   * Print info message
   */
  info(message: string): void {
    console.log(chalk.blue('ℹ'), message);
  },

  /**
   * Print warning message
   */
  warn(message: string): void {
    console.log(chalk.yellow('⚠'), message);
  },

  /**
   * Print section header
   */
  header(message: string): void {
    console.log();
    console.log(chalk.bold(message));
  },

  /**
   * Print branded header with emoji
   */
  brandedHeader(message: string): void {
    console.log();
    console.log(chalk.bold('🧀', message));
  },

  /**
   * Print indented text
   */
  indent(text: string, spaces: number = 2): void {
    const prefix = ' '.repeat(spaces);
    console.log(prefix + text);
  },

  /**
   * Print key-value pair
   */
  keyValue(key: string, value: string, spaces: number = 2): void {
    const prefix = ' '.repeat(spaces);
    console.log(`${prefix}${chalk.cyan(key)}: ${value}`);
  },

  /**
   * Print a blank line
   */
  blank(): void {
    console.log();
  },
};
