/**
 * AgentProcessRegistry — tracks spawned Claude Code CLI subprocesses.
 *
 * Each agent process runs `claude -p <task> --output-format stream-json`
 * as a child process with configurable timeout, output buffering, and
 * concurrency limits.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createLogger } from '@nachos/types';

const logger = createLogger('agent-process-registry');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentProcess {
  id: string;
  task: string;
  cwd: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout';
  pid?: number;
  stdout: string;
  stderr: string;
  startedAt: number;
  completedAt?: number;
  exitCode?: number | null;
}

export interface AgentProcessRegistryConfig {
  maxConcurrent?: number;
  defaultTimeoutMs?: number;
  maxTimeoutMs?: number;
  maxOutputBuffer?: number;
}

interface TrackedProcess {
  record: AgentProcess;
  child: ChildProcess | null;
  timeoutTimer: ReturnType<typeof setTimeout> | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_CONCURRENT = 2;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const MAX_OUTPUT_BUFFER = 512 * 1024; // 500KB
const CLEANUP_AGE_MS = 60 * 60 * 1000; // 1 hour
const SIGKILL_DELAY_MS = 5000;

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class AgentProcessRegistry {
  private processes: Map<string, TrackedProcess> = new Map();
  private maxConcurrent: number;
  private defaultTimeoutMs: number;
  private maxTimeoutMs: number;
  private maxOutputBuffer: number;

  constructor(config?: AgentProcessRegistryConfig) {
    this.maxConcurrent = config?.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    this.defaultTimeoutMs = config?.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxTimeoutMs = config?.maxTimeoutMs ?? MAX_TIMEOUT_MS;
    this.maxOutputBuffer = config?.maxOutputBuffer ?? MAX_OUTPUT_BUFFER;
  }

  /**
   * Spawn a new Claude Code CLI subprocess.
   * Returns the agentId on success, or throws if concurrency limit is reached
   * or the `claude` binary is not available.
   */
  spawn(task: string, options?: { cwd?: string; timeoutMs?: number }): string {
    // Concurrency check
    const running = this.countRunning();
    if (running >= this.maxConcurrent) {
      throw new Error(
        `Agent concurrency limit reached (${running}/${this.maxConcurrent}). ` +
          'Wait for a running agent to complete or cancel one first.'
      );
    }

    const id = randomUUID();
    const cwd = options?.cwd ?? process.cwd();
    const rawTimeout = options?.timeoutMs ?? this.defaultTimeoutMs;
    const timeoutMs = Math.min(Math.max(rawTimeout, 1000), this.maxTimeoutMs);

    const record: AgentProcess = {
      id,
      task,
      cwd,
      status: 'running',
      stdout: '',
      stderr: '',
      startedAt: Date.now(),
    };

    // Build environment — pass through ANTHROPIC_API_KEY only
    const env: Record<string, string> = {};
    if (process.env.ANTHROPIC_API_KEY) {
      env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    }
    if (process.env.PATH) {
      env.PATH = process.env.PATH;
    }
    if (process.env.HOME) {
      env.HOME = process.env.HOME;
    }
    if (process.env.USERPROFILE) {
      env.USERPROFILE = process.env.USERPROFILE;
    }

    let child: ChildProcess;
    try {
      child = spawn('claude', ['-p', task, '--output-format', 'stream-json', '--max-turns', '50'], {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      logger.error({ err }, 'Failed to spawn claude CLI process');
      throw new Error(
        'Failed to spawn claude CLI. Ensure the `claude` binary is installed ' +
          'and available in PATH. In Docker containers, you may need to install it separately.'
      );
    }

    record.pid = child.pid;

    // Collect stdout
    child.stdout?.on('data', (chunk: Buffer) => {
      record.stdout += chunk.toString();
      if (record.stdout.length > this.maxOutputBuffer) {
        record.stdout = record.stdout.slice(-this.maxOutputBuffer);
      }
    });

    // Collect stderr
    child.stderr?.on('data', (chunk: Buffer) => {
      record.stderr += chunk.toString();
      if (record.stderr.length > this.maxOutputBuffer) {
        record.stderr = record.stderr.slice(-this.maxOutputBuffer);
      }
    });

    // Handle process exit
    child.on('close', (code) => {
      const tracked = this.processes.get(id);
      if (!tracked) return;

      if (tracked.timeoutTimer) {
        clearTimeout(tracked.timeoutTimer);
        tracked.timeoutTimer = null;
      }

      // Only update if still in 'running' state (cancelled/timeout already set)
      if (record.status === 'running') {
        record.status = code === 0 ? 'completed' : 'failed';
      }
      record.exitCode = code;
      record.completedAt = Date.now();
      tracked.child = null;

      logger.info({ agentId: id, exitCode: code, status: record.status }, 'Agent process exited');
    });

    child.on('error', (err) => {
      logger.error({ agentId: id, err }, 'Agent process error');
      if (record.status === 'running') {
        record.status = 'failed';
        record.completedAt = Date.now();
        record.stderr += `\nProcess error: ${err.message}`;
      }
    });

    // Timeout timer
    const timeoutTimer = setTimeout(() => {
      if (record.status !== 'running') return;
      logger.warn({ agentId: id, timeoutMs }, 'Agent process timed out');
      record.status = 'timeout';
      this.killProcess(id);
    }, timeoutMs);

    this.processes.set(id, { record, child, timeoutTimer });

    logger.info({ agentId: id, pid: child.pid, cwd, timeoutMs }, 'Spawned agent process');

    return id;
  }

  /**
   * Get current status of an agent process.
   */
  getStatus(agentId: string): {
    status: AgentProcess['status'];
    exitCode?: number | null;
    duration: number;
    outputPreview: string;
  } | null {
    const tracked = this.processes.get(agentId);
    if (!tracked) return null;

    const { record } = tracked;
    const duration = (record.completedAt ?? Date.now()) - record.startedAt;
    const outputPreview = record.stdout.slice(-500);

    return {
      status: record.status,
      exitCode: record.exitCode,
      duration,
      outputPreview,
    };
  }

  /**
   * Get stdout/stderr output from an agent process.
   * If `tail` is provided, returns only the last N lines of each.
   */
  getOutput(
    agentId: string,
    tail?: number
  ): {
    stdout: string;
    stderr: string;
  } | null {
    const tracked = this.processes.get(agentId);
    if (!tracked) return null;

    const { record } = tracked;

    if (tail && tail > 0) {
      const stdoutLines = record.stdout.split('\n');
      const stderrLines = record.stderr.split('\n');
      return {
        stdout: stdoutLines.slice(-tail).join('\n'),
        stderr: stderrLines.slice(-tail).join('\n'),
      };
    }

    return {
      stdout: record.stdout,
      stderr: record.stderr,
    };
  }

  /**
   * Cancel a running agent process (SIGTERM, then SIGKILL after 5s).
   */
  cancel(agentId: string): boolean {
    const tracked = this.processes.get(agentId);
    if (!tracked || tracked.record.status !== 'running') return false;

    tracked.record.status = 'cancelled';
    this.killProcess(agentId);
    return true;
  }

  /**
   * List all tracked agent processes.
   */
  list(): Array<{
    id: string;
    task: string;
    status: AgentProcess['status'];
    duration: number;
  }> {
    return Array.from(this.processes.values()).map(({ record }) => ({
      id: record.id,
      task: record.task,
      status: record.status,
      duration: (record.completedAt ?? Date.now()) - record.startedAt,
    }));
  }

  /**
   * Remove completed/failed/cancelled/timeout processes older than 1 hour.
   */
  cleanup(): number {
    const cutoff = Date.now() - CLEANUP_AGE_MS;
    let removed = 0;

    for (const [id, tracked] of this.processes) {
      if (
        tracked.record.status !== 'running' &&
        tracked.record.completedAt &&
        tracked.record.completedAt < cutoff
      ) {
        this.processes.delete(id);
        removed++;
      }
    }

    if (removed > 0) {
      logger.info({ removed }, 'Cleaned up old agent processes');
    }
    return removed;
  }

  /**
   * Kill all running processes (for shutdown).
   */
  shutdown(): void {
    for (const [id, tracked] of this.processes) {
      if (tracked.record.status === 'running') {
        tracked.record.status = 'cancelled';
        this.killProcess(id);
      }
      if (tracked.timeoutTimer) {
        clearTimeout(tracked.timeoutTimer);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private countRunning(): number {
    let count = 0;
    for (const tracked of this.processes.values()) {
      if (tracked.record.status === 'running') count++;
    }
    return count;
  }

  private killProcess(agentId: string): void {
    const tracked = this.processes.get(agentId);
    if (!tracked?.child) return;

    const { child } = tracked;

    try {
      child.kill('SIGTERM');
    } catch (err) {
      logger.warn({ agentId, err }, 'Error sending SIGTERM to agent process');
    }

    // Force kill after 5 seconds if still alive
    setTimeout(() => {
      try {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      } catch {
        // Process may already be gone
      }
    }, SIGKILL_DELAY_MS);
  }
}
