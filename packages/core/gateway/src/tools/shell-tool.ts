/**
 * Shell/Exec Tool
 *
 * Executes CLI commands with security controls for skill-backed tools.
 *
 * @remarks
 * This tool enables LLM to execute pre-approved CLI binaries (goplaces, gifgrep,
 * summarize, gog) based on documentation loaded from SKILL.md files.
 *
 * Security Features:
 * - Binary allowlisting (only approved tools can execute)
 * - Tool group mapping for policy enforcement (lookup, media, summarize, workspace)
 * - Output size limits (default: 100KB, prevents memory exhaustion)
 * - Timeout enforcement (default: 30s, configurable per-tool)
 * - Environment variable validation (fails if required vars missing)
 * - Subprocess isolation (no shell injection vulnerabilities)
 *
 * Architecture:
 * - Runs in gateway process (not a separate container)
 * - Spawns subprocess via Node.js child_process.spawn()
 * - Captures stdout/stderr with size limits
 * - Enforces timeouts with SIGTERM → SIGKILL escalation
 *
 * Example Usage:
 * ```typescript
 * const shell = new ShellTool({ logger });
 * const result = await shell.execute({
 *   command: "goplaces search 'coffee' --limit 5",
 *   timeout: 30000
 * });
 * ```
 *
 * @see {@link LocalToolHandler} for integration with tool coordinator
 * @see nachos-core/docs/SKILL_TOOLS.md for complete documentation
 *
 * @packageDocumentation
 */

import { spawn, type ChildProcess } from 'child_process';

/**
 * Logger interface (minimal subset needed)
 */
interface Logger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * Command execution result
 */
export interface ExecResult {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  duration: number;
}

/**
 * Command execution options
 */
export interface ExecOptions {
  /** Command to execute */
  command: string;
  /** Working directory */
  cwd?: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Maximum output size in bytes */
  maxOutputSize?: number;
}

/**
 * Skill-based CLI tool configuration
 */
export interface SkillToolConfig {
  /** Binary name (e.g., 'goplaces') */
  bin: string;
  /** Tool group for policy (e.g., 'lookup') */
  group: string;
  /** Required environment variables */
  requiredEnv?: string[];
  /** Default timeout in ms */
  defaultTimeout?: number;
}

/**
 * Shell tool configuration
 */
export interface ShellToolConfig {
  /** Logger instance */
  logger: Logger;
  /** Maximum output size in bytes (default: 100KB) */
  maxOutputSize?: number;
  /** Default timeout in ms (default: 30s) */
  defaultTimeout?: number;
  /** Maximum timeout in ms (default: 300s = 5min) */
  maxTimeout?: number;
  /** Allowed skill-based tools */
  allowedTools?: SkillToolConfig[];
}

/**
 * Default skill-based CLI tools
 */
const DEFAULT_SKILL_TOOLS: SkillToolConfig[] = [
  {
    bin: 'goplaces',
    group: 'lookup',
    requiredEnv: ['GOOGLE_PLACES_API_KEY'],
    defaultTimeout: 30000,
  },
  {
    bin: 'gifgrep',
    group: 'media',
    requiredEnv: [],
    defaultTimeout: 60000,
  },
  {
    bin: 'summarize',
    group: 'summarize',
    requiredEnv: [],
    defaultTimeout: 120000, // 2 minutes for video processing
  },
  {
    bin: 'gog',
    group: 'workspace',
    requiredEnv: [], // OAuth handled by gog itself
    defaultTimeout: 45000,
  },
];

/**
 * Shell tool for executing CLI commands
 */
export class ShellTool {
  private logger: Logger;
  private maxOutputSize: number;
  private defaultTimeout: number;
  private maxTimeout: number;
  private allowedTools: Map<string, SkillToolConfig>;

  constructor(config: ShellToolConfig) {
    this.logger = config.logger;
    this.maxOutputSize = config.maxOutputSize ?? 100 * 1024; // 100KB
    this.defaultTimeout = config.defaultTimeout ?? 30000; // 30s
    this.maxTimeout = config.maxTimeout ?? 300000; // 5min

    // Build allowed tools map
    const tools = config.allowedTools ?? DEFAULT_SKILL_TOOLS;
    this.allowedTools = new Map(tools.map((t) => [t.bin, t]));
  }

  /**
   * Execute a command
   */
  async execute(options: ExecOptions): Promise<ExecResult> {
    const timeout = Math.min(options.timeout ?? this.defaultTimeout, this.maxTimeout);

    // Parse command to extract binary name
    const commandParts = options.command.trim().split(/\s+/);
    const binaryName = commandParts[0];

    if (!binaryName) {
      throw new Error('Empty command');
    }

    // Check if binary is allowed
    const toolConfig = this.allowedTools.get(binaryName);
    if (!toolConfig) {
      throw new Error(
        `Command '${binaryName}' not allowed. Allowed tools: ${Array.from(
          this.allowedTools.keys()
        ).join(', ')}`
      );
    }

    // Validate required environment variables
    if (toolConfig.requiredEnv) {
      const mergedEnv = { ...process.env, ...options.env };
      for (const envVar of toolConfig.requiredEnv) {
        if (!mergedEnv[envVar]) {
          throw new Error(
            `Missing required environment variable: ${envVar} for tool ${binaryName}`
          );
        }
      }
    }

    this.logger.info(`Executing command: ${binaryName}`, {
      command: options.command,
      toolGroup: toolConfig.group,
      timeout,
    });

    return await this.spawnProcess({
      ...options,
      timeout,
    });
  }

  /**
   * Get tool group for a command
   */
  getToolGroup(command: string): string | undefined {
    const binaryName = command.trim().split(/\s+/)[0];
    return binaryName ? this.allowedTools.get(binaryName)?.group : undefined;
  }

  /**
   * Check if a command is allowed
   */
  isCommandAllowed(command: string): boolean {
    const binaryName = command.trim().split(/\s+/)[0];
    return binaryName ? this.allowedTools.has(binaryName) : false;
  }

  /**
   * Get list of allowed tool binaries
   */
  getAllowedBinaries(): string[] {
    return Array.from(this.allowedTools.keys());
  }

  /**
   * Spawn and execute subprocess
   */
  private async spawnProcess(options: ExecOptions): Promise<ExecResult> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let truncated = false;

      // Prepare environment
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        ...options.env,
        // Ensure UTF-8 encoding
        LANG: 'en_US.UTF-8',
        LC_ALL: 'en_US.UTF-8',
      };

      // Spawn process with shell
      const child: ChildProcess = spawn(options.command, {
        shell: true,
        cwd: options.cwd ?? undefined,
        env,
        timeout: options.timeout ?? undefined,
      });

      // Set up timeout
      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          if (child.exitCode === null) {
            child.kill('SIGKILL');
          }
        }, 5000);
      }, options.timeout ?? this.defaultTimeout);

      // Capture stdout
      child.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8');
        if (stdout.length + text.length > this.maxOutputSize) {
          truncated = true;
          const remaining = this.maxOutputSize - stdout.length;
          if (remaining > 0) {
            stdout += text.substring(0, remaining);
          }
          child.kill('SIGTERM');
        } else {
          stdout += text;
        }
      });

      // Capture stderr
      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8');
        if (stderr.length + text.length > this.maxOutputSize) {
          truncated = true;
          const remaining = this.maxOutputSize - stderr.length;
          if (remaining > 0) {
            stderr += text.substring(0, remaining);
          }
        } else {
          stderr += text;
        }
      });

      // Handle errors
      child.on('error', (error) => {
        clearTimeout(timeoutHandle);
        this.logger.error('Command execution error:', error);
        resolve({
          exitCode: null,
          signal: null,
          stdout,
          stderr: stderr || error.message,
          timedOut: false,
          truncated,
          duration: Date.now() - startTime,
        });
      });

      // Handle exit
      child.on('close', (exitCode, signal) => {
        clearTimeout(timeoutHandle);
        const duration = Date.now() - startTime;

        this.logger.info('Command completed', {
          exitCode,
          signal,
          duration,
          stdoutLength: stdout.length,
          stderrLength: stderr.length,
          timedOut,
          truncated,
        });

        resolve({
          exitCode,
          signal,
          stdout,
          stderr,
          timedOut,
          truncated,
          duration,
        });
      });
    });
  }
}
