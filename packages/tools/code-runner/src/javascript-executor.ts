/**
 * JavaScript Code Executor
 *
 * Executes JavaScript (Node.js) code in a sandboxed environment with:
 * - Timeout enforcement
 * - Output size limits
 * - Resource constraints (via Docker)
 * - No network access
 * - SecurityTier: RESTRICTED (requires user approval)
 */

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { ToolService } from '@nachos/tool-base';
import type {
  ToolServiceConfig,
  ToolParameters,
  ToolResult,
  ValidationResult,
  ParameterSchema,
  ContentBlock,
} from '@nachos/types';
import { SecurityTier } from '@nachos/types';
import { OutputFormatter, type ExecutionOutput } from './output-formatter.js';

/**
 * JavaScript executor parameters
 */
interface JavaScriptExecutorParameters extends ToolParameters {
  /** JavaScript code to execute */
  code: string;

  /** Execution timeout in seconds (max 30) */
  timeout?: number;

  /** Working directory for execution (must be within /tmp) */
  workdir?: string;
}

/**
 * JavaScript code executor tool
 */
export class JavaScriptExecutor extends ToolService {
  readonly toolId = 'code_runner_javascript';
  readonly name = 'JavaScript Code Runner';
  readonly description = 'Execute JavaScript (Node.js) code in a sandboxed environment';
  readonly securityTier = SecurityTier.RESTRICTED;

  readonly parameters: ParameterSchema = {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'JavaScript code to execute',
      },
      timeout: {
        type: 'number',
        description: 'Execution timeout in seconds (default: 30, max: 30)',
        default: 30,
        minimum: 1,
        maximum: 30,
      },
      workdir: {
        type: 'string',
        description: 'Working directory (must be within /tmp)',
        default: '/tmp',
      },
    },
    required: ['code'],
  };

  private outputFormatter = new OutputFormatter();
  private maxTimeout = 30; // Maximum timeout in seconds
  private maxMemoryBytes?: number;

  async initialize(config: ToolServiceConfig): Promise<void> {
    console.log('JavaScript executor initialized');

    // Override max timeout from config if provided
    const configuredTimeout =
      (config.limits?.timeout as number | undefined) ??
      (config.config?.executionTimeout as number | undefined) ??
      (config.config?.timeout as number | undefined);
    if (configuredTimeout) {
      this.maxTimeout = Math.min(configuredTimeout, 30);
    }

    const configuredMaxMemory =
      (config.limits?.maxMemory as number | undefined) ??
      (config.config?.max_memory as string | undefined) ??
      (config.config?.maxMemory as string | number | undefined);
    if (configuredMaxMemory !== undefined) {
      this.maxMemoryBytes = this.parseMemorySize(configuredMaxMemory);
    }
  }

  async validate(params: ToolParameters): Promise<ValidationResult> {
    const p = params as JavaScriptExecutorParameters;

    const errors: string[] = [];

    // Validate code
    if (!p.code || typeof p.code !== 'string') {
      errors.push('code parameter is required and must be a string');
    }

    if (p.code && p.code.length === 0) {
      errors.push('code parameter cannot be empty');
    }

    // Validate timeout
    if (p.timeout !== undefined) {
      if (typeof p.timeout !== 'number' || p.timeout < 1 || p.timeout > this.maxTimeout) {
        errors.push(`timeout must be between 1 and ${this.maxTimeout} seconds`);
      }
    }

    // Validate workdir
    if (p.workdir !== undefined) {
      if (typeof p.workdir !== 'string') {
        errors.push('workdir must be a string');
      } else if (!p.workdir.startsWith('/tmp')) {
        errors.push('workdir must be within /tmp');
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  async execute(params: ToolParameters): Promise<ToolResult> {
    const p = params as JavaScriptExecutorParameters;

    const timeout = p.timeout ?? 30;
    const workdir = p.workdir ?? '/tmp';

    try {
      // Create temp file for code
      const scriptPath = await this.createTempScript(p.code, workdir);

      try {
        // Execute JavaScript code
        const executionResult = await this.runSandboxed(scriptPath, timeout, workdir);

        // Format output
        const formatted = this.outputFormatter.format(executionResult);

        // Create content blocks
        const content: ContentBlock[] = [
          {
            type: 'text',
            text: formatted.output || '(no output)',
          },
        ];

        // Add warning if truncated
        if (formatted.truncated) {
          content.push({
            type: 'text',
            text: `\n⚠️ Output was truncated to ${this.outputFormatter.getMaxSize()} bytes`,
          });
        }

        return {
          success: formatted.exitCode === 0,
          content,
          metadata: {
            duration: 0, // Will be set by base class
            exitCode: formatted.exitCode,
            truncated: formatted.truncated,
          },
        };
      } finally {
        // Always cleanup temp file
        await this.cleanupTempScript(scriptPath);
      }
    } catch (error) {
      return {
        success: false,
        content: [],
        error: {
          code: 'EXECUTION_ERROR',
          message: error instanceof Error ? error.message : 'Unknown execution error',
          details: error,
        },
      };
    }
  }

  /**
   * Create temporary script file
   */
  private async createTempScript(code: string, workdir: string): Promise<string> {
    // Ensure workdir exists
    await fs.mkdir(workdir, { recursive: true });

    const scriptPath = path.join(workdir, `script-${randomUUID()}.js`);
    await fs.writeFile(scriptPath, code, 'utf8');

    return scriptPath;
  }

  /**
   * Cleanup temporary script file
   */
  private async cleanupTempScript(scriptPath: string): Promise<void> {
    try {
      await fs.unlink(scriptPath);
    } catch (error) {
      // Ignore cleanup errors
      console.warn(`Failed to cleanup temp file ${scriptPath}:`, error);
    }
  }

  /**
   * Run JavaScript code in sandboxed environment
   */
  private async runSandboxed(
    scriptPath: string,
    timeout: number,
    workdir: string
  ): Promise<ExecutionOutput> {
    return new Promise((resolve, reject) => {
      const timeoutMs = timeout * 1000;

      const command = this.getCommand(scriptPath);
      const args = this.getArgs(scriptPath);

      // Spawn Node.js process with restricted environment
      const proc = spawn(command, args, {
        timeout: timeoutMs,
        cwd: workdir,
        env: {
          PATH: '/usr/local/bin:/usr/bin:/bin',
          NODE_ENV: 'production',
          NODE_OPTIONS: this.buildNodeOptions(), // Suppress warnings + memory cap
        },
        uid: 1000,
        gid: 1000,
      });

      let stdout = '';
      let stderr = '';
      let truncated = false;

      const maxSize = this.outputFormatter.getMaxSize();

      // Capture stdout with size limit
      proc.stdout.on('data', (data: Buffer) => {
        if (stdout.length + data.length > maxSize * 2) {
          // Kill if output exceeds 2x max (20KB)
          truncated = true;
          proc.kill('SIGTERM');
        } else {
          stdout += data.toString();
        }
      });

      // Capture stderr with size limit
      proc.stderr.on('data', (data: Buffer) => {
        if (stderr.length + data.length > maxSize * 2) {
          truncated = true;
          proc.kill('SIGTERM');
        } else {
          stderr += data.toString();
        }
      });

      // Handle process completion
      proc.on('close', (code, signal) => {
        resolve({
          stdout,
          stderr,
          exitCode: code,
          signal: signal ?? null,
          truncated,
        });
      });

      // Handle errors
      proc.on('error', (error) => {
        reject(error);
      });
    });
  }

  private getCommand(_scriptPath: string): string {
    if (this.maxMemoryBytes) {
      return 'sh';
    }
    return 'node';
  }

  private getArgs(scriptPath: string): string[] {
    if (!this.maxMemoryBytes) {
      return [scriptPath];
    }

    const maxKb = Math.max(Math.floor(this.maxMemoryBytes / 1024), 1);
    return ['-lc', `ulimit -v ${maxKb}; node ${scriptPath}`];
  }

  private buildNodeOptions(): string {
    const options: string[] = ['--no-warnings'];

    if (this.maxMemoryBytes) {
      const maxMb = Math.max(Math.floor(this.maxMemoryBytes / (1024 * 1024)), 16);
      options.push(`--max-old-space-size=${maxMb}`);
    }

    return options.join(' ');
  }

  private parseMemorySize(value: string | number): number {
    if (typeof value === 'number') {
      return value;
    }

    const trimmed = value.trim().toLowerCase();
    const match = trimmed.match(/^(\d+(?:\.\d+)?)(b|kb|k|mb|m|gb|g)?$/);
    if (!match) {
      throw new Error(`Invalid memory size: ${value}`);
    }

    const amount = parseFloat(match[1]);
    const unit = match[2] ?? 'b';
    const factor =
      unit === 'b'
        ? 1
        : unit === 'kb' || unit === 'k'
          ? 1024
          : unit === 'mb' || unit === 'm'
            ? 1024 * 1024
            : 1024 * 1024 * 1024;

    return Math.floor(amount * factor);
  }
}
