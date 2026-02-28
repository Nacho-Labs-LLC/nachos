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
import { appendFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { createValidationError, createPermissionDeniedError } from '@nachos/types';

/**
 * Logger interface (minimal subset needed)
 */
interface Logger {
  info(msg: string): void;
  info(obj: object, msg?: string): void;
  warn(msg: string): void;
  warn(obj: object, msg?: string): void;
  error(msg: string): void;
  error(obj: object, msg?: string): void;
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
  /** Read-only tool (no destructive operations) */
  readonly?: boolean;
  /** Allowed subcommands (for git, docker, etc.) */
  allowedSubcommands?: string[];
  /** Blocked subcommands (explicitly forbidden) */
  blockedSubcommands?: string[];
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
  /** Path to audit log file (default: /var/log/nachos/shell-audit.log) */
  auditLogPath?: string;
  /** Enable audit logging (default: true) */
  enableAuditLog?: boolean;
}

/**
 * Default skill-based CLI tools
 */
const DEFAULT_SKILL_TOOLS: SkillToolConfig[] = [
  // Skill-based tools
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
  
  // File inspection (read-only)
  { bin: 'ls', group: 'file-inspection', readonly: true },
  { bin: 'cat', group: 'file-inspection', readonly: true },
  { bin: 'head', group: 'file-inspection', readonly: true },
  { bin: 'tail', group: 'file-inspection', readonly: true },
  { bin: 'file', group: 'file-inspection', readonly: true },
  { bin: 'stat', group: 'file-inspection', readonly: true },
  { bin: 'wc', group: 'file-inspection', readonly: true },
  { bin: 'find', group: 'file-inspection', readonly: true, defaultTimeout: 60000 },
  
  // Text processing
  { bin: 'grep', group: 'text-processing', readonly: true },
  { bin: 'sed', group: 'text-processing', readonly: true },
  { bin: 'awk', group: 'text-processing', readonly: true },
  { bin: 'cut', group: 'text-processing', readonly: true },
  { bin: 'sort', group: 'text-processing', readonly: true },
  { bin: 'uniq', group: 'text-processing', readonly: true },
  { bin: 'tr', group: 'text-processing', readonly: true },
  { bin: 'diff', group: 'text-processing', readonly: true },
  
  // Process inspection
  { bin: 'ps', group: 'process-inspection', readonly: true },
  { bin: 'pgrep', group: 'process-inspection', readonly: true },
  { bin: 'top', group: 'process-inspection', readonly: true, defaultTimeout: 5000 },
  { bin: 'htop', group: 'process-inspection', readonly: true, defaultTimeout: 5000 },
  
  // Network info (read-only inspection)
  { bin: 'netstat', group: 'network-info', readonly: true },
  { bin: 'ss', group: 'network-info', readonly: true },
  { bin: 'lsof', group: 'network-info', readonly: true },
  { bin: 'ip', group: 'network-info', readonly: true, allowedSubcommands: ['addr', 'route', 'link'] },
  
  // Network debugging
  { bin: 'ping', group: 'network-debug', readonly: true, defaultTimeout: 10000 },
  { bin: 'curl', group: 'network-debug', readonly: true, defaultTimeout: 30000 },
  { bin: 'wget', group: 'network-debug', readonly: true, defaultTimeout: 30000 },
  { bin: 'dig', group: 'network-debug', readonly: true },
  { bin: 'nslookup', group: 'network-debug', readonly: true },
  
  // System info
  { bin: 'uname', group: 'system-info', readonly: true },
  { bin: 'hostname', group: 'system-info', readonly: true },
  { bin: 'whoami', group: 'system-info', readonly: true },
  { bin: 'pwd', group: 'system-info', readonly: true },
  // 'env' removed: can bypass restrictions by launching arbitrary binaries
  { bin: 'date', group: 'system-info', readonly: true },
  { bin: 'uptime', group: 'system-info', readonly: true },
  { bin: 'free', group: 'system-info', readonly: true },
  { bin: 'df', group: 'system-info', readonly: true },
  { bin: 'du', group: 'system-info', readonly: true, defaultTimeout: 60000 },
  
  // Data processing
  { bin: 'jq', group: 'data-processing', readonly: true },
  { bin: 'yq', group: 'data-processing', readonly: true },
  { bin: 'json', group: 'data-processing', readonly: true },
  
  // Git (read-only operations)
  {
    bin: 'git',
    group: 'git',
    readonly: true,
    allowedSubcommands: ['status', 'log', 'diff', 'show', 'branch', 'remote', 'config', 'rev-parse', 'describe'],
    blockedSubcommands: ['push', 'commit', 'add', 'rm', 'reset', 'rebase', 'merge', 'pull', 'fetch', 'clone'],
  },
  
  // Docker (read-only inspection)
  {
    bin: 'docker',
    group: 'docker-inspect',
    readonly: true,
    allowedSubcommands: ['ps', 'logs', 'inspect', 'images', 'stats', 'version', 'info'],
    blockedSubcommands: ['rm', 'rmi', 'stop', 'kill', 'run', 'exec', 'build', 'push', 'pull'],
    defaultTimeout: 30000,
  },
  
  // Archive operations (read-only: list/extract)
  { bin: 'tar', group: 'archive', readonly: true },
  { bin: 'unzip', group: 'archive', readonly: true },
  { bin: 'gunzip', group: 'archive', readonly: true },
  { bin: 'bunzip2', group: 'archive', readonly: true },
];

/**
 * Flags that can cause write operations for tools marked as readonly.
 * When a tool entry has `readonly: true`, any arguments matching these
 * flags will cause the command to be rejected.
 */
const WRITE_FLAGS: Record<string, string[]> = {
  sed: ['-i', '--in-place'],
  find: ['-exec', '-execdir', '-delete', '-fls', '-fprint', '-fprint0', '-fprintf'],
  curl: ['-o', '--output', '-O', '--remote-name', '--create-dirs'],
  wget: ['-O', '--output-document', '-P', '--directory-prefix'],
  tee: ['-a', '--append'], // tee always writes, but flag for completeness
  tar: ['-c', '--create', '-x', '--extract', '-u', '--update', '--delete'],
};

/**
 * Shell tool for executing CLI commands
 */
export class ShellTool {
  private logger: Logger;
  private maxOutputSize: number;
  private defaultTimeout: number;
  private maxTimeout: number;
  private allowedTools: Map<string, SkillToolConfig>;
  private auditLogPath: string;
  private enableAuditLog: boolean;

  constructor(config: ShellToolConfig) {
    this.logger = config.logger;
    this.maxOutputSize = config.maxOutputSize ?? 100 * 1024; // 100KB
    this.defaultTimeout = config.defaultTimeout ?? 30000; // 30s
    this.maxTimeout = config.maxTimeout ?? 300000; // 5min
    this.auditLogPath = config.auditLogPath ?? '/var/log/nachos/shell-audit.log';
    this.enableAuditLog = config.enableAuditLog ?? true;

    // Build allowed tools map
    const tools = config.allowedTools ?? DEFAULT_SKILL_TOOLS;
    this.allowedTools = new Map(tools.map((t) => [t.bin, t]));
  }

  /**
   * Write audit log entry
   */
  private async auditLog(entry: {
    timestamp: number;
    command: string;
    binaries: string[];
    toolGroup: string | undefined;
    exitCode: number | null;
    duration: number;
    timedOut?: boolean;
    truncated?: boolean;
    stdoutLength?: number;
    stderrLength?: number;
    error?: string;
  }): Promise<void> {
    if (!this.enableAuditLog) {
      return;
    }

    try {
      // Ensure directory exists
      const logDir = dirname(this.auditLogPath);
      await mkdir(logDir, { recursive: true });

      // Append JSON line to audit log
      await appendFile(
        this.auditLogPath,
        JSON.stringify(entry) + '\n',
        'utf8'
      );
    } catch (error) {
      // Don't fail command execution if audit log fails
      this.logger.warn({
        error: error instanceof Error ? error.message : String(error),
        auditLogPath: this.auditLogPath,
      }, 'Failed to write audit log');
    }
  }

  /**
   * Execute a command
   */
  async execute(options: ExecOptions): Promise<ExecResult> {
    const timeout = Math.min(options.timeout ?? this.defaultTimeout, this.maxTimeout);
    const startTime = Date.now();

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

    this.logger.info({
      command: options.command,
      binaries: binaries.join(' '),
      toolGroup: this.getToolGroup(options.command),
      timeout,
    }, 'Executing command');

    try {
      const result = await this.spawnProcess({
        ...options,
        timeout,
      });

      // Audit log: successful execution
      this.auditLog({
        timestamp: Date.now(),
        command: options.command,
        binaries,
        toolGroup: this.getToolGroup(options.command),
        exitCode: result.exitCode,
        duration: Date.now() - startTime,
        timedOut: result.timedOut,
        truncated: result.truncated,
        stdoutLength: result.stdout.length,
        stderrLength: result.stderr.length,
      });

      return result;
    } catch (error) {
      // Audit log: failed execution
      this.auditLog({
        timestamp: Date.now(),
        command: options.command,
        binaries,
        toolGroup: this.getToolGroup(options.command),
        exitCode: null,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
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
   * Validate subcommand against allowed/blocked lists
   */
  private validateSubcommand(bin: string, args: string[]): boolean {
    const config = this.allowedTools.get(bin);
    if (!config) return false;

    // If no subcommands configured, allow all args
    if (!config.allowedSubcommands && !config.blockedSubcommands) {
      return true;
    }

    // If no args, nothing to validate
    if (args.length === 0) {
      return true;
    }

    const subcommand = args[0]!;

    // Check blocked list first (explicit deny)
    if (config.blockedSubcommands && config.blockedSubcommands.includes(subcommand)) {
      return false;
    }

    // Check allowed list (explicit allow)
    if (config.allowedSubcommands) {
      return config.allowedSubcommands.includes(subcommand);
    }

    // No allowed list but has blocked list - allow by default
    return true;
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

    // Validate subcommand
    if (!this.validateSubcommand(binary, args)) {
      const config = this.allowedTools.get(binary);
      const subcommand = args[0] ?? '';
      this.logger.warn({ binary, subcommand, args }, 'Blocked subcommand');
      return Promise.resolve({
        exitCode: 1,
        signal: null,
        stdout: '',
        stderr: `Subcommand '${subcommand}' not allowed for '${binary}'. Allowed: ${config?.allowedSubcommands?.join(', ') ?? 'none'}`,
        timedOut: false,
        truncated: false,
        duration: 0,
      });
    }

    // Enforce readonly: reject write-capable flags for readonly tools
    const toolConfig = this.allowedTools.get(binary);
    if (toolConfig?.readonly) {
      const writeFlags = WRITE_FLAGS[binary];
      if (writeFlags) {
        // Extract single-character write flag chars (e.g. 'i' from '-i')
        const shortWriteChars = writeFlags
          .filter((f) => f.startsWith('-') && !f.startsWith('--') && f.length === 2)
          .map((f) => f[1]!);

        const violatingFlag = args.find((arg) => {
          // Exact match: -i, --in-place, -exec, etc.
          if (writeFlags.includes(arg)) return true;
          // Combined short flags: -ni, -ri, -oi etc. — check each char
          if (arg.startsWith('-') && !arg.startsWith('--') && arg.length > 2) {
            return [...arg.slice(1)].some((ch) => shortWriteChars.includes(ch));
          }
          return false;
        });

        if (violatingFlag) {
          this.logger.warn(
            { binary, flag: violatingFlag, args },
            'Blocked write flag on readonly tool'
          );
          return Promise.resolve({
            exitCode: 1,
            signal: null,
            stdout: '',
            stderr: `Flag '${violatingFlag}' not allowed for read-only tool '${binary}'`,
            timedOut: false,
            truncated: false,
            duration: 0,
          });
        }
      }
    }

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
        this.logger.error({ error: error.message }, 'Command execution error');
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

        this.logger.info({
          exitCode,
          signal,
          duration,
          stdoutLength: stdout.length,
          stderrLength: stderr.length,
          timedOut,
          truncated,
        }, 'Command completed');

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
          this.logger.error({ error: error.message }, 'Pipe chain execution error');
          stderr += (stderr ? '\n' : '') + error.message;
        });
      }

      // Wait for last process to exit
      lastChild.on('close', (exitCode, signal) => {
        clearTimeout(timeoutHandle);
        const duration = Date.now() - startTime;

        this.logger.info({
          exitCode,
          signal,
          duration,
          stdoutLength: stdout.length,
          stderrLength: stderr.length,
          timedOut,
          truncated,
          pipeLength: children.length,
        }, 'Pipe chain completed');

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
