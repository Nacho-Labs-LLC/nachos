/**
 * Tests for snapshot tools (snapshot_list and snapshot_restore)
 */

import { describe, it, expect, vi } from 'vitest';
import { executeSnapshotList, executeSnapshotRestore } from './snapshot-tools.js';
import type { ToolCall } from '@nachos/types';
import type { IContextSnapshotService, ContextSnapshot } from '@nachos/context-manager';
import type { SessionsStore } from '@nachos/state';

function createMockSnapshotService(
  overrides: Partial<IContextSnapshotService> = {}
): IContextSnapshotService {
  return {
    createSnapshot: vi.fn(),
    getSnapshot: vi.fn().mockResolvedValue(null),
    listSnapshots: vi.fn().mockResolvedValue([]),
    getLatestSnapshot: vi.fn().mockResolvedValue(null),
    deleteSnapshot: vi.fn().mockResolvedValue(false),
    deleteAllSnapshots: vi.fn().mockResolvedValue(0),
    getSnapshotCount: vi.fn().mockResolvedValue(0),
    ...overrides,
  } as unknown as IContextSnapshotService;
}

function createMockSessionsStore(overrides: Partial<SessionsStore> = {}): SessionsStore {
  return {
    replaceMessages: vi.fn().mockResolvedValue(0),
    ...overrides,
  } as unknown as SessionsStore;
}

const testSessionId = 'test-session-123';

describe('snapshot_list', () => {
  it('should return empty message when no snapshots exist', async () => {
    const call: ToolCall = {
      id: 'test-1',
      tool: 'snapshot_list',
      sessionId: testSessionId,
      parameters: {},
    };

    const service = createMockSnapshotService();

    const result = await executeSnapshotList(call, service, testSessionId);

    expect(result.success).toBe(true);
    expect(result.content[0]?.text).toContain('No snapshots available');
  });

  it('should list available snapshots', async () => {
    const call: ToolCall = {
      id: 'test-2',
      tool: 'snapshot_list',
      sessionId: testSessionId,
      parameters: { limit: 5 },
    };

    const mockSnapshots: ContextSnapshot[] = [
      {
        id: 'snapshot-1709000000',
        sessionId: testSessionId,
        timestamp: '2026-02-27T10:00:00.000Z',
        trigger: 'auto-compaction',
        messageCount: 42,
        messages: [],
      },
      {
        id: 'snapshot-1709100000',
        sessionId: testSessionId,
        timestamp: '2026-02-28T14:00:00.000Z',
        trigger: 'manual',
        messageCount: 30,
        messages: [],
      },
    ];

    const service = createMockSnapshotService({
      listSnapshots: vi.fn().mockResolvedValue(mockSnapshots),
    });

    const result = await executeSnapshotList(call, service, testSessionId);

    expect(result.success).toBe(true);
    expect(result.content[0]?.text).toContain('2 snapshot(s)');
    expect(result.content[0]?.text).toContain('snapshot-1709000000');
    expect(result.content[0]?.text).toContain('snapshot-1709100000');
    expect(result.content[0]?.text).toContain('42 messages');
    expect(result.content[0]?.text).toContain('auto-compaction');
    expect(result.content[0]?.text).toContain('manual');
    expect(service.listSnapshots).toHaveBeenCalledWith(testSessionId, { limit: 5 });
  });

  it('should use default limit of 10', async () => {
    const call: ToolCall = {
      id: 'test-3',
      tool: 'snapshot_list',
      sessionId: testSessionId,
      parameters: {},
    };

    const service = createMockSnapshotService({
      listSnapshots: vi.fn().mockResolvedValue([]),
    });

    await executeSnapshotList(call, service, testSessionId);

    expect(service.listSnapshots).toHaveBeenCalledWith(testSessionId, { limit: 10 });
  });

  it('should handle errors gracefully', async () => {
    const call: ToolCall = {
      id: 'test-4',
      tool: 'snapshot_list',
      sessionId: testSessionId,
      parameters: {},
    };

    const service = createMockSnapshotService({
      listSnapshots: vi.fn().mockRejectedValue(new Error('disk error')),
    });

    const result = await executeSnapshotList(call, service, testSessionId);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('SNAPSHOT_LIST_FAILED');
    expect(result.error?.message).toContain('disk error');
  });
});

describe('snapshot_restore', () => {
  it('should return error when snapshot not found by ID', async () => {
    const call: ToolCall = {
      id: 'test-5',
      tool: 'snapshot_restore',
      sessionId: testSessionId,
      parameters: { snapshot_id: 'nonexistent' },
    };

    const service = createMockSnapshotService({
      getSnapshot: vi.fn().mockResolvedValue(null),
    });
    const store = createMockSessionsStore();

    const result = await executeSnapshotRestore(call, service, store, testSessionId);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('SNAPSHOT_NOT_FOUND');
    expect(result.error?.message).toContain('nonexistent');
  });

  it('should return error when no snapshots exist (latest)', async () => {
    const call: ToolCall = {
      id: 'test-6',
      tool: 'snapshot_restore',
      sessionId: testSessionId,
      parameters: {},
    };

    const service = createMockSnapshotService({
      getLatestSnapshot: vi.fn().mockResolvedValue(null),
    });
    const store = createMockSessionsStore();

    const result = await executeSnapshotRestore(call, service, store, testSessionId);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('SNAPSHOT_NOT_FOUND');
  });

  it('should return error when snapshot has no messages', async () => {
    const call: ToolCall = {
      id: 'test-7',
      tool: 'snapshot_restore',
      sessionId: testSessionId,
      parameters: { snapshot_id: 'snapshot-empty' },
    };

    const service = createMockSnapshotService({
      getSnapshot: vi.fn().mockResolvedValue({
        id: 'snapshot-empty',
        sessionId: testSessionId,
        timestamp: '2026-02-27T10:00:00.000Z',
        trigger: 'manual',
        messageCount: 0,
        messages: [],
      }),
    });
    const store = createMockSessionsStore();

    const result = await executeSnapshotRestore(call, service, store, testSessionId);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('SNAPSHOT_EMPTY');
  });

  it('should restore snapshot by ID', async () => {
    const call: ToolCall = {
      id: 'test-8',
      tool: 'snapshot_restore',
      sessionId: testSessionId,
      parameters: { snapshot_id: 'snapshot-1709000000' },
    };

    const snapshotMessages = [
      { role: 'user' as const, content: 'Hello', id: 'msg-1', timestamp: 1709000000000 },
      { role: 'assistant' as const, content: 'Hi there!', id: 'msg-2', timestamp: 1709000001000 },
    ];

    const service = createMockSnapshotService({
      getSnapshot: vi.fn().mockResolvedValue({
        id: 'snapshot-1709000000',
        sessionId: testSessionId,
        timestamp: '2026-02-27T10:00:00.000Z',
        trigger: 'auto-compaction',
        messageCount: 2,
        messages: snapshotMessages,
      }),
    });
    const store = createMockSessionsStore();

    const result = await executeSnapshotRestore(call, service, store, testSessionId);

    expect(result.success).toBe(true);
    expect(result.content[0]?.text).toContain('Restored 2 messages');
    expect(result.content[0]?.text).toContain('snapshot-1709000000');
    expect(store.replaceMessages).toHaveBeenCalledWith(
      testSessionId,
      expect.arrayContaining([
        expect.objectContaining({ sessionId: testSessionId, role: 'user', content: 'Hello' }),
        expect.objectContaining({
          sessionId: testSessionId,
          role: 'assistant',
          content: 'Hi there!',
        }),
      ])
    );
  });

  it('should restore latest snapshot when no ID provided', async () => {
    const call: ToolCall = {
      id: 'test-9',
      tool: 'snapshot_restore',
      sessionId: testSessionId,
      parameters: {},
    };

    const service = createMockSnapshotService({
      getLatestSnapshot: vi.fn().mockResolvedValue({
        id: 'snapshot-latest',
        sessionId: testSessionId,
        timestamp: '2026-03-01T12:00:00.000Z',
        trigger: 'periodic',
        messageCount: 5,
        messages: [
          { role: 'user', content: 'Test message', id: 'msg-1', timestamp: 1709200000000 },
        ],
      }),
    });
    const store = createMockSessionsStore();

    const result = await executeSnapshotRestore(call, service, store, testSessionId);

    expect(result.success).toBe(true);
    expect(result.content[0]?.text).toContain('Restored 1 messages');
    expect(result.content[0]?.text).toContain('snapshot-latest');
    expect(service.getLatestSnapshot).toHaveBeenCalledWith(testSessionId);
  });

  it('should handle errors during restore', async () => {
    const call: ToolCall = {
      id: 'test-10',
      tool: 'snapshot_restore',
      sessionId: testSessionId,
      parameters: { snapshot_id: 'snapshot-error' },
    };

    const service = createMockSnapshotService({
      getSnapshot: vi.fn().mockResolvedValue({
        id: 'snapshot-error',
        sessionId: testSessionId,
        timestamp: '2026-02-27T10:00:00.000Z',
        trigger: 'manual',
        messageCount: 1,
        messages: [{ role: 'user', content: 'Test', id: 'msg-1' }],
      }),
    });
    const store = createMockSessionsStore({
      replaceMessages: vi.fn().mockRejectedValue(new Error('database locked')),
    });

    const result = await executeSnapshotRestore(call, service, store, testSessionId);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('SNAPSHOT_RESTORE_FAILED');
    expect(result.error?.message).toContain('database locked');
  });

  it('should handle content blocks in messages', async () => {
    const call: ToolCall = {
      id: 'test-11',
      tool: 'snapshot_restore',
      sessionId: testSessionId,
      parameters: { snapshot_id: 'snapshot-blocks' },
    };

    const service = createMockSnapshotService({
      getSnapshot: vi.fn().mockResolvedValue({
        id: 'snapshot-blocks',
        sessionId: testSessionId,
        timestamp: '2026-02-27T10:00:00.000Z',
        trigger: 'manual',
        messageCount: 1,
        messages: [
          {
            role: 'assistant',
            content: [{ type: 'text', text: 'Block content' }],
            id: 'msg-1',
          },
        ],
      }),
    });
    const store = createMockSessionsStore();

    const result = await executeSnapshotRestore(call, service, store, testSessionId);

    expect(result.success).toBe(true);
    // Content blocks should be serialized as JSON string
    expect(store.replaceMessages).toHaveBeenCalledWith(
      testSessionId,
      expect.arrayContaining([
        expect.objectContaining({
          content: JSON.stringify([{ type: 'text', text: 'Block content' }]),
        }),
      ])
    );
  });
});
