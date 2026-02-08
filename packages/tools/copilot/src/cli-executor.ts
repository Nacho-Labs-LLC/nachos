/**
 * CLI Executor for GitHub Copilot CLI Tool
 *
 * Handles subprocess execution of GitHub Copilot CLI with:
 * - Output size limits
 * - Timeout enforcement
 * - Safe environment configuration
 * - Authentication checking
 */

import { spawn } from 'child_process';
import type { CopilotMode, ExecutionResult, ExecuteOptions } from './types.js';

/**
 * Logger interface (minimal subset needed)
 */
interface Logger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * Configuration for CLIExecutor
 */
export interface CLIExecutorConfig {
  /** Maximum output size in bytes (default: 50KB) */
  maxOutputSize: number;

  /** Logger instance */
  logger: Logger;
}

/**
 * Executes GitHub Copilot CLI commands with safety guardrails
 */
export class CLIExecutor {
  private maxOutputSize: number;
  private logger: Logger;
  private promptArgMode: 'flag' | 'positional' | null = null;

  constructor(config: CLIExecutorConfig) {
    this.maxOutputSize = config.maxOutputSize;
    this.logger = config.logger;
  }

  /**
   * Check if GitHub CLI and Copilot extension are available
   */
  async checkAvailability(): Promise<boolean> {
    try {
      // Check gh CLI
      const ghCheck = await this.executeCommand('gh', ['--version'], 5000);
      if (ghCheck.exitCode !== 0) {
        this.logger.warn('GitHub CLI not found');
        return false;
      }

      // Check copilot extension
      const copilotCheck = await this.executeCommand('gh', ['extension', 'list'], 5000);

      if (copilotCheck.exitCode === 0 && copilotCheck.stdout.includes('gh-copilot')) {
        return true;
      }

      this.logger.warn('GitHub Copilot CLI extension not found');
      return false;
    } catch (error) {
      this.logger.error('Error checking CLI availability:', error);
      return false;
    }
  }

  /**
   * Get CLI version
   */
  async getVersion(): Promise<string> {
    try {
      const result = await this.executeCommand('gh', ['copilot', '--version'], 5000);
      return result.stdout.trim() || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Check GitHub authentication status
   */
  async checkAuthentication(): Promise<{
    authenticated: boolean;
    error?: string;
  }> {
    try {
      const result = await this.executeCommand('gh', ['auth', 'status'], 5000);

      if (result.exitCode !== 0) {
        return {
          authenticated: false,
          error: 'GitHub CLI not authenticated. Run: gh auth login',
        };
      }

      return { authenticated: true };
    } catch (error) {
      return {
        authenticated: false,
        error: error instanceof Error ? error.message : 'Auth check failed',
      };
    }
  }

  /**
   * Execute Copilot CLI command
   */
  async execute(options: ExecuteOptions): Promise<ExecutionResult> {
    const { prompt, mode, timeout } = options;

    // Build command arguments based on mode
    const args = await this.buildCommandArgs(prompt, mode);
    // Execute with limits
    return await this.executeWithLimits('gh', args, timeout);
  }

  /**
   * Build command arguments for different modes
   */
  private async buildCommandArgs(prompt: string, mode: CopilotMode): Promise<string[]> {
    const promptArgMode = await this.resolvePromptArgumentMode();

    const promptArgs = promptArgMode === 'flag' ? ['--prompt', prompt] : [prompt];

    switch (mode) {
      case 'explain':
        return ['copilot', 'explain', ...promptArgs];

      case 'suggest':
        return ['copilot', 'suggest', ...promptArgs];

      case 'review':
        return ['copilot', 'review', ...promptArgs];

      case 'general':
      default:
        return ['copilot', 'suggest', ...promptArgs];
    }
  }

  private async resolvePromptArgumentMode(): Promise<'flag' | 'positional'> {
    if (this.promptArgMode) {
      return this.promptArgMode;
    }

    try {
      const help = await this.executeCommand('gh', ['copilot', 'suggest', '--help'], 5000);

      if (help.exitCode === 0) {
        const output = `${help.stdout}\n${help.stderr}`;
        if (output.includes('--prompt') || output.includes('-p, --prompt')) {
          this.promptArgMode = 'flag';
          return this.promptArgMode;
        }
      }
    } catch (error) {
      this.logger.warn('Unable to detect copilot prompt flag support:', error);
    }

    this.promptArgMode = 'positional';
    return this.promptArgMode;
  }

  /**
   * Execute command with output size limits and timeout
   */
  private async executeWithLimits(
    command: string,
    args: string[],
    timeoutMs: number
  ): Promise<ExecutionResult> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, {
        env: this.getSafeEnvironment(),
        cwd: '/tmp',
      });

      let stdout = '';
      let stderr = '';
      let truncated = false;
      let timedOut = false;

      const timeout = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGTERM');
      }, timeoutMs);

      // Capture stdout with size limit
      proc.stdout.on('data', (data: Buffer) => {
        if (stdout.length + data.length > this.maxOutputSize) {
          truncated = true;
          proc.kill('SIGTERM');
        } else {
          stdout += data.toString();
        }
      });

      // Capture stderr with size limit
      proc.stderr.on('data', (data: Buffer) => {
        if (stderr.length + data.length > this.maxOutputSize) {
          truncated = true;
          proc.kill('SIGTERM');
        } else {
          stderr += data.toString();
        }
      });

      proc.on('close', (code, signal) => {
        clearTimeout(timeout);
        resolve({
          stdout,
          stderr,
          exitCode: code ?? -1,
          signal: signal ?? undefined,
          truncated,
          timedOut,
        });
      });

      proc.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  /**
   * Execute simple command for checks
   */
  private async executeCommand(
    command: string,
    args: string[],
    timeoutMs: number
  ): Promise<ExecutionResult> {
    return this.executeWithLimits(command, args, timeoutMs);
  }

  /**
   * Get safe environment variables
   */
  private getSafeEnvironment(): NodeJS.ProcessEnv {
    return {
      PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
      HOME: process.env.HOME ?? '/tmp',
      NO_COLOR: '1', // Disable color output for cleaner parsing
      GH_TOKEN: process.env.GH_TOKEN, // Optional token override
    };
  }
}
