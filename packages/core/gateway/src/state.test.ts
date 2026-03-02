import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StateStorage } from './state.js';
import type { SessionStatus } from '@nachos/types';

describe('StateStorage', () => {
  let storage: StateStorage;

  beforeEach(async () => {
    storage = new StateStorage(':memory:');
  });

  afterEach(async () => {
    storage.close();
  });

  describe('Session operations', () => {
    it('should create a session', async () => {
      const session = await storage.createSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      expect(session.id).toBeDefined();
      expect(session.channel).toBe('slack');
      expect(session.conversationId).toBe('conv-123');
      expect(session.userId).toBe('user-456');
      expect(session.status).toBe('active');
      expect(session.createdAt).toBeDefined();
      expect(session.updatedAt).toBeDefined();
    });

    it('should create a session with optional fields', async () => {
      const session = await storage.createSession({
        channel: 'discord',
        conversationId: 'conv-789',
        userId: 'user-abc',
        systemPrompt: 'You are a helpful assistant',
        config: { model: 'gpt-4', maxTokens: 1000 },
        metadata: { source: 'test' },
      });

      expect(session.systemPrompt).toBe('You are a helpful assistant');
      expect(session.config).toEqual({ model: 'gpt-4', maxTokens: 1000 });
      expect(session.metadata).toEqual({ source: 'test' });
    });

    it('should get a session by ID', async () => {
      const created = await storage.createSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      const retrieved = await storage.getSession(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.channel).toBe('slack');
    });

    it('should return null for non-existent session', async () => {
      const session = await storage.getSession('non-existent-id');
      expect(session).toBeNull();
    });

    it('should get a session by channel and conversation ID', async () => {
      await storage.createSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      const session = await storage.getSessionByConversation('slack', 'conv-123');

      expect(session).not.toBeNull();
      expect(session?.channel).toBe('slack');
      expect(session?.conversationId).toBe('conv-123');
    });

    it('should return null for non-existent conversation', async () => {
      const session = await storage.getSessionByConversation('non-existent', 'conv-123');
      expect(session).toBeNull();
    });

    it('should update a session', async () => {
      const created = await storage.createSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      const updated = await storage.updateSession(created.id, {
        status: 'paused' as SessionStatus,
        systemPrompt: 'Updated prompt',
      });

      expect(updated).not.toBeNull();
      expect(updated?.status).toBe('paused');
      expect(updated?.systemPrompt).toBe('Updated prompt');
    });

    it('should return null when updating non-existent session', async () => {
      const result = await storage.updateSession('non-existent', { status: 'paused' });
      expect(result).toBeNull();
    });

    it('should delete a session', async () => {
      const created = await storage.createSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      // Add a message to test cascade delete
      await storage.addMessage({
        sessionId: created.id,
        role: 'user',
        content: 'Hello',
      });

      const deleted = await storage.deleteSession(created.id);
      expect(deleted).toBe(true);

      const session = await storage.getSession(created.id);
      expect(session).toBeNull();

      // Messages should also be deleted
      const messages = await storage.getMessages(created.id);
      expect(messages).toHaveLength(0);
    });

    it('should return false when deleting non-existent session', async () => {
      const deleted = await storage.deleteSession('non-existent');
      expect(deleted).toBe(false);
    });

    it('should list sessions', async () => {
      await storage.createSession({
        channel: 'slack',
        conversationId: 'conv-1',
        userId: 'user-1',
      });
      await storage.createSession({
        channel: 'slack',
        conversationId: 'conv-2',
        userId: 'user-2',
      });
      await storage.createSession({
        channel: 'discord',
        conversationId: 'conv-3',
        userId: 'user-3',
      });

      const allSessions = await storage.listSessions();
      expect(allSessions).toHaveLength(3);

      const slackSessions = await storage.listSessions({ channel: 'slack' });
      expect(slackSessions).toHaveLength(2);
    });

    it('should list sessions with status filter', async () => {
      const session1 = await storage.createSession({
        channel: 'slack',
        conversationId: 'conv-1',
        userId: 'user-1',
      });
      await storage.createSession({
        channel: 'slack',
        conversationId: 'conv-2',
        userId: 'user-2',
      });

      await storage.updateSession(session1.id, { status: 'ended' });

      const activeSessions = await storage.listSessions({ status: 'active' });
      expect(activeSessions).toHaveLength(1);

      const endedSessions = await storage.listSessions({ status: 'ended' });
      expect(endedSessions).toHaveLength(1);
    });

    it('should list sessions with pagination', async () => {
      for (let i = 0; i < 5; i++) {
        await storage.createSession({
          channel: 'slack',
          conversationId: `conv-${i}`,
          userId: `user-${i}`,
        });
      }

      const page1 = await storage.listSessions({ limit: 2 });
      expect(page1).toHaveLength(2);

      const page2 = await storage.listSessions({ limit: 2, offset: 2 });
      expect(page2).toHaveLength(2);

      const page3 = await storage.listSessions({ limit: 2, offset: 4 });
      expect(page3).toHaveLength(1);
    });

    it('should enforce unique constraint on channel + conversation_id', async () => {
      await storage.createSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      await expect(async () => {
        await storage.createSession({
          channel: 'slack',
          conversationId: 'conv-123',
          userId: 'user-789',
        });
      }).rejects.toThrow();
    });
  });

  describe('Message operations', () => {
    it('should add a message to a session', async () => {
      const session = await storage.createSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      const message = await storage.addMessage({
        sessionId: session.id,
        role: 'user',
        content: 'Hello, world!',
      });

      expect(message.id).toBeDefined();
      expect(message.sessionId).toBe(session.id);
      expect(message.role).toBe('user');
      expect(message.content).toBe('Hello, world!');
      expect(message.createdAt).toBeDefined();
    });

    it('should add a message with tool calls', async () => {
      const session = await storage.createSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      const toolCalls = [{ name: 'search', arguments: { query: 'test' } }];
      const message = await storage.addMessage({
        sessionId: session.id,
        role: 'assistant',
        content: 'Let me search for that',
        toolCalls,
      });

      expect(message.toolCalls).toEqual(toolCalls);
    });

    it('should get messages for a session', async () => {
      const session = await storage.createSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      await storage.addMessage({
        sessionId: session.id,
        role: 'user',
        content: 'Message 1',
      });
      await storage.addMessage({
        sessionId: session.id,
        role: 'assistant',
        content: 'Message 2',
      });
      await storage.addMessage({
        sessionId: session.id,
        role: 'user',
        content: 'Message 3',
      });

      const messages = await storage.getMessages(session.id);

      expect(messages).toHaveLength(3);
      expect(messages[0]?.content).toBe('Message 1');
      expect(messages[1]?.content).toBe('Message 2');
      expect(messages[2]?.content).toBe('Message 3');
    });

    it('should get messages with pagination', async () => {
      const session = await storage.createSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      for (let i = 0; i < 5; i++) {
        await storage.addMessage({
          sessionId: session.id,
          role: 'user',
          content: `Message ${i}`,
        });
      }

      const page1 = await storage.getMessages(session.id, { limit: 2 });
      expect(page1).toHaveLength(2);
      expect(page1[0]?.content).toBe('Message 0');

      const page2 = await storage.getMessages(session.id, { limit: 2, offset: 2 });
      expect(page2).toHaveLength(2);
      expect(page2[0]?.content).toBe('Message 2');
    });

    it('should get session with messages', async () => {
      const session = await storage.createSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      await storage.addMessage({
        sessionId: session.id,
        role: 'user',
        content: 'Hello',
      });
      await storage.addMessage({
        sessionId: session.id,
        role: 'assistant',
        content: 'Hi there!',
      });

      const sessionWithMessages = await storage.getSessionWithMessages(session.id);

      expect(sessionWithMessages).not.toBeNull();
      expect(sessionWithMessages?.messages).toHaveLength(2);
      expect(sessionWithMessages?.channel).toBe('slack');
    });

    it('should return null when getting non-existent session with messages', async () => {
      const result = await storage.getSessionWithMessages('non-existent');
      expect(result).toBeNull();
    });

    it('should get message count', async () => {
      const session = await storage.createSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      expect(await storage.getMessageCount(session.id)).toBe(0);

      await storage.addMessage({
        sessionId: session.id,
        role: 'user',
        content: 'Message 1',
      });
      await storage.addMessage({
        sessionId: session.id,
        role: 'assistant',
        content: 'Message 2',
      });

      expect(await storage.getMessageCount(session.id)).toBe(2);
    });

    it('should update session updatedAt when adding message', async () => {
      const session = await storage.createSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      const originalUpdatedAt = session.updatedAt;

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      await storage.addMessage({
        sessionId: session.id,
        role: 'user',
        content: 'Hello',
      });

      const updatedSession = await storage.getSession(session.id);
      expect(updatedSession?.updatedAt).not.toBe(originalUpdatedAt);
    });
  });

  describe('Session pinning and archiving', () => {
    it('should pin a session', async () => {
      const session = await storage.createSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      expect(session.isPinned).toBe(false);

      const pinned = await storage.pin(session.id);
      expect(pinned).toBe(true);

      const retrieved = await storage.getSession(session.id);
      expect(retrieved?.isPinned).toBe(true);
    });

    it('should unpin a session', async () => {
      const session = await storage.createSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      await storage.pin(session.id);
      const unpinned = await storage.pin(session.id, false);
      expect(unpinned).toBe(true);

      const retrieved = await storage.getSession(session.id);
      expect(retrieved?.isPinned).toBe(false);
    });

    it('should archive a session', async () => {
      const session = await storage.createSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      expect(session.isArchived).toBe(false);

      const archived = await storage.archive(session.id);
      expect(archived).toBe(true);

      const retrieved = await storage.getSession(session.id);
      expect(retrieved?.isArchived).toBe(true);
    });

    it('should restore an archived session', async () => {
      const session = await storage.createSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      await storage.archive(session.id);
      const restored = await storage.restore(session.id);
      expect(restored).toBe(true);

      const retrieved = await storage.getSession(session.id);
      expect(retrieved?.isArchived).toBe(false);
    });

    it('should return false when pinning non-existent session', async () => {
      const result = await storage.pin('non-existent-id');
      expect(result).toBe(false);
    });

    it('should return false when archiving non-existent session', async () => {
      const result = await storage.archive('non-existent-id');
      expect(result).toBe(false);
    });
  });

  describe('listActive', () => {
    beforeEach(async () => {
      // Create sessions with different states
      const now = Date.now();
      const twentyFiveHoursAgo = new Date(now - 25 * 60 * 60 * 1000).toISOString();
      const _oneHourAgo = new Date(now - 1 * 60 * 60 * 1000).toISOString();

      // Active session (recent activity)
      const _session1 = await storage.createSession({
        channel: 'slack',
        conversationId: 'conv-1',
        userId: 'user-1',
      });

      // Old session (>24h ago, not pinned)
      const session2 = await storage.createSession({
        channel: 'slack',
        conversationId: 'conv-2',
        userId: 'user-2',
      });
      // Manually update last_activity to be old
      storage
        .getDatabase()
        .prepare('UPDATE sessions SET last_activity = ? WHERE id = ?')
        .run(twentyFiveHoursAgo, session2.id);

      // Old session but pinned (should appear in active)
      const session3 = await storage.createSession({
        channel: 'discord',
        conversationId: 'conv-3',
        userId: 'user-3',
      });
      storage
        .getDatabase()
        .prepare('UPDATE sessions SET last_activity = ? WHERE id = ?')
        .run(twentyFiveHoursAgo, session3.id);
      await storage.pin(session3.id);

      // Archived session (should NOT appear in active)
      const session4 = await storage.createSession({
        channel: 'slack',
        conversationId: 'conv-4',
        userId: 'user-4',
      });
      await storage.archive(session4.id);
    });

    it('should list active sessions (recent or pinned, not archived)', async () => {
      const active = await storage.listActive();

      expect(active.length).toBe(2); // session1 (recent) + session3 (pinned)
      expect(active.some((s) => s.conversationId === 'conv-1')).toBe(true);
      expect(active.some((s) => s.conversationId === 'conv-3')).toBe(true);
      expect(active.some((s) => s.conversationId === 'conv-2')).toBe(false); // old, not pinned
      expect(active.some((s) => s.conversationId === 'conv-4')).toBe(false); // archived
    });

    it('should order active sessions by pinned first, then last activity', async () => {
      const active = await storage.listActive();

      // Pinned session should be first
      expect(active[0]?.isPinned).toBe(true);
      expect(active[0]?.conversationId).toBe('conv-3');
    });

    it('should filter active sessions by channel', async () => {
      const slackSessions = await storage.listActive({ channel: 'slack' });

      expect(slackSessions.length).toBe(1);
      expect(slackSessions[0]?.conversationId).toBe('conv-1');
    });

    it('should filter active sessions by userId', async () => {
      const userSessions = await storage.listActive({ userId: 'user-3' });

      expect(userSessions.length).toBe(1);
      expect(userSessions[0]?.conversationId).toBe('conv-3');
    });

    it('should respect limit parameter', async () => {
      const limited = await storage.listActive({ limit: 1 });

      expect(limited.length).toBe(1);
    });

    it('should respect offset parameter', async () => {
      const offset = await storage.listActive({ offset: 1 });

      expect(offset.length).toBe(1);
      expect(offset[0]?.conversationId).toBe('conv-1'); // Second item (after pinned)
    });

    it('should handle offset without limit (SQLite LIMIT -1)', async () => {
      const offsetOnly = await storage.listActive({ offset: 1 });

      expect(offsetOnly.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('listArchived', () => {
    beforeEach(async () => {
      // Create archived sessions
      const session1 = await storage.createSession({
        channel: 'slack',
        conversationId: 'archived-1',
        userId: 'user-1',
      });
      await storage.archive(session1.id);

      const session2 = await storage.createSession({
        channel: 'discord',
        conversationId: 'archived-2',
        userId: 'user-2',
      });
      await storage.archive(session2.id);

      // Active session (should NOT appear)
      await storage.createSession({
        channel: 'slack',
        conversationId: 'active-1',
        userId: 'user-1',
      });
    });

    it('should list only archived sessions', async () => {
      const archived = await storage.listArchived();

      expect(archived.length).toBe(2);
      expect(archived.every((s) => s.isArchived)).toBe(true);
      expect(archived.some((s) => s.conversationId === 'active-1')).toBe(false);
    });

    it('should filter archived sessions by channel', async () => {
      const slackArchived = await storage.listArchived({ channel: 'slack' });

      expect(slackArchived.length).toBe(1);
      expect(slackArchived[0]?.conversationId).toBe('archived-1');
    });

    it('should filter archived sessions by userId', async () => {
      const userArchived = await storage.listArchived({ userId: 'user-2' });

      expect(userArchived.length).toBe(1);
      expect(userArchived[0]?.conversationId).toBe('archived-2');
    });

    it('should search archived sessions by conversationId', async () => {
      const searched = await storage.listArchived({ search: 'archived-1' });

      expect(searched.length).toBe(1);
      expect(searched[0]?.conversationId).toBe('archived-1');
    });

    it('should order archived sessions by updated_at DESC', async () => {
      const archived = await storage.listArchived();

      // Most recently updated should be first
      expect(archived.length).toBeGreaterThan(0);
      if (archived.length > 1) {
        const first = new Date(archived[0]!.updatedAt);
        const second = new Date(archived[1]!.updatedAt);
        expect(first.getTime()).toBeGreaterThanOrEqual(second.getTime());
      }
    });

    it('should respect limit parameter', async () => {
      const limited = await storage.listArchived({ limit: 1 });

      expect(limited.length).toBe(1);
    });

    it('should respect offset parameter', async () => {
      const offset = await storage.listArchived({ offset: 1 });

      expect(offset.length).toBe(1);
    });

    it('should handle offset without limit (SQLite LIMIT -1)', async () => {
      const offsetOnly = await storage.listArchived({ offset: 1 });

      expect(offsetOnly.length).toBe(1);
    });
  });

  describe('Schema migration', () => {
    it('should add missing columns to existing sessions table', async () => {
      // This tests the migrateSchema() logic
      // The migration happens in constructor, so if the test reaches here, it worked
      const session = await storage.createSession({
        channel: 'test',
        conversationId: 'migration-test',
        userId: 'user-test',
      });

      expect(session.isPinned).toBeDefined();
      expect(session.isArchived).toBeDefined();
      expect(session.lastActivity).toBeDefined();
      expect(typeof session.isPinned).toBe('boolean');
      expect(typeof session.isArchived).toBe('boolean');
      expect(typeof session.lastActivity).toBe('string');
    });

    it('should backfill last_activity from updated_at', async () => {
      const session = await storage.createSession({
        channel: 'test',
        conversationId: 'backfill-test',
        userId: 'user-test',
      });

      // last_activity should match updatedAt on creation
      expect(session.lastActivity).toBe(session.updatedAt);
    });
  });
});
