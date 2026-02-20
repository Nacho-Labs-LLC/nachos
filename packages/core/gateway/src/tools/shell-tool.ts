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
import { createValidationError, createPermissionDeniedError } from '@nachos/types';

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
 * A parsed command segment with its trailing operator
 */
interface CommandSegment {
  command: string;
  operator: '|' | ';' | '&&' | '||' | null;
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
      throw createValidationError('Empty command', { component: 'gateway' });
    }

    if (!this.isCommandAllowed(options.command)) {
      const allowed = Array.from(this.allowedTools.keys()).join(', ');
      throw createPermissionDeniedError(`Command not allowed. Allowed tools: ${allowed}`, { component: 'gateway' });
    }

    const binaries = this.extractCommandBins(options.command);

    // Validate required environment variables for each binary
    const mergedEnv = { ...process.env, ...options.env };
    for (const binaryName of binaries) {
      const toolConfig = this.allowedTools.get(binaryName);
      if (!toolConfig) {
        throw createPermissionDeniedError(`Command '${binaryName}' not allowed.`, { component: 'gateway' });
      }
      if (toolConfig.requiredEnv) {
        for (const envVar of toolConfig.requiredEnv) {
          if (!mergedEnv[envVar]) {
            throw createValidationError(
              `Missing required environment variable: ${envVar} for tool ${binaryName}`,
              { component: 'gateway' }
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
   * Spawn and execute subprocess (shell:false)
   *
   * Handles simple commands, pipe chains, and sequential operators (;, &&, ||)
   * without delegating to a shell process.
   */
  private async spawnProcess(options: ExecOptions): Promise<ExecResult> {
    const segments = this.splitCommandSegments(options.command);

    // Simple command - no operators
    if (segments.length === 1 && segments[0]!.operator === null) {
      return this.spawnSingleProcess(segments[0]!.command, options);
    }

    // Group segments into pipe chains separated by sequential operators
    type PipeGroup = { commands: string[]; operator: CommandSegment['operator'] };
    const groups: PipeGroup[] = [];
    let currentPipe: string[] = [];

    for (const seg of segments) {
      currentPipe.push(seg.command);
      if (seg.operator !== '|') {
        // End of a pipe group (sequential operator or last segment)
        groups.push({ commands: [...currentPipe], operator: seg.operator });
        currentPipe = [];
      }
    }

    // Execute groups sequentially, respecting &&, ||, and ;
    let lastResult: ExecResult | null = null;
    let allStdout = '';
    let allStderr = '';
    const startTime = Date.now();

    for (const group of groups) {
      let result: ExecResult;
      if (group.commands.length === 1) {
        result = await this.spawnSingleProcess(group.commands[0]!, options);
      } else {
        result = await this.executePipeChain(group.commands, options);
      }

      allStdout += result.stdout;
      allStderr += result.stderr;
      lastResult = result;

      // Short-circuit based on operator leading to NEXT group
      if (group.operator === '&&' && result.exitCode !== 0) {
        break;
      }
      if (group.operator === '||' && result.exitCode === 0) {
        break;
      }
      // ';' and null always continue (null = last segment, loop ends)
    }

    return {
      exitCode: lastResult?.exitCode ?? 1,
      signal: lastResult?.signal ?? null,
      stdout: allStdout,
      stderr: allStderr,
      timedOut: lastResult?.timedOut ?? false,
      truncated: lastResult?.truncated ?? false,
      duration: Date.now() - startTime,
    };
  }

  /**
   * Spawn a single command without shell
   */
  private spawnSingleProcess(
    segment: string,
    options: { cwd?: string; env?: Record<string, string>; timeout?: number }
  ): Promise<ExecResult> {
    const tokens = this.tokenizeSegment(segment);
    if (tokens.length === 0) {
      return Promise.resolve({
        exitCode: 1,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        truncated: false,
        duration: 0,
      });
    }

    const binary = tokens[0]!;
    const args = tokens.slice(1);

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...options.env,
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
    };

    return new Promise((resolve) => {
      const startTime = Date.now();
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let truncated = false;

      const child: ChildProcess = spawn(binary, args, {
        shell: false,
        cwd: options.cwd ?? undefined,
        env,
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

  /**
   * Execute a chain of commands connected by pipes (shell:false)
   */
  private executePipeChain(
    commands: string[],
    options: { cwd?: string; env?: Record<string, string>; timeout?: number }
  ): Promise<ExecResult> {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...options.env,
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
    };

    return new Promise((resolve) => {
      const startTime = Date.now();
      const children: ChildProcess[] = [];
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let truncated = false;

      // Spawn all processes in the pipe chain
      for (let i = 0; i < commands.length; i++) {
        const tokens = this.tokenizeSegment(commands[i]!);
        if (tokens.length === 0) continue;

        const child = spawn(tokens[0]!, tokens.slice(1), {
          shell: false,
          cwd: options.cwd ?? undefined,
          env,
        });
        children.push(child);

        // Connect pipes: previous stdout -> current stdin
        if (i > 0 && children[i - 1]?.stdout) {
          children[i - 1]!.stdout!.pipe(child.stdin!);
        }
      }

      if (children.length === 0) {
        resolve({
          exitCode: 1,
          signal: null,
          stdout: '',
          stderr: '',
          timedOut: false,
          truncated: false,
          duration: 0,
        });
        return;
      }

      const lastChild = children[children.length - 1]!;

      // Set up timeout for the entire chain
      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        for (const child of children) {
          child.kill('SIGTERM');
        }
        setTimeout(() => {
          for (const child of children) {
            if (child.exitCode === null) {
              child.kill('SIGKILL');
            }
          }
        }, 5000);
      }, options.timeout ?? this.defaultTimeout);

      // Capture stdout from last process only
      lastChild.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8');
        if (stdout.length + text.length > this.maxOutputSize) {
          truncated = true;
          const remaining = this.maxOutputSize - stdout.length;
          if (remaining > 0) {
            stdout += text.substring(0, remaining);
          }
          for (const child of children) {
            child.kill('SIGTERM');
          }
        } else {
          stdout += text;
        }
      });

      // Collect stderr from all processes
      for (const child of children) {
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
      }

      // Handle errors on any child
      for (const child of children) {
        child.on('error', (error) => {
          this.logger.error('Pipe chain execution error:', error);
          stderr += (stderr ? '\n' : '') + error.message;
        });
      }

      // Wait for last process to exit
      lastChild.on('close', (exitCode, signal) => {
        clearTimeout(timeoutHandle);
        const duration = Date.now() - startTime;

        this.logger.info('Pipe chain completed', {
          exitCode,
          signal,
          duration,
          stdoutLength: stdout.length,
          stderrLength: stderr.length,
          timedOut,
          truncated,
          pipeLength: children.length,
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
    return /`|\$\(|\$\{|<\(|>\(|<</.test(command);
  }

  private extractCommandBins(command: string): string[] {
    const segments = this.splitCommandSegments(command);
    const bins: string[] = [];
    for (const segment of segments) {
      const bin = this.extractBinaryFromSegment(segment.command);
      if (!bin) {
        continue;
      }
      bins.push(bin);
    }
    return bins;
  }

  private splitCommandSegments(command: string): CommandSegment[] {
    const segments: CommandSegment[] = [];
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
        let operator: CommandSegment['operator'];
        if (isOrOr) {
          operator = '||';
        } else if (isAndAnd) {
          operator = '&&';
        } else if (isSemicolon) {
          operator = ';';
        } else {
          operator = '|';
        }
        if (trimmed) {
          segments.push({ command: trimmed, operator });
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
          segments.push({ command: trimmed, operator: ';' });
        }
        current = '';
        continue;
      }

      current += ch;
    }

    const tail = current.trim();
    if (tail) {
      segments.push({ command: tail, operator: null });
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
