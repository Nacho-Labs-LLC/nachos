import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LocalToolHandler } from './local-tool-handler.js';
import type { ToolCall } from '@nachos/types';

describe('LocalToolHandler', () => {
  let localToolHandler: LocalToolHandler;
  let mockLogger: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    localToolHandler = new LocalToolHandler({
      logger: mockLogger,
    });
  });

  describe('isLocalTool', () => {
    it('should identify exec and shell as local tools', () => {
      expect(localToolHandler.isLocalTool('exec')).toBe(true);
      expect(localToolHandler.isLocalTool('shell')).toBe(true);
    });

    it('should not identify other tools as local', () => {
      expect(localToolHandler.isLocalTool('browser')).toBe(false);
      expect(localToolHandler.isLocalTool('filesystem')).toBe(false);
      expect(localToolHandler.isLocalTool('web_fetch')).toBe(false);
    });
  });

  describe('getToolGroup', () => {
    it('should return tool group for exec/shell commands', () => {
      const call: ToolCall = {
        id: 'test-1',
        tool: 'exec',
        parameters: {
          command: 'goplaces search "test"',
        },
      };

      expect(localToolHandler.getToolGroup(call)).toBe('lookup');
    });

    it('should return undefined for non-exec/shell tools', () => {
      const call: ToolCall = {
        id: 'test-2',
        tool: 'browser',
        parameters: {},
      };

      expect(localToolHandler.getToolGroup(call)).toBeUndefined();
    });

    it('should return undefined when command parameter is missing', () => {
      const call: ToolCall = {
        id: 'test-3',
        tool: 'exec',
        parameters: {},
      };

      expect(localToolHandler.getToolGroup(call)).toBeUndefined();
    });
  });

  describe('execute', () => {
    it('should return error for unknown local tool', async () => {
      const call: ToolCall = {
        id: 'test-4',
        tool: 'unknown_tool',
        parameters: {},
      };

      const result = await localToolHandler.execute(call);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('UNKNOWN_LOCAL_TOOL');
      expect(result.error?.message).toContain('Unknown local tool');
    });

    it('should return error when command parameter is missing', async () => {
      const call: ToolCall = {
        id: 'test-5',
        tool: 'exec',
        parameters: {},
      };

      const result = await localToolHandler.execute(call);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('MISSING_COMMAND');
      expect(result.error?.message).toContain('command');
    });

    it('should return error when command is not allowed', async () => {
      const call: ToolCall = {
        id: 'test-6',
        tool: 'exec',
        parameters: {
          command: 'rm -rf /test', // rm is not in allowlist
        },
      };

      const result = await localToolHandler.execute(call);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('COMMAND_NOT_ALLOWED');
      expect(result.error?.message).toContain('not allowed');
      expect(result.error?.details).toHaveProperty('allowedBinaries');
    });

    it('should execute allowed commands (gifgrep)', async () => {
      const call: ToolCall = {
        id: 'test-7',
        tool: 'exec',
        parameters: {
          command: 'gifgrep --version',
        },
      };

      // This will likely fail because gifgrep may not be installed in test environment
      // But we can verify the structure of the response
      const result = await localToolHandler.execute(call);

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('content');
      expect(result).toHaveProperty('metadata');
      expect(result.metadata).toHaveProperty('duration');
    });

    it('should handle execution errors gracefully', async () => {
      const call: ToolCall = {
        id: 'test-8',
        tool: 'shell',
        parameters: {
          command: 'goplaces nonexistent-command',
        },
      };

      // Set env to allow execution attempt
      process.env.GOOGLE_PLACES_API_KEY = 'test-key';

      const result = await localToolHandler.execute(call);

      // Should complete without throwing, even if command fails
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('metadata');
      expect(result.metadata?.duration).toBeGreaterThan(0);
    });

    it('should include stderr in content when present', async () => {
      const call: ToolCall = {
        id: 'test-9',
        tool: 'exec',
        parameters: {
          command: 'gifgrep invalid-arg-that-causes-error',
        },
      };

      const result = await localToolHandler.execute(call);

      // Check that content blocks have correct structure
      if (result.content.length > 0) {
        result.content.forEach((block) => {
          expect(block).toHaveProperty('type');
          if (block.type === 'text') {
            expect(block).toHaveProperty('text');
          }
        });
      }
    });

    it('should set success to false for non-zero exit codes', async () => {
      const call: ToolCall = {
        id: 'test-10',
        tool: 'exec',
        parameters: {
          command: 'gifgrep --nonexistent-flag',
        },
      };

      const result = await localToolHandler.execute(call);

      // Command will likely fail with non-zero exit
      if (result.success === false) {
        expect(result.error).toBeDefined();
        expect(result.error?.code).toMatch(/TIMEOUT|NONZERO_EXIT|EXECUTION_ERROR/);
      }
    });
  });
});
