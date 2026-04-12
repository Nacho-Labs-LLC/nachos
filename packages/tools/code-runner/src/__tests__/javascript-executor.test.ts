/**
 * Tests for JavaScriptExecutor
 *
 * Tests validation, initialization, and execution with mocked child_process.
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
  existsSync: vi.fn().mockReturnValue(true), // /workspace exists in test env
  promises: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
}));

import { JavaScriptExecutor } from '../javascript-executor.js';

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

  // Schedule data emission and process close
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

describe('JavaScriptExecutor', () => {
  let executor: JavaScriptExecutor;

  beforeEach(() => {
    executor = new JavaScriptExecutor();
    mockSpawn.mockReset();
  });

  describe('validate', () => {
    it('accepts valid parameters', () => {
      const result = executor.validate({
        sessionId: 'test',
        code: 'console.log("hello")',
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
      expect(result.errors).toBeDefined();
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
        code: 'console.log(1)',
        timeout: 60, // Exceeds max of 30
      });

      expect(result.valid).toBe(false);
      expect(result.errors!.some((e) => e.includes('timeout'))).toBe(true);
    });

    it('rejects timeout of 0', () => {
      const result = executor.validate({
        sessionId: 'test',
        code: 'console.log(1)',
        timeout: 0,
      });

      expect(result.valid).toBe(false);
    });

    it('accepts valid timeout within range', () => {
      const result = executor.validate({
        sessionId: 'test',
        code: 'console.log(1)',
        timeout: 15,
      });

      expect(result.valid).toBe(true);
    });

    it('rejects workdir outside /tmp', () => {
      const result = executor.validate({
        sessionId: 'test',
        code: 'console.log(1)',
        workdir: '/home/user/scripts',
      });

      expect(result.valid).toBe(false);
      expect(result.errors!.some((e) => e.includes('workdir'))).toBe(true);
    });

    // path.resolve is platform-dependent: on Windows, /tmp/sandbox resolves
    // to C:\tmp\sandbox which won't start with /tmp/. This validation is
    // designed for Linux/Docker containers, so we test on non-Windows only.
    it.skipIf(process.platform === 'win32')('accepts workdir within /tmp on Linux', () => {
      const result = executor.validate({
        sessionId: 'test',
        code: 'console.log(1)',
        workdir: '/tmp/sandbox',
      });

      expect(result.valid).toBe(true);
    });
  });

  describe('initialize', () => {
    it('initializes without errors', async () => {
      await expect(
        executor.initialize({
          config: {},
          secrets: {},
          securityMode: 'standard',
        })
      ).resolves.not.toThrow();
    });

    it('applies configured timeout limits', async () => {
      await executor.initialize({
        config: { executionTimeout: 10 },
        secrets: {},
        securityMode: 'standard',
      });

      // Now validate with timeout=15, which should fail because maxTimeout=10
      const result = executor.validate({
        sessionId: 'test',
        code: 'console.log(1)',
        timeout: 15,
      });

      expect(result.valid).toBe(false);
    });

    it('caps maxTimeout at 30 even if config is higher', async () => {
      await executor.initialize({
        config: { executionTimeout: 60 },
        secrets: {},
        securityMode: 'standard',
      });

      const result = executor.validate({
        sessionId: 'test',
        code: 'console.log(1)',
        timeout: 30,
      });

      expect(result.valid).toBe(true);
    });
  });

  describe('execute', () => {
    it('executes code and returns stdout', async () => {
      mockSpawn.mockReturnValue(createMockProcess({ stdout: 'Hello World\n', exitCode: 0 }));

      const result = await executor.execute({
        sessionId: 'test',
        code: 'console.log("Hello World")',
      });

      expect(result.success).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(result.content[0]!.type).toBe('text');
      expect(result.content[0]!.text).toContain('Hello World');
    });

    it('captures stderr and reports non-zero exit code', async () => {
      mockSpawn.mockReturnValue(
        createMockProcess({
          stderr: 'ReferenceError: x is not defined',
          exitCode: 1,
        })
      );

      const result = await executor.execute({
        sessionId: 'test',
        code: 'console.log(x)',
      });

      expect(result.success).toBe(false);
      expect(result.content[0]!.text).toContain('ReferenceError');
      expect(result.metadata?.warnings).toBeDefined();
    });

    it('handles spawn errors gracefully', async () => {
      mockSpawn.mockReturnValue(createMockProcess({ error: new Error('spawn ENOENT') }));

      const result = await executor.execute({
        sessionId: 'test',
        code: 'console.log("test")',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe('EXECUTION_ERROR');
      expect(result.error!.message).toContain('spawn ENOENT');
    });

    it('reports signal when process is killed', async () => {
      mockSpawn.mockReturnValue(
        createMockProcess({ stdout: '', exitCode: null, signal: 'SIGTERM' })
      );

      const result = await executor.execute({
        sessionId: 'test',
        code: 'while(true){}',
      });

      expect(result.content[0]!.text).toContain('SIGTERM');
    });

    it('spawns node with restricted environment', async () => {
      mockSpawn.mockReturnValue(createMockProcess({ stdout: 'ok', exitCode: 0 }));

      await executor.execute({
        sessionId: 'test',
        code: 'console.log("ok")',
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        'node',
        expect.any(Array),
        expect.objectContaining({
          env: expect.objectContaining({
            NODE_ENV: 'production',
            PATH: '/usr/local/bin:/usr/bin:/bin',
          }),
        })
      );
    });

    it('passes timeout to spawn options', async () => {
      mockSpawn.mockReturnValue(createMockProcess({ stdout: 'ok', exitCode: 0 }));

      await executor.execute({
        sessionId: 'test',
        code: 'console.log("ok")',
        timeout: 5,
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        'node',
        expect.any(Array),
        expect.objectContaining({
          timeout: 5000, // 5 seconds * 1000
        })
      );
    });

    it('uses /workspace as default cwd', async () => {
      mockSpawn.mockReturnValue(createMockProcess({ stdout: 'ok', exitCode: 0 }));

      await executor.execute({
        sessionId: 'test',
        code: 'console.log("ok")',
      });

      expect(mockSpawn).toHaveBeenCalledWith(
        'node',
        expect.any(Array),
        expect.objectContaining({
          cwd: '/workspace',
        })
      );
    });
  });

  describe('healthCheck', () => {
    it('returns healthy', async () => {
      const status = await executor.healthCheck();
      expect(status.healthy).toBe(true);
    });
  });

  describe('memory size configuration', () => {
    it('applies memory limits from config', async () => {
      await executor.initialize({
        config: { max_memory: '128mb' },
        secrets: {},
        securityMode: 'standard',
      });

      mockSpawn.mockReturnValue(createMockProcess({ stdout: 'ok', exitCode: 0 }));

      await executor.execute({
        sessionId: 'test',
        code: 'console.log("ok")',
      });

      // When memory is configured, command becomes 'sh' with ulimit
      expect(mockSpawn).toHaveBeenCalledWith(
        'sh',
        expect.arrayContaining(['-lc', expect.stringContaining('ulimit')]),
        expect.any(Object)
      );
    });

    it('uses node directly when no memory limit is set', async () => {
      await executor.initialize({
        config: {},
        secrets: {},
        securityMode: 'standard',
      });

      mockSpawn.mockReturnValue(createMockProcess({ stdout: 'ok', exitCode: 0 }));

      await executor.execute({
        sessionId: 'test',
        code: 'console.log("ok")',
      });

      expect(mockSpawn).toHaveBeenCalledWith('node', expect.any(Array), expect.any(Object));
    });
  });
});
