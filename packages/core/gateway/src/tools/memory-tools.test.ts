/**
 * Tests for memory tools (memory_search, memory_get, memory_write, memory_delete)
 */

import { describe, it, expect, vi } from 'vitest';
import {
  executeMemorySearch,
  executeMemoryGet,
  executeMemoryWrite,
  executeMemoryDelete,
} from './memory-tools.js';
import type { ToolCall } from '@nachos/types';
import type { StateLayer, StateOperationContext } from '@nachos/state';

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

  it('should search memory and return results with IDs', async () => {
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
            id: 'mem-abc-123',
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
    expect(result.content[0]?.text).toContain('id: mem-abc-123');
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

describe('memory_write', () => {
  it('should return error if content is missing', async () => {
    const call: ToolCall = {
      id: 'test-8',
      tool: 'memory_write',
      sessionId: 'test-session',
      parameters: { kind: 'fact' },
    };

    const context: StateOperationContext = {
      sessionId: 'test-session',
      userId: 'test-user',
      securityMode: 'standard',
      internalTool: true,
    };

    const mockStateLayer = {
      appendMemoryEntry: vi.fn(),
    } as unknown as StateLayer;

    const result = await executeMemoryWrite(call, mockStateLayer, context);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_PARAMETERS');
  });

  it('should reject invalid kind', async () => {
    const call: ToolCall = {
      id: 'test-9',
      tool: 'memory_write',
      sessionId: 'test-session',
      parameters: { content: 'some fact', kind: 'invalid_kind' },
    };

    const context: StateOperationContext = {
      sessionId: 'test-session',
      userId: 'test-user',
      securityMode: 'standard',
      internalTool: true,
    };

    const mockStateLayer = {
      appendMemoryEntry: vi.fn(),
    } as unknown as StateLayer;

    const result = await executeMemoryWrite(call, mockStateLayer, context);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_PARAMETERS');
  });

  it('should save memory entry and return confirmation', async () => {
    const call: ToolCall = {
      id: 'test-10',
      tool: 'memory_write',
      sessionId: 'test-session',
      parameters: { content: 'User likes dark mode', kind: 'preference', tags: ['ui'] },
    };

    const context: StateOperationContext = {
      sessionId: 'test-session',
      userId: 'test-user',
      securityMode: 'standard',
      internalTool: true,
    };

    const mockStateLayer = {
      appendMemoryEntry: vi.fn().mockImplementation((entry) => Promise.resolve(entry)),
    } as unknown as StateLayer;

    const result = await executeMemoryWrite(call, mockStateLayer, context);

    expect(result.success).toBe(true);
    expect(result.content[0]?.text).toContain('Saved memory entry');
    expect(result.content[0]?.text).toContain('preference');
    expect(result.content[0]?.text).toContain('User likes dark mode');
    expect(mockStateLayer.appendMemoryEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'preference',
        content: 'User likes dark mode',
        tags: ['ui'],
        agentId: 'test-user',
      }),
      context
    );
  });
});

describe('memory_delete', () => {
  it('should return error if id is missing', async () => {
    const call: ToolCall = {
      id: 'test-11',
      tool: 'memory_delete',
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
      deleteMemoryEntry: vi.fn(),
    } as unknown as StateLayer;

    const result = await executeMemoryDelete(call, mockStateLayer, context);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_PARAMETERS');
    expect(result.error?.message).toContain('id parameter is required');
  });

  it('should return error if id is not a string', async () => {
    const call: ToolCall = {
      id: 'test-12',
      tool: 'memory_delete',
      sessionId: 'test-session',
      parameters: { id: 123 },
    };

    const context: StateOperationContext = {
      sessionId: 'test-session',
      userId: 'test-user',
      securityMode: 'standard',
      internalTool: true,
    };

    const mockStateLayer = {
      deleteMemoryEntry: vi.fn(),
    } as unknown as StateLayer;

    const result = await executeMemoryDelete(call, mockStateLayer, context);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_PARAMETERS');
  });

  it('should delete memory entry and return confirmation', async () => {
    const call: ToolCall = {
      id: 'test-13',
      tool: 'memory_delete',
      sessionId: 'test-session',
      parameters: { id: 'mem-abc-123' },
    };

    const context: StateOperationContext = {
      sessionId: 'test-session',
      userId: 'test-user',
      securityMode: 'standard',
      internalTool: true,
    };

    const mockStateLayer = {
      deleteMemoryEntry: vi.fn().mockResolvedValue(undefined),
    } as unknown as StateLayer;

    const result = await executeMemoryDelete(call, mockStateLayer, context);

    expect(result.success).toBe(true);
    expect(result.content[0]?.text).toContain('Deleted memory entry');
    expect(result.content[0]?.text).toContain('mem-abc-123');
    expect(mockStateLayer.deleteMemoryEntry).toHaveBeenCalledWith(
      'mem-abc-123',
      'test-user',
      context
    );
  });

  it('should use sessionId as agentId when userId is not provided', async () => {
    const call: ToolCall = {
      id: 'test-14',
      tool: 'memory_delete',
      sessionId: 'test-session',
      parameters: { id: 'mem-def-456' },
    };

    const context: StateOperationContext = {
      sessionId: 'test-session',
      securityMode: 'standard',
      internalTool: true,
    };

    const mockStateLayer = {
      deleteMemoryEntry: vi.fn().mockResolvedValue(undefined),
    } as unknown as StateLayer;

    const result = await executeMemoryDelete(call, mockStateLayer, context);

    expect(result.success).toBe(true);
    expect(mockStateLayer.deleteMemoryEntry).toHaveBeenCalledWith(
      'mem-def-456',
      'test-session',
      context
    );
  });

  it('should handle errors from state layer', async () => {
    const call: ToolCall = {
      id: 'test-15',
      tool: 'memory_delete',
      sessionId: 'test-session',
      parameters: { id: 'nonexistent-id' },
    };

    const context: StateOperationContext = {
      sessionId: 'test-session',
      userId: 'test-user',
      securityMode: 'standard',
      internalTool: true,
    };

    const mockStateLayer = {
      deleteMemoryEntry: vi.fn().mockRejectedValue(new Error('Entry not found')),
    } as unknown as StateLayer;

    const result = await executeMemoryDelete(call, mockStateLayer, context);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('MEMORY_DELETE_FAILED');
    expect(result.error?.message).toContain('Entry not found');
  });
});
