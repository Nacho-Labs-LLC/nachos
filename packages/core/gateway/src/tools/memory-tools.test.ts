/**
 * Tests for memory tools (memory_search and memory_get)
 */

import { describe, it, expect, vi } from 'vitest';
import { executeMemorySearch, executeMemoryGet } from './memory-tools.js';
import type { ToolCall, StateOperationContext } from '@nachos/types';
import type { StateLayer } from '@nachos/state';

describe('memory_search', () => {
  it('should return error if query is missing', async () => {
    const call: ToolCall = {
      id: 'test-1',
      tool: 'memory_search',
      sessionId: 'test-session',
      parameters: {},
    };

    const context: StateOperationContext = {
      sessionId: 'test-session',
      userId: 'test-user',
      securityMode: 'standard',
      internalTool: true,
    };

    const mockStateLayer = {
      queryMemory: vi.fn(),
    } as unknown as StateLayer;

    const result = await executeMemorySearch(call, mockStateLayer, context);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_PARAMETERS');
  });

  it('should search memory and return results', async () => {
    const call: ToolCall = {
      id: 'test-2',
      tool: 'memory_search',
      sessionId: 'test-session',
      parameters: {
        query: 'TypeScript',
        limit: 5,
      },
    };

    const context: StateOperationContext = {
      sessionId: 'test-session',
      userId: 'test-user',
      securityMode: 'standard',
      internalTool: true,
    };

    const mockStateLayer = {
      queryMemory: vi.fn().mockResolvedValue({
        entries: [
          {
            id: '1',
            agentId: 'test-user',
            kind: 'preference',
            content: 'User prefers TypeScript',
            tags: ['programming'],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        facts: [],
      }),
    } as unknown as StateLayer;

    const result = await executeMemorySearch(call, mockStateLayer, context);

    expect(result.success).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.text).toContain('User prefers TypeScript');
    expect(mockStateLayer.queryMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'TypeScript',
        limit: 5,
      }),
      context
    );
  });

  it('should format facts in results', async () => {
    const call: ToolCall = {
      id: 'test-3',
      tool: 'memory_search',
      sessionId: 'test-session',
      parameters: {
        query: 'project',
      },
    };

    const context: StateOperationContext = {
      sessionId: 'test-session',
      userId: 'test-user',
      securityMode: 'standard',
      internalTool: true,
    };

    const mockStateLayer = {
      queryMemory: vi.fn().mockResolvedValue({
        entries: [],
        facts: [
          {
            id: 'f1',
            agentId: 'test-user',
            subject: 'project-x',
            predicate: 'uses',
            object: 'TypeScript',
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    } as unknown as StateLayer;

    const result = await executeMemorySearch(call, mockStateLayer, context);

    expect(result.success).toBe(true);
    expect(result.content[0]?.text).toContain('Facts:');
    expect(result.content[0]?.text).toContain('project-x uses TypeScript');
  });
});

describe('memory_get', () => {
  it('should return error if path is missing', async () => {
    const call: ToolCall = {
      id: 'test-4',
      tool: 'memory_get',
      sessionId: 'test-session',
      parameters: {},
    };

    const context: StateOperationContext = {
      sessionId: 'test-session',
      userId: 'test-user',
      securityMode: 'standard',
      internalTool: true,
    };

    const result = await executeMemoryGet(call, {} as unknown as StateLayer, context);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_PARAMETERS');
  });

  it('should reject access to non-memory files', async () => {
    const call: ToolCall = {
      id: 'test-5',
      tool: 'memory_get',
      sessionId: 'test-session',
      parameters: {
        path: '../../../etc/passwd',
      },
    };

    const context: StateOperationContext = {
      sessionId: 'test-session',
      userId: 'test-user',
      securityMode: 'standard',
      internalTool: true,
    };

    const result = await executeMemoryGet(call, {} as unknown as StateLayer, context);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('ACCESS_DENIED');
  });

  it('should allow access to MEMORY.md', async () => {
    const call: ToolCall = {
      id: 'test-6',
      tool: 'memory_get',
      sessionId: 'test-session',
      parameters: {
        path: 'MEMORY.md',
      },
    };

    const context: StateOperationContext = {
      sessionId: 'test-session',
      userId: 'test-user',
      securityMode: 'standard',
      internalTool: true,
    };

    // This will fail if MEMORY.md doesn't exist, but the path check should pass
    const result = await executeMemoryGet(call, {} as unknown as StateLayer, context);

    // Either succeeds or fails with FILE_NOT_FOUND, but not ACCESS_DENIED
    if (!result.success) {
      expect(result.error?.code).toBe('FILE_NOT_FOUND');
    }
  });

  it('should allow access to memory/ directory files', async () => {
    const call: ToolCall = {
      id: 'test-7',
      tool: 'memory_get',
      sessionId: 'test-session',
      parameters: {
        path: 'memory/2026-02-22.md',
      },
    };

    const context: StateOperationContext = {
      sessionId: 'test-session',
      userId: 'test-user',
      securityMode: 'standard',
      internalTool: true,
    };

    const result = await executeMemoryGet(call, {} as unknown as StateLayer, context);

    // Either succeeds or fails with FILE_NOT_FOUND, but not ACCESS_DENIED
    if (!result.success) {
      expect(result.error?.code).toBe('FILE_NOT_FOUND');
    }
  });
});
