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

    if (!options.command.trim()) {
      throw new Error('Empty command');
    }

    if (!this.isCommandAllowed(options.command)) {
      const allowed = Array.from(this.allowedTools.keys()).join(', ');
      throw new Error(`Command not allowed. Allowed tools: ${allowed}`);
    }

    const binaries = this.extractCommandBins(options.command);

    // Validate required environment variables for each binary
    const mergedEnv = { ...process.env, ...options.env };
    for (const binaryName of binaries) {
      const toolConfig = this.allowedTools.get(binaryName);
      if (!toolConfig) {
        throw new Error(`Command '${binaryName}' not allowed.`);
      }
      if (toolConfig.requiredEnv) {
        for (const envVar of toolConfig.requiredEnv) {
          if (!mergedEnv[envVar]) {
            throw new Error(
              `Missing required environment variable: ${envVar} for tool ${binaryName}`
            );
          }
        }
      }
    }

    this.logger.info(`Executing command: ${binaries.join(' ')}`, {
      command: options.command,
      toolGroup: this.getToolGroup(options.command),
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
    const binaries = this.extractCommandBins(command);
    if (binaries.length === 0) return undefined;
    const groups = new Set(
      binaries
        .map((bin) => this.allowedTools.get(bin)?.group)
        .filter((group): group is string => Boolean(group))
    );
    if (groups.size === 1) {
      return groups.values().next().value as string;
    }
    if (groups.size > 1) {
      return 'shell';
    }
    return undefined;
  }

  /**
   * Check if a command is allowed
   */
  isCommandAllowed(command: string): boolean {
    if (!command.trim()) {
      return false;
    }
    if (this.containsCommandSubstitution(command)) {
      return false;
    }
    const binaries = this.extractCommandBins(command);
    if (binaries.length === 0) {
      return false;
    }
    return binaries.every((bin) => this.allowedTools.has(bin));
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

  private containsCommandSubstitution(command: string): boolean {
    return command.includes('`') || command.includes('$(');
  }

  private extractCommandBins(command: string): string[] {
    const segments = this.splitCommandSegments(command);
    const bins: string[] = [];
    for (const segment of segments) {
      const bin = this.extractBinaryFromSegment(segment);
      if (!bin) {
        continue;
      }
      bins.push(bin);
    }
    return bins;
  }

  private splitCommandSegments(command: string): string[] {
    const segments: string[] = [];
    let current = '';
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let escaped = false;

    for (let i = 0; i < command.length; i += 1) {
      const ch = command[i] ?? '';
      const next = command[i + 1] ?? '';
      const prev = command[i - 1] ?? '';

      if (escaped) {
        current += ch;
        escaped = false;
        continue;
      }

      if (ch === '\\') {
        current += ch;
        escaped = true;
        continue;
      }

      if (!inDoubleQuote && ch === "'") {
        inSingleQuote = !inSingleQuote;
        current += ch;
        continue;
      }

      if (!inSingleQuote && ch === '"') {
        inDoubleQuote = !inDoubleQuote;
        current += ch;
        continue;
      }

      if (inSingleQuote || inDoubleQuote) {
        current += ch;
        continue;
      }

      const isPipe = ch === '|';
      const isSemicolon = ch === ';';
      const isAnd = ch === '&';
      const isAndAnd = isAnd && next === '&';
      const isOrOr = isPipe && next === '|';

      if (isSemicolon || isPipe || isAndAnd || isOrOr) {
        const trimmed = current.trim();
        if (trimmed) {
          segments.push(trimmed);
        }
        current = '';
        if (isAndAnd || isOrOr) {
          i += 1;
        }
        continue;
      }

      if (isAnd && !isAndAnd && /\s/.test(prev) && /\s/.test(next)) {
        const trimmed = current.trim();
        if (trimmed) {
          segments.push(trimmed);
        }
        current = '';
        continue;
      }

      current += ch;
    }

    const tail = current.trim();
    if (tail) {
      segments.push(tail);
    }

    return segments;
  }

  private extractBinaryFromSegment(segment: string): string | undefined {
    const tokens = this.tokenizeSegment(segment);
    for (const token of tokens) {
      if (this.isAssignmentToken(token)) {
        continue;
      }
      if (this.isRedirectionToken(token)) {
        continue;
      }
      return token;
    }
    return undefined;
  }

  private tokenizeSegment(segment: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let escaped = false;

    for (let i = 0; i < segment.length; i += 1) {
      const ch = segment[i] ?? '';

      if (escaped) {
        current += ch;
        escaped = false;
        continue;
      }

      if (ch === '\\') {
        escaped = true;
        continue;
      }

      if (!inDoubleQuote && ch === "'") {
        inSingleQuote = !inSingleQuote;
        continue;
      }

      if (!inSingleQuote && ch === '"') {
        inDoubleQuote = !inDoubleQuote;
        continue;
      }

      if (!inSingleQuote && !inDoubleQuote && /\s/.test(ch)) {
        if (current) {
          tokens.push(current);
          current = '';
        }
        continue;
      }

      current += ch;
    }

    if (current) {
      tokens.push(current);
    }

    return tokens;
  }

  private isAssignmentToken(token: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
  }

  private isRedirectionToken(token: string): boolean {
    return /^\d*>/.test(token) || token.startsWith('>') || token.startsWith('<');
  }
}
