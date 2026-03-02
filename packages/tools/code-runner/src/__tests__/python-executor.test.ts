/**
 * Tests for PythonExecutor
 *
 * Tests validation, path traversal prevention, and execution with mocked child_process.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';

// Mock child_process.spawn
const mockSpawn = vi.fn();
vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

// Mock @nachos/tool-base
vi.mock('@nachos/tool-base', () => ({
  ToolService: class {
    start() {
      return Promise.resolve();
    }
    stop() {
      return Promise.resolve();
    }
  },
  connectToNats: vi.fn(),
  setupShutdownHandlers: vi.fn(),
}));

// Mock @nachos/types
vi.mock('@nachos/types', () => ({
  SecurityTier: { SAFE: 0, STANDARD: 1, ELEVATED: 2, RESTRICTED: 3, DANGEROUS: 4 },
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock fs for createTempScript/cleanupTempScript
vi.mock('fs', () => ({
  promises: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
}));

import { PythonExecutor } from '../python-executor.js';

/**
 * Create a mock ChildProcess-like EventEmitter with stdout/stderr streams
 */
function createMockProcess(opts?: {
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  signal?: string | null;
  error?: Error;
}): ChildProcess {
  const proc = new EventEmitter() as unknown as ChildProcess & EventEmitter;
  const stdoutEmitter = new EventEmitter();
  const stderrEmitter = new EventEmitter();

  (proc as unknown as { stdout: EventEmitter }).stdout = stdoutEmitter;
  (proc as unknown as { stderr: EventEmitter }).stderr = stderrEmitter;
  (proc as unknown as { kill: () => void }).kill = vi.fn();

  setTimeout(() => {
    if (opts?.error) {
      proc.emit('error', opts.error);
      return;
    }

    if (opts?.stdout) {
      stdoutEmitter.emit('data', Buffer.from(opts.stdout));
    }
    if (opts?.stderr) {
      stderrEmitter.emit('data', Buffer.from(opts.stderr));
    }

    proc.emit('close', opts?.exitCode ?? 0, opts?.signal ?? null);
  }, 5);

  return proc;
}

describe('PythonExecutor', () => {
  let executor: PythonExecutor;

  beforeEach(() => {
    executor = new PythonExecutor();
    mockSpawn.mockReset();
  });

  describe('validate', () => {
    it('accepts valid parameters', () => {
      const result = executor.validate({
        sessionId: 'test',
        code: 'print("hello")',
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('rejects when code is missing', () => {
      const result = executor.validate({
        sessionId: 'test',
        code: undefined as unknown as string,
      });

      expect(result.valid).toBe(false);
      expect(result.errors!.some((e) => e.includes('code'))).toBe(true);
    });

    it('rejects empty code string', () => {
      const result = executor.validate({
        sessionId: 'test',
        code: '',
      });

      expect(result.valid).toBe(false);
    });

    it('rejects invalid timeout values', () => {
      const result = executor.validate({
        sessionId: 'test',
        code: 'print(1)',
        timeout: 60,
      });

      expect(result.valid).toBe(false);
      expect(result.errors!.some((e) => e.includes('timeout'))).toBe(true);
    });

    it('accepts valid timeout within range', () => {
      const result = executor.validate({
        sessionId: 'test',
        code: 'print(1)',
        timeout: 20,
      });

      expect(result.valid).toBe(true);
    });
  });

  describe('path traversal prevention - workdir validation', () => {
    it('rejects workdir at filesystem root (/)', () => {
      const result = executor.validate({
        sessionId: 'test',
        code: 'print(1)',
        workdir: '/',
      });

      expect(result.valid).toBe(false);
      expect(result.errors!.some((e) => e.includes('workdir'))).toBe(true);
    });

    it('rejects workdir outside /tmp', () => {
      const result = executor.validate({
        sessionId: 'test',
        code: 'print(1)',
        workdir: '/etc/passwd',
      });

      expect(result.valid).toBe(false);
    });

    it('rejects workdir at /home', () => {
      const result = executor.validate({
        sessionId: 'test',
        code: 'print(1)',
        workdir: '/home/user',
      });

      expect(result.valid).toBe(false);
    });

    it('rejects workdir with path traversal (..)', () => {
      const result = executor.validate({
        sessionId: 'test',
        code: 'print(1)',
        workdir: '/tmp/../etc',
      });

      expect(result.valid).toBe(false);
    });

    // path.resolve is platform-dependent: on Windows, /tmp/sandbox resolves
    // to C:\tmp\sandbox which won't start with /tmp/. This validation is
    // designed for Linux/Docker containers, so we test on non-Windows only.
    it.skipIf(process.platform === 'win32')('accepts workdir within /tmp/ on Linux', () => {
      const result = executor.validate({
        sessionId: 'test',
        code: 'print(1)',
        workdir: '/tmp/sandbox',
      });

      expect(result.valid).toBe(true);
    });

    it.skipIf(process.platform === 'win32')(
      'accepts deeply nested workdir within /tmp/ on Linux',
      () => {
        const result = executor.validate({
          sessionId: 'test',
          code: 'print(1)',
          workdir: '/tmp/nachos/sandbox/agent-1',
        });

        expect(result.valid).toBe(true);
      }
    );
  });

  describe('execute', () => {
    it('executes python code and returns stdout', async () => {
      mockSpawn.mockReturnValue(createMockProcess({ stdout: 'Hello from Python\n', exitCode: 0 }));

      const result = await executor.execute({
        sessionId: 'test',
        code: 'print("Hello from Python")',
      });

      expect(result.success).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0]!.text).toContain('Hello from Python');
    });

    it('captures stderr on error', async () => {
      mockSpawn.mockReturnValue(
        createMockProcess({
          stderr: "NameError: name 'x' is not defined",
          exitCode: 1,
        })
      );

      const result = await executor.execute({
        sessionId: 'test',
        code: 'print(x)',
      });

      expect(result.success).toBe(false);
      expect(result.content[0]!.text).toContain('NameError');
    });

    it('handles spawn errors gracefully', async () => {
      mockSpawn.mockReturnValue(createMockProcess({ error: new Error('spawn python3 ENOENT') }));

      const result = await executor.execute({
        sessionId: 'test',
        code: 'print("test")',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe('EXECUTION_ERROR');
    });

    it('reports signal when process is killed', async () => {
      mockSpawn.mockReturnValue(
        createMockProcess({ stdout: '', exitCode: null, signal: 'SIGKILL' })
      );

      const result = await executor.execute({
        sessionId: 'test',
        code: 'import time; time.sleep(1000)',
      });

      expect(result.content[0]!.text).toContain('SIGKILL');
    });

    it('spawns python3 with restricted environment', async () => {
      mockSpawn.mockReturnValue(createMockProcess({ stdout: 'ok', exitCode: 0 }));

      await executor.execute({
        sessionId: 'test',
        code: 'print("ok")',
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        'python3',
        expect.any(Array),
        expect.objectContaining({
          env: expect.objectContaining({
            PYTHONDONTWRITEBYTECODE: '1',
            PYTHONUNBUFFERED: '1',
            PATH: '/usr/local/bin:/usr/bin:/bin',
          }),
        })
      );
    });

    it('passes timeout in milliseconds to spawn options', async () => {
      mockSpawn.mockReturnValue(createMockProcess({ stdout: 'ok', exitCode: 0 }));

      await executor.execute({
        sessionId: 'test',
        code: 'print("ok")',
        timeout: 10,
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        'python3',
        expect.any(Array),
        expect.objectContaining({
          timeout: 10000,
        })
      );
    });

    it('defaults timeout to 30 seconds', async () => {
      mockSpawn.mockReturnValue(createMockProcess({ stdout: 'ok', exitCode: 0 }));

      await executor.execute({
        sessionId: 'test',
        code: 'print("ok")',
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        'python3',
        expect.any(Array),
        expect.objectContaining({
          timeout: 30000,
        })
      );
    });

    it('returns no-output placeholder when stdout and stderr are empty', async () => {
      mockSpawn.mockReturnValue(createMockProcess({ stdout: '', stderr: '', exitCode: 0 }));

      const result = await executor.execute({
        sessionId: 'test',
        code: 'x = 1',
      });

      expect(result.success).toBe(true);
      expect(result.content[0]!.text).toBe('(no output)');
    });
  });

  describe('output limits', () => {
    it('truncates when output exceeds 2x max size', async () => {
      // Create a process that sends huge output after a microtask delay
      // so the event listeners in runSandboxed are attached first
      const proc = new EventEmitter() as unknown as ChildProcess & EventEmitter;
      const stdoutEmitter = new EventEmitter();
      const stderrEmitter = new EventEmitter();

      (proc as unknown as { stdout: EventEmitter }).stdout = stdoutEmitter;
      (proc as unknown as { stderr: EventEmitter }).stderr = stderrEmitter;
      const killFn = vi.fn();
      (proc as unknown as { kill: typeof killFn }).kill = killFn;

      mockSpawn.mockReturnValue(proc);

      const executePromise = executor.execute({
        sessionId: 'test',
        code: 'print("x" * 1000000)',
      });

      // Wait for the event listeners to be attached in runSandboxed
      await new Promise((r) => setTimeout(r, 10));

      // Send data that exceeds 2 * MAX_OUTPUT_SIZE (2 * 10240 = 20480)
      const bigChunk = 'x'.repeat(25000);
      stdoutEmitter.emit('data', Buffer.from(bigChunk));

      // The process should be killed
      expect(killFn).toHaveBeenCalledWith('SIGTERM');

      // Now close the process
      proc.emit('close', null, 'SIGTERM');

      const result = await executePromise;
      // Output was truncated, so the result should reflect that
      expect(result.content[0]!.text).toContain('SIGTERM');
    });
  });

  describe('memory size configuration', () => {
    it('applies memory limits using ulimit', async () => {
      await executor.initialize({
        config: { max_memory: '64mb' },
        secrets: {},
        securityMode: 'standard',
      });

      mockSpawn.mockReturnValue(createMockProcess({ stdout: 'ok', exitCode: 0 }));

      await executor.execute({
        sessionId: 'test',
        code: 'print("ok")',
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        'sh',
        expect.arrayContaining(['-lc', expect.stringContaining('ulimit')]),
        expect.any(Object)
      );
    });

    it('uses python3 directly when no memory limit', async () => {
      await executor.initialize({
        config: {},
        secrets: {},
        securityMode: 'standard',
      });

      mockSpawn.mockReturnValue(createMockProcess({ stdout: 'ok', exitCode: 0 }));

      await executor.execute({
        sessionId: 'test',
        code: 'print("ok")',
      });

      expect(mockSpawn).toHaveBeenCalledWith('python3', expect.any(Array), expect.any(Object));
    });
  });

  describe('healthCheck', () => {
    it('returns healthy', async () => {
      const status = await executor.healthCheck();
      expect(status.healthy).toBe(true);
    });
  });

  describe('initialize', () => {
    it('applies timeout from limits config', async () => {
      await executor.initialize({
        config: {},
        secrets: {},
        securityMode: 'standard',
        limits: { timeout: 15 },
      });

      const result = executor.validate({
        sessionId: 'test',
        code: 'print(1)',
        timeout: 20,
      });

      expect(result.valid).toBe(false);
    });

    it('applies timeout from config.timeout', async () => {
      await executor.initialize({
        config: { timeout: 10 },
        secrets: {},
        securityMode: 'standard',
      });

      const result = executor.validate({
        sessionId: 'test',
        code: 'print(1)',
        timeout: 12,
      });

      expect(result.valid).toBe(false);
    });

    it('accepts memory size as number', async () => {
      await executor.initialize({
        config: {},
        secrets: {},
        securityMode: 'standard',
        limits: { maxMemory: 67108864 }, // 64MB in bytes
      });

      mockSpawn.mockReturnValue(createMockProcess({ stdout: 'ok', exitCode: 0 }));

      await executor.execute({
        sessionId: 'test',
        code: 'print("ok")',
      });

      // Should use sh with ulimit
      expect(mockSpawn).toHaveBeenCalledWith(
        'sh',
        expect.arrayContaining(['-lc', expect.stringContaining('ulimit')]),
        expect.any(Object)
      );
    });
  });
});
