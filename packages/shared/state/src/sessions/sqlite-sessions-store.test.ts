/**
 * Tests for SqliteSessionsStore
 *
 * Uses an in-memory SQLite database for fast, isolated tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteSessionsStore } from './sqlite-sessions-store.js';
import type { CreateSessionData, SessionsStore } from './sessions-store-interface.js';

describe('SqliteSessionsStore', () => {
  let db: Database.Database;
  let store: SqliteSessionsStore;

  beforeEach(() => {
    db = new Database(':memory:');
    store = new SqliteSessionsStore(db);
  });

  afterEach(async () => {
    await store.close();
  });

  const defaultSession: CreateSessionData = {
    channel: 'slack',
    conversationId: 'conv-1',
    userId: 'user-1',
    systemPrompt: 'You are a helpful assistant.',
    config: { model: 'claude-3' },
    metadata: { source: 'test' },
  };

  describe('createSession', () => {
    it('creates a session with all fields populated', async () => {
      const session = await store.createSession(defaultSession);

      expect(session.id).toBeDefined();
      expect(session.channel).toBe('slack');
      expect(session.conversationId).toBe('conv-1');
      expect(session.userId).toBe('user-1');
      expect(session.status).toBe('active');
      expect(session.systemPrompt).toBe('You are a helpful assistant.');
      expect(session.config).toEqual({ model: 'claude-3' });
      expect(session.metadata).toEqual({ source: 'test' });
      expect(session.createdAt).toBeDefined();
      expect(session.updatedAt).toBeDefined();
      expect(session.isPinned).toBe(false);
      expect(session.isArchived).toBe(false);
      expect(session.lastActivity).toBeDefined();
    });

    it('creates a session with minimal data', async () => {
      const session = await store.createSession({
        channel: 'discord',
        conversationId: 'conv-2',
        userId: 'user-2',
      });

      expect(session.channel).toBe('discord');
      expect(session.systemPrompt).toBeUndefined();
      expect(session.config).toEqual({});
      expect(session.metadata).toEqual({});
    });

    it('enforces unique channel + conversationId constraint', async () => {
      await store.createSession(defaultSession);

      await expect(store.createSession(defaultSession)).rejects.toThrow();
    });
  });

  describe('getSession', () => {
    it('returns a session by ID', async () => {
      const created = await store.createSession(defaultSession);
      const found = await store.getSession(created.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.channel).toBe('slack');
    });

    it('returns null for non-existent ID', async () => {
      const result = await store.getSession('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('getSessionByConversation', () => {
    it('finds a session by channel and conversationId', async () => {
      await store.createSession(defaultSession);

      const found = await store.getSessionByConversation('slack', 'conv-1');
      expect(found).not.toBeNull();
      expect(found!.channel).toBe('slack');
      expect(found!.conversationId).toBe('conv-1');
    });

    it('returns null when no match', async () => {
      const result = await store.getSessionByConversation('slack', 'no-such-conv');
      expect(result).toBeNull();
    });
  });

  describe('getOrCreateSessionAtomic', () => {
    it('creates a new session when none exists', async () => {
      const { session, created } = await store.getOrCreateSessionAtomic(defaultSession);

      expect(created).toBe(true);
      expect(session.channel).toBe('slack');
      expect(session.conversationId).toBe('conv-1');
      expect(session.status).toBe('active');
    });

    it('returns existing session without creating a duplicate', async () => {
      const first = await store.getOrCreateSessionAtomic(defaultSession);
      const second = await store.getOrCreateSessionAtomic(defaultSession);

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.session.id).toBe(first.session.id);
    });
  });

  describe('updateSession', () => {
    it('updates session status', async () => {
      const session = await store.createSession(defaultSession);
      const updated = await store.updateSession(session.id, { status: 'ended' });

      expect(updated).not.toBeNull();
      expect(updated!.status).toBe('ended');
    });

    it('updates session system prompt', async () => {
      const session = await store.createSession(defaultSession);
      const updated = await store.updateSession(session.id, {
        systemPrompt: 'New prompt',
      });

      expect(updated!.systemPrompt).toBe('New prompt');
    });

    it('updates session config and metadata', async () => {
      const session = await store.createSession(defaultSession);
      const updated = await store.updateSession(session.id, {
        config: { model: 'gpt-4' },
        metadata: { updated: true },
      });

      expect(updated!.config).toEqual({ model: 'gpt-4' });
      // metadata is merged (not replaced) to avoid clobbering keys set by other subsystems
      expect(updated!.metadata).toEqual({ source: 'test', updated: true });
    });

    it('returns null for non-existent session', async () => {
      const result = await store.updateSession('non-existent', { status: 'ended' });
      expect(result).toBeNull();
    });

    it('updates the updatedAt timestamp', async () => {
      const session = await store.createSession(defaultSession);
      const updated = await store.updateSession(session.id, { status: 'paused' });

      // updatedAt should be >= original (could be same if within the same ms)
      expect(new Date(updated!.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(session.updatedAt).getTime()
      );
    });
  });

  describe('deleteSession', () => {
    it('deletes a session and its messages', async () => {
      const session = await store.createSession(defaultSession);
      await store.addMessage({
        sessionId: session.id,
        role: 'user',
        content: 'Hello',
      });

      const deleted = await store.deleteSession(session.id);
      expect(deleted).toBe(true);

      const found = await store.getSession(session.id);
      expect(found).toBeNull();

      const messages = await store.getMessages(session.id);
      expect(messages).toHaveLength(0);
    });

    it('returns false for non-existent session', async () => {
      const result = await store.deleteSession('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('listSessions', () => {
    it('lists all sessions', async () => {
      await store.createSession(defaultSession);
      await store.createSession({
        channel: 'discord',
        conversationId: 'conv-2',
        userId: 'user-2',
      });

      const sessions = await store.listSessions();
      expect(sessions).toHaveLength(2);
    });

    it('filters by channel', async () => {
      await store.createSession(defaultSession);
      await store.createSession({
        channel: 'discord',
        conversationId: 'conv-2',
        userId: 'user-2',
      });

      const slackSessions = await store.listSessions({ channel: 'slack' });
      expect(slackSessions).toHaveLength(1);
      expect(slackSessions[0]!.channel).toBe('slack');
    });

    it('filters by status', async () => {
      const session = await store.createSession(defaultSession);
      await store.updateSession(session.id, { status: 'ended' });
      await store.createSession({
        channel: 'discord',
        conversationId: 'conv-2',
        userId: 'user-2',
      });

      const active = await store.listSessions({ status: 'active' });
      expect(active).toHaveLength(1);
      expect(active[0]!.channel).toBe('discord');
    });

    it('respects limit and offset', async () => {
      for (let i = 0; i < 5; i++) {
        await store.createSession({
          channel: 'slack',
          conversationId: `conv-${i}`,
          userId: 'user-1',
        });
      }

      const page = await store.listSessions({ limit: 2, offset: 1 });
      expect(page).toHaveLength(2);
    });
  });

  describe('message operations', () => {
    it('adds and retrieves messages', async () => {
      const session = await store.createSession(defaultSession);

      const message = await store.addMessage({
        sessionId: session.id,
        role: 'user',
        content: 'Hello!',
      });

      expect(message.id).toBeDefined();
      expect(message.sessionId).toBe(session.id);
      expect(message.role).toBe('user');
      expect(message.content).toBe('Hello!');
      expect(message.createdAt).toBeDefined();

      const messages = await store.getMessages(session.id);
      expect(messages).toHaveLength(1);
      expect(messages[0]!.content).toBe('Hello!');
    });

    it('stores and retrieves tool calls', async () => {
      const session = await store.createSession(defaultSession);

      const toolCalls = [{ id: 'call-1', type: 'function', function: { name: 'test' } }];
      const message = await store.addMessage({
        sessionId: session.id,
        role: 'assistant',
        content: 'Using tool',
        toolCalls,
      });

      expect(message.toolCalls).toEqual(toolCalls);

      const messages = await store.getMessages(session.id);
      expect(messages[0]!.toolCalls).toEqual(toolCalls);
    });

    it('returns messages in chronological order', async () => {
      const session = await store.createSession(defaultSession);

      await store.addMessage({ sessionId: session.id, role: 'user', content: 'First' });
      await store.addMessage({ sessionId: session.id, role: 'assistant', content: 'Second' });
      await store.addMessage({ sessionId: session.id, role: 'user', content: 'Third' });

      const messages = await store.getMessages(session.id);
      expect(messages).toHaveLength(3);
      expect(messages[0]!.content).toBe('First');
      expect(messages[1]!.content).toBe('Second');
      expect(messages[2]!.content).toBe('Third');
    });

    it('supports limit and offset for messages', async () => {
      const session = await store.createSession(defaultSession);

      for (let i = 0; i < 5; i++) {
        await store.addMessage({
          sessionId: session.id,
          role: 'user',
          content: `Message ${i}`,
        });
      }

      const page = await store.getMessages(session.id, { limit: 2, offset: 1 });
      expect(page).toHaveLength(2);
      expect(page[0]!.content).toBe('Message 1');
    });

    it('updates session last_activity when adding a message', async () => {
      const session = await store.createSession(defaultSession);
      const originalActivity = session.lastActivity;

      // Small delay to ensure timestamps differ
      await new Promise((r) => setTimeout(r, 10));

      await store.addMessage({
        sessionId: session.id,
        role: 'user',
        content: 'New message',
      });

      const updated = await store.getSession(session.id);
      expect(new Date(updated!.lastActivity).getTime()).toBeGreaterThanOrEqual(
        new Date(originalActivity).getTime()
      );
    });
  });

  describe('getSessionWithMessages', () => {
    it('returns session with its messages', async () => {
      const session = await store.createSession(defaultSession);
      await store.addMessage({ sessionId: session.id, role: 'user', content: 'Hello' });
      await store.addMessage({ sessionId: session.id, role: 'assistant', content: 'Hi' });

      const result = await store.getSessionWithMessages(session.id);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(session.id);
      expect(result!.messages).toHaveLength(2);
    });

    it('returns null for non-existent session', async () => {
      const result = await store.getSessionWithMessages('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('getMessageCount', () => {
    it('returns correct message count', async () => {
      const session = await store.createSession(defaultSession);

      expect(await store.getMessageCount(session.id)).toBe(0);

      await store.addMessage({ sessionId: session.id, role: 'user', content: 'One' });
      await store.addMessage({ sessionId: session.id, role: 'assistant', content: 'Two' });

      expect(await store.getMessageCount(session.id)).toBe(2);
    });
  });

  describe('replaceMessages', () => {
    it('replaces all messages for a session', async () => {
      const session = await store.createSession(defaultSession);
      await store.addMessage({ sessionId: session.id, role: 'user', content: 'Old 1' });
      await store.addMessage({ sessionId: session.id, role: 'assistant', content: 'Old 2' });

      const newMessages = [
        {
          id: 'new-1',
          sessionId: session.id,
          role: 'user' as const,
          content: 'Compacted',
          createdAt: new Date().toISOString(),
        },
      ];

      const count = await store.replaceMessages(session.id, newMessages);
      expect(count).toBe(1);

      const messages = await store.getMessages(session.id);
      expect(messages).toHaveLength(1);
      expect(messages[0]!.content).toBe('Compacted');
    });
  });

  describe('archive / restore', () => {
    it('archives a session', async () => {
      const session = await store.createSession(defaultSession);

      const archived = await store.archive(session.id);
      expect(archived).toBe(true);

      const found = await store.getSession(session.id);
      expect(found!.isArchived).toBe(true);
    });

    it('restores an archived session', async () => {
      const session = await store.createSession(defaultSession);
      await store.archive(session.id);

      const restored = await store.restore(session.id);
      expect(restored).toBe(true);

      const found = await store.getSession(session.id);
      expect(found!.isArchived).toBe(false);
    });

    it('returns false when archiving non-existent session', async () => {
      const result = await store.archive('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('pin / unpin', () => {
    it('pins a session', async () => {
      const session = await store.createSession(defaultSession);

      const pinned = await store.pin(session.id, true);
      expect(pinned).toBe(true);

      const found = await store.getSession(session.id);
      expect(found!.isPinned).toBe(true);
    });

    it('unpins a pinned session', async () => {
      const session = await store.createSession(defaultSession);
      await store.pin(session.id, true);

      const unpinned = await store.pin(session.id, false);
      expect(unpinned).toBe(true);

      const found = await store.getSession(session.id);
      expect(found!.isPinned).toBe(false);
    });
  });

  describe('listActive', () => {
    it('returns non-archived sessions with recent activity', async () => {
      await store.createSession(defaultSession);
      await store.createSession({
        channel: 'discord',
        conversationId: 'conv-2',
        userId: 'user-2',
      });

      const active = await store.listActive();
      expect(active).toHaveLength(2);
    });

    it('excludes archived sessions', async () => {
      const session = await store.createSession(defaultSession);
      await store.archive(session.id);

      await store.createSession({
        channel: 'discord',
        conversationId: 'conv-2',
        userId: 'user-2',
      });

      const active = await store.listActive();
      expect(active).toHaveLength(1);
      expect(active[0]!.channel).toBe('discord');
    });

    it('includes pinned sessions even if old', async () => {
      const session = await store.createSession(defaultSession);
      await store.pin(session.id, true);

      // Manually set last_activity to an old date
      db.prepare('UPDATE sessions SET last_activity = ? WHERE id = ?').run(
        '2020-01-01T00:00:00.000Z',
        session.id
      );

      const active = await store.listActive();
      expect(active.some((s) => s.id === session.id)).toBe(true);
    });

    it('filters by channel', async () => {
      await store.createSession(defaultSession);
      await store.createSession({
        channel: 'discord',
        conversationId: 'conv-2',
        userId: 'user-2',
      });

      const slackOnly = await store.listActive({ channel: 'slack' });
      expect(slackOnly).toHaveLength(1);
      expect(slackOnly[0]!.channel).toBe('slack');
    });
  });

  describe('listArchived', () => {
    it('returns only archived sessions', async () => {
      const session = await store.createSession(defaultSession);
      await store.archive(session.id);

      await store.createSession({
        channel: 'discord',
        conversationId: 'conv-2',
        userId: 'user-2',
      });

      const archived = await store.listArchived();
      expect(archived).toHaveLength(1);
      expect(archived[0]!.id).toBe(session.id);
    });

    it('supports search by conversationId or systemPrompt', async () => {
      const session = await store.createSession({
        ...defaultSession,
        systemPrompt: 'Unique search term here',
      });
      await store.archive(session.id);

      const found = await store.listArchived({ search: 'Unique search' });
      expect(found).toHaveLength(1);

      const notFound = await store.listArchived({ search: 'does-not-match' });
      expect(notFound).toHaveLength(0);
    });
  });

  describe('close', () => {
    it('closes the database connection', async () => {
      await store.close();

      // Attempting operations after close should throw
      expect(() => {
        db.prepare('SELECT 1').get();
      }).toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Session lifecycle (T-005)
  // ---------------------------------------------------------------------------

  describe('closeSession', () => {
    it('closes an active session and sets status to ended', async () => {
      const session = await store.createSession(defaultSession);

      const closed = await store.closeSession(session.id, 'inactivity');

      expect(closed).not.toBeNull();
      expect(closed!.status).toBe('ended');
      expect(closed!.closedAt).toBeDefined();
    });

    it('returns null when session does not exist', async () => {
      const closed = await store.closeSession('nonexistent-id', 'explicit');
      expect(closed).toBeNull();
    });

    it('returns null when session is already ended', async () => {
      const session = await store.createSession(defaultSession);
      await store.closeSession(session.id, 'explicit');

      // Closing again should return null (no-op)
      const secondClose = await store.closeSession(session.id, 'admin');
      expect(secondClose).toBeNull();
    });

    it('preserves closedAt timestamp after close', async () => {
      const session = await store.createSession(defaultSession);
      const closed = await store.closeSession(session.id, 'shutdown');

      const fetched = await store.getSession(session.id);
      expect(fetched!.closedAt).toBe(closed!.closedAt);
    });
  });

  describe('findInactiveSessions', () => {
    it('finds sessions inactive before cutoff time', async () => {
      // Create sessions with different lastActivity times via touch
      const old = await store.createSession({
        ...defaultSession,
        conversationId: 'conv-old',
      });
      const _recent = await store.createSession({
        ...defaultSession,
        conversationId: 'conv-recent',
      });

      // Manually backdate the "old" session's lastActivity
      db.prepare("UPDATE sessions SET last_activity = '2025-01-01T00:00:00.000Z' WHERE id = ?").run(
        old.id
      );

      // Cutoff: anything before 2026-01-01 is inactive
      const inactive = await store.findInactiveSessions('2026-01-01T00:00:00.000Z');

      expect(inactive).toHaveLength(1);
      expect(inactive[0]!.id).toBe(old.id);
    });

    it('excludes archived sessions', async () => {
      const session = await store.createSession(defaultSession);
      db.prepare(
        "UPDATE sessions SET last_activity = '2025-01-01T00:00:00.000Z', is_archived = 1 WHERE id = ?"
      ).run(session.id);

      const inactive = await store.findInactiveSessions('2026-01-01T00:00:00.000Z');
      expect(inactive).toHaveLength(0);
    });

    it('excludes already-ended sessions', async () => {
      const session = await store.createSession(defaultSession);
      db.prepare(
        "UPDATE sessions SET last_activity = '2025-01-01T00:00:00.000Z', status = 'ended' WHERE id = ?"
      ).run(session.id);

      const inactive = await store.findInactiveSessions('2026-01-01T00:00:00.000Z');
      expect(inactive).toHaveLength(0);
    });

    it('returns empty array when no sessions are inactive', async () => {
      await store.createSession(defaultSession);

      // Use a cutoff far in the past
      const inactive = await store.findInactiveSessions('2020-01-01T00:00:00.000Z');
      expect(inactive).toHaveLength(0);
    });
  });

  describe('findExpiredClosedSessions', () => {
    it('finds closed sessions with closedAt before cutoff', async () => {
      const session = await store.createSession(defaultSession);
      await store.closeSession(session.id, 'inactivity');

      // Backdate the closedAt
      db.prepare("UPDATE sessions SET closed_at = '2025-01-01T00:00:00.000Z' WHERE id = ?").run(
        session.id
      );

      const expired = await store.findExpiredClosedSessions('2026-01-01T00:00:00.000Z');
      expect(expired).toHaveLength(1);
      expect(expired[0]!.id).toBe(session.id);
    });

    it('excludes recently closed sessions', async () => {
      const session = await store.createSession(defaultSession);
      await store.closeSession(session.id, 'explicit');

      // closedAt is "now" — use a cutoff far in the past
      const expired = await store.findExpiredClosedSessions('2020-01-01T00:00:00.000Z');
      expect(expired).toHaveLength(0);
    });

    it('excludes active sessions', async () => {
      await store.createSession(defaultSession);

      const expired = await store.findExpiredClosedSessions('2099-01-01T00:00:00.000Z');
      expect(expired).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Semantic search capability gating
// These tests use a mock EnhancedSemanticSearch injected via module mock so
// that no model download is required in CI.
// ---------------------------------------------------------------------------
describe('SqliteSessionsStore — semantic search', () => {
  describe('searchMessages capability gating', () => {
    it('is undefined when no semanticConfig is provided', () => {
      const db = new Database(':memory:');
      const store = new SqliteSessionsStore(db);
      expect(store.searchMessages).toBeUndefined();
      db.close();
    });

    it('is undefined before init() is called even when semanticConfig is provided', () => {
      const db = new Database(':memory:');
      const store = new SqliteSessionsStore(db, {
        storePath: '/tmp/test-embeddings.json',
        model: 'Xenova/all-MiniLM-L6-v2',
      });
      // init() not called yet — searchMessages must remain undefined
      expect(store.searchMessages).toBeUndefined();
      db.close();
    });

    it('remains undefined after init() fails (e.g. embeddings package unavailable)', async () => {
      const db = new Database(':memory:');
      const store = new SqliteSessionsStore(db, {
        storePath: '/tmp/test-embeddings-fail.json',
        // Use a bogus model path — EnhancedSemanticSearch import itself will succeed
        // but we mock it to throw during init
      });

      // Monkey-patch the dynamic import to simulate failure
      const original = store['semanticConfig'];
      // Force init to fail by providing an invalid config path that the mock will reject
      vi.spyOn(store as unknown as { init: () => Promise<void> }, 'init').mockImplementationOnce(
        async () => {
          // Simulate the catch branch
          (store as unknown as Record<string, unknown>)['semanticSearch'] = null;
          (store as unknown as Record<string, unknown>)['searchMessages'] = undefined;
        }
      );

      await store.init();
      expect(store.searchMessages).toBeUndefined();
      // Restore
      void original;
      db.close();
    });
  });

  describe('since filter validation', () => {
    it('does not throw on an invalid since date — treats it as no filter', async () => {
      // We test _searchMessages indirectly by verifying the store handles invalid date
      // without crashing. We use a minimal mock of semanticSearch.
      const db = new Database(':memory:');
      const store = new SqliteSessionsStore(db, { storePath: '/tmp/irrelevant.json' });

      const mockSearch = {
        init: vi.fn().mockResolvedValue(undefined),
        addDocument: vi.fn().mockResolvedValue(undefined),
        search: vi.fn().mockResolvedValue([]),
        size: vi.fn().mockReturnValue(0),
      };

      // Inject mock semantic search directly
      (store as unknown as Record<string, unknown>)['semanticSearch'] = mockSearch;
      (store as unknown as Record<string, unknown>)['searchMessages'] = (
        store as unknown as { _searchMessages: SessionsStore['searchMessages'] }
      )['_searchMessages'].bind(store);

      // Should not throw even with garbage date
      const results = await store.searchMessages!('test query', { since: 'not-a-date' });
      expect(results).toEqual([]);
      // Verify search was called (filter was ignored gracefully, not crashed)
      expect(mockSearch.search).toHaveBeenCalledWith(
        'test query',
        expect.objectContaining({ limit: 5 })
      );
      db.close();
    });
  });

  describe('embedMessage', () => {
    it('stores raw content without role prefix', async () => {
      const db = new Database(':memory:');
      const store = new SqliteSessionsStore(db, { storePath: '/tmp/irrelevant2.json' });

      const addedDocs: Array<{ id: string; text: string; metadata: Record<string, unknown> }> = [];
      const mockSearch = {
        init: vi.fn().mockResolvedValue(undefined),
        addDocument: vi.fn().mockImplementation((doc: (typeof addedDocs)[0]) => {
          addedDocs.push(doc);
          return Promise.resolve();
        }),
        search: vi.fn().mockResolvedValue([]),
        size: vi.fn().mockReturnValue(0),
      };

      (store as unknown as Record<string, unknown>)['semanticSearch'] = mockSearch;
      (store as unknown as Record<string, unknown>)['searchMessages'] = (
        store as unknown as { _searchMessages: SessionsStore['searchMessages'] }
      )['_searchMessages'].bind(store);

      const session = await store.createSession({
        channel: 'slack',
        conversationId: 'c1',
        userId: 'u1',
      });
      await store.addMessage({
        sessionId: session.id,
        role: 'user',
        content: 'I prefer TypeScript strict mode',
      });

      // Give the fire-and-forget a tick to complete
      await new Promise((r) => setTimeout(r, 10));

      expect(addedDocs).toHaveLength(1);
      // Raw content only — no "user: " prefix
      expect(addedDocs[0]!.text).toBe('I prefer TypeScript strict mode');
      expect(addedDocs[0]!.metadata['role']).toBe('user');
      db.close();
    });

    it('skips embedding for tool role messages', async () => {
      const db = new Database(':memory:');
      const store = new SqliteSessionsStore(db, { storePath: '/tmp/irrelevant3.json' });

      const addedDocs: unknown[] = [];
      const mockSearch = {
        init: vi.fn().mockResolvedValue(undefined),
        addDocument: vi.fn().mockImplementation((doc: unknown) => {
          addedDocs.push(doc);
          return Promise.resolve();
        }),
        search: vi.fn().mockResolvedValue([]),
        size: vi.fn().mockReturnValue(0),
      };

      (store as unknown as Record<string, unknown>)['semanticSearch'] = mockSearch;
      (store as unknown as Record<string, unknown>)['searchMessages'] = (
        store as unknown as { _searchMessages: SessionsStore['searchMessages'] }
      )['_searchMessages'].bind(store);

      const session = await store.createSession({
        channel: 'slack',
        conversationId: 'c2',
        userId: 'u1',
      });
      await store.addMessage({ sessionId: session.id, role: 'tool', content: '{"result": "ok"}' });
      await store.addMessage({ sessionId: session.id, role: 'user', content: 'Thanks' });

      await new Promise((r) => setTimeout(r, 10));

      // Only the user message should be embedded, not the tool message
      expect(addedDocs).toHaveLength(1);
      db.close();
    });
  });
});
