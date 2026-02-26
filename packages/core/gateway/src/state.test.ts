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
});
