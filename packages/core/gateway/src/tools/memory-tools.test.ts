/**
 * Tests for memory tools (memory_search, memory_get, memory_write, memory_delete, memory_recall)
 */

import { describe, it, expect, vi } from 'vitest';
import {
  executeMemorySearch,
  executeMemoryGet,
  executeMemoryWrite,
  executeMemoryDelete,
  executeConversationSearch,
  executeMemoryRecall,
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

// ---------------------------------------------------------------------------
// nachos_search_conversations
// ---------------------------------------------------------------------------
describe('nachos_search_conversations', () => {
  const context: StateOperationContext = {
    sessionId: 'test-session',
    userId: 'test-user',
    securityMode: 'standard',
    internalTool: true,
  };

  it('returns INVALID_PARAMETERS when query is missing', async () => {
    const call: ToolCall = {
      id: 'cs-1',
      tool: 'nachos_search_conversations',
      sessionId: 'test-session',
      parameters: {},
    };

    const mockStateLayer = {
      sessionsStore: { searchMessages: vi.fn() },
    } as unknown as StateLayer;

    const result = await executeConversationSearch(call, mockStateLayer, context);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_PARAMETERS');
  });

  it('returns NOT_ENABLED when sessionsStore.searchMessages is absent', async () => {
    const call: ToolCall = {
      id: 'cs-2',
      tool: 'nachos_search_conversations',
      sessionId: 'test-session',
      parameters: { query: 'TypeScript strict mode' },
    };

    // No searchMessages property → semantic disabled
    const mockStateLayer = {
      sessionsStore: {},
    } as unknown as StateLayer;

    const result = await executeConversationSearch(call, mockStateLayer, context);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('NOT_ENABLED');
  });

  it('returns NOT_ENABLED when sessionsStore is undefined', async () => {
    const call: ToolCall = {
      id: 'cs-3',
      tool: 'nachos_search_conversations',
      sessionId: 'test-session',
      parameters: { query: 'something' },
    };

    const mockStateLayer = {
      sessionsStore: undefined,
    } as unknown as StateLayer;

    const result = await executeConversationSearch(call, mockStateLayer, context);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('NOT_ENABLED');
  });

  it('returns empty message when no results found', async () => {
    const call: ToolCall = {
      id: 'cs-4',
      tool: 'nachos_search_conversations',
      sessionId: 'test-session',
      parameters: { query: 'nothing matches this' },
    };

    const mockStateLayer = {
      sessionsStore: {
        searchMessages: vi.fn().mockResolvedValue([]),
      },
    } as unknown as StateLayer;

    const result = await executeConversationSearch(call, mockStateLayer, context);
    expect(result.success).toBe(true);
    expect(result.content[0]!.text).toContain('No conversation history found');
  });

  it('formats results with similarity, date, role, and verbatim content', async () => {
    const call: ToolCall = {
      id: 'cs-5',
      tool: 'nachos_search_conversations',
      sessionId: 'test-session',
      parameters: { query: 'TypeScript', limit: 2 },
    };

    const mockResults = [
      {
        messageId: 'msg-1',
        sessionId: 'sess-1',
        similarity: 0.92,
        role: 'user',
        content: 'I prefer TypeScript strict mode',
        timestamp: '2026-03-01T10:00:00.000Z',
      },
      {
        messageId: 'msg-2',
        sessionId: 'sess-1',
        similarity: 0.78,
        role: 'assistant',
        content: 'Got it, I will use strict TypeScript settings',
        timestamp: '2026-03-01T10:00:05.000Z',
      },
    ];

    const searchMessages = vi.fn().mockResolvedValue(mockResults);
    const mockStateLayer = {
      sessionsStore: { searchMessages },
    } as unknown as StateLayer;

    const result = await executeConversationSearch(call, mockStateLayer, context);
    expect(result.success).toBe(true);

    const text = result.content[0]!.text;
    // Similarity shown as percentage
    expect(text).toContain('92%');
    expect(text).toContain('78%');
    // Role is shown once (not doubled)
    expect(text).toContain('user: I prefer TypeScript strict mode');
    expect(text).toContain('assistant: Got it');
    // Content does NOT start with "user: user:" (no double-prefix bug)
    expect(text).not.toMatch(/user: user:/);

    // Verify options were forwarded
    expect(searchMessages).toHaveBeenCalledWith(
      'TypeScript',
      expect.objectContaining({ limit: 2 })
    );
  });

  it('forwards since and sessionId options to searchMessages', async () => {
    const call: ToolCall = {
      id: 'cs-6',
      tool: 'nachos_search_conversations',
      sessionId: 'test-session',
      parameters: { query: 'deploy', since: '2026-03-01', sessionId: 'sess-abc' },
    };

    const searchMessages = vi.fn().mockResolvedValue([]);
    const mockStateLayer = {
      sessionsStore: { searchMessages },
    } as unknown as StateLayer;

    await executeConversationSearch(call, mockStateLayer, context);

    expect(searchMessages).toHaveBeenCalledWith('deploy', {
      limit: 5,
      since: '2026-03-01',
      sessionId: 'sess-abc',
    });
  });

  it('returns error on unexpected exception', async () => {
    const call: ToolCall = {
      id: 'cs-7',
      tool: 'nachos_search_conversations',
      sessionId: 'test-session',
      parameters: { query: 'crash test' },
    };

    const mockStateLayer = {
      sessionsStore: {
        searchMessages: vi.fn().mockRejectedValue(new Error('vector store unavailable')),
      },
    } as unknown as StateLayer;

    const result = await executeConversationSearch(call, mockStateLayer, context);
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('CONVERSATION_SEARCH_FAILED');
    expect(result.error?.message).toContain('vector store unavailable');
  });
});

describe('memory_recall', () => {
  const context: StateOperationContext = {
    sessionId: 'test-session',
    userId: 'test-user',
    securityMode: 'standard',
    internalTool: true,
  };

  it('should return error if topic is missing', async () => {
    const call: ToolCall = {
      id: 'recall-1',
      tool: 'memory_recall',
      sessionId: 'test-session',
      parameters: {},
    };

    const mockStateLayer = {} as unknown as StateLayer;
    const result = await executeMemoryRecall(call, mockStateLayer, context);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_PARAMETERS');
  });

  it('should search across memories and facts', async () => {
    const call: ToolCall = {
      id: 'recall-2',
      tool: 'memory_recall',
      sessionId: 'test-session',
      parameters: {
        topic: 'TypeScript',
        sources: ['memories', 'facts'],
      },
    };

    const mockStateLayer = {
      queryMemory: vi.fn().mockResolvedValue({
        entries: [
          {
            id: 'e1',
            kind: 'decision',
            content: 'Decided to use TypeScript strict mode',
            tags: ['typescript'],
            confidence: 0.9,
            createdAt: '2026-03-01T00:00:00Z',
          },
        ],
        facts: [],
      }),
      queryMemoryFacts: vi.fn().mockResolvedValue([
        {
          id: 'f1',
          agentId: 'test-user',
          subject: 'project',
          predicate: 'uses',
          object: 'TypeScript',
          type: 'general',
          createdAt: '2026-03-01T00:00:00Z',
        },
      ]),
      sessionsStore: undefined,
    } as unknown as StateLayer;

    const result = await executeMemoryRecall(call, mockStateLayer, context);

    expect(result.success).toBe(true);
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('Recalled');
    expect(text).toContain('Memory Entries');
    expect(text).toContain('TypeScript strict mode');
    expect(text).toContain('Facts');
    expect(text).toContain('TypeScript');
  });

  it('should search conversations when available', async () => {
    const call: ToolCall = {
      id: 'recall-3',
      tool: 'memory_recall',
      sessionId: 'test-session',
      parameters: {
        topic: 'deployment',
        sources: ['conversations'],
      },
    };

    const mockSessionsStore = {
      searchMessages: vi.fn().mockResolvedValue([
        {
          messageId: 'm1',
          sessionId: 's1',
          similarity: 0.85,
          role: 'user',
          content: 'We should deploy to production on Friday',
          timestamp: '2026-03-08T10:00:00Z',
        },
      ]),
    };

    const mockStateLayer = {
      queryMemory: vi.fn().mockResolvedValue({ entries: [], facts: [] }),
      queryMemoryFacts: vi.fn().mockResolvedValue([]),
      sessionsStore: mockSessionsStore,
    } as unknown as StateLayer;

    const result = await executeMemoryRecall(call, mockStateLayer, context);

    expect(result.success).toBe(true);
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('Conversations');
    expect(text).toContain('deploy to production');
    expect(text).toContain('85%');
  });

  it('should return no results message when nothing matches', async () => {
    const call: ToolCall = {
      id: 'recall-4',
      tool: 'memory_recall',
      sessionId: 'test-session',
      parameters: { topic: 'nonexistent-xyz-topic', sources: ['memories', 'facts'] },
    };

    const mockStateLayer = {
      queryMemory: vi.fn().mockResolvedValue({ entries: [], facts: [] }),
      queryMemoryFacts: vi.fn().mockResolvedValue([]),
      sessionsStore: undefined,
    } as unknown as StateLayer;

    const result = await executeMemoryRecall(call, mockStateLayer, context);

    expect(result.success).toBe(true);
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('No memories found');
  });

  it('should show unavailable message when conversations source is requested but not enabled', async () => {
    const call: ToolCall = {
      id: 'recall-4b',
      tool: 'memory_recall',
      sessionId: 'test-session',
      parameters: { topic: 'test', sources: ['conversations'] },
    };

    const mockStateLayer = {
      queryMemory: vi.fn().mockResolvedValue({ entries: [], facts: [] }),
      queryMemoryFacts: vi.fn().mockResolvedValue([]),
      sessionsStore: undefined,
    } as unknown as StateLayer;

    const result = await executeMemoryRecall(call, mockStateLayer, context);

    expect(result.success).toBe(true);
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('search not available');
  });

  it('should return error for invalid sources', async () => {
    const call: ToolCall = {
      id: 'recall-4c',
      tool: 'memory_recall',
      sessionId: 'test-session',
      parameters: { topic: 'test', sources: ['invalid'] },
    };

    const mockStateLayer = {} as unknown as StateLayer;
    const result = await executeMemoryRecall(call, mockStateLayer, context);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_PARAMETERS');
  });

  it('should respect the since date filter', async () => {
    const call: ToolCall = {
      id: 'recall-5',
      tool: 'memory_recall',
      sessionId: 'test-session',
      parameters: {
        topic: 'TypeScript',
        since: '2026-03-10',
      },
    };

    const mockStateLayer = {
      queryMemory: vi.fn().mockResolvedValue({
        entries: [
          {
            id: 'e1',
            kind: 'fact',
            content: 'Old fact about TS',
            createdAt: '2026-03-01T00:00:00Z',
          },
          {
            id: 'e2',
            kind: 'fact',
            content: 'Recent TS update',
            createdAt: '2026-03-11T00:00:00Z',
          },
        ],
        facts: [],
      }),
      queryMemoryFacts: vi.fn().mockResolvedValue([]),
      sessionsStore: undefined,
    } as unknown as StateLayer;

    const result = await executeMemoryRecall(call, mockStateLayer, context);

    expect(result.success).toBe(true);
    const text = result.content[0]?.text ?? '';
    // Only the recent entry should be included
    expect(text).toContain('Recent TS update');
    expect(text).not.toContain('Old fact about TS');
  });

  it('should cap limit at 20', async () => {
    const call: ToolCall = {
      id: 'recall-6',
      tool: 'memory_recall',
      sessionId: 'test-session',
      parameters: {
        topic: 'test',
        limit: 100,
      },
    };

    const mockStateLayer = {
      queryMemory: vi.fn().mockResolvedValue({ entries: [], facts: [] }),
      queryMemoryFacts: vi.fn().mockResolvedValue([]),
      sessionsStore: undefined,
    } as unknown as StateLayer;

    await executeMemoryRecall(call, mockStateLayer, context);

    // The queryMemory call should have limit capped at 20
    expect(mockStateLayer.queryMemory).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 20 }),
      expect.anything()
    );
  });

  it('should handle errors from memory stores gracefully', async () => {
    const call: ToolCall = {
      id: 'recall-7',
      tool: 'memory_recall',
      sessionId: 'test-session',
      parameters: { topic: 'test' },
    };

    const mockStateLayer = {
      queryMemory: vi.fn().mockRejectedValue(new Error('DB down')),
      queryMemoryFacts: vi.fn().mockRejectedValue(new Error('DB down')),
      sessionsStore: undefined,
    } as unknown as StateLayer;

    const result = await executeMemoryRecall(call, mockStateLayer, context);

    // Should still succeed with error messages in sections
    expect(result.success).toBe(true);
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('search failed');
  });
});
