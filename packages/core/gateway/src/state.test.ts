import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StateStorage } from './state.js';
import type { SessionStatus } from '@nachos/types';

describe('StateStorage', () => {
  let storage: StateStorage;

  beforeEach(() => {
    storage = new StateStorage(':memory:');
  });

  afterEach(() => {
    storage.close();
  });

  describe('Session operations', () => {
    it('should create a session', () => {
      const session = storage.createSession({
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

    it('should create a session with optional fields', () => {
      const session = storage.createSession({
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

    it('should get a session by ID', () => {
      const created = storage.createSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      const retrieved = storage.getSession(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.channel).toBe('slack');
    });

    it('should return null for non-existent session', () => {
      const session = storage.getSession('non-existent-id');
      expect(session).toBeNull();
    });

    it('should get a session by channel and conversation ID', () => {
      storage.createSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      const session = storage.getSessionByConversation('slack', 'conv-123');

      expect(session).not.toBeNull();
      expect(session?.channel).toBe('slack');
      expect(session?.conversationId).toBe('conv-123');
    });

    it('should return null for non-existent conversation', () => {
      const session = storage.getSessionByConversation('non-existent', 'conv-123');
      expect(session).toBeNull();
    });

    it('should update a session', () => {
      const created = storage.createSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      const updated = storage.updateSession(created.id, {
        status: 'paused' as SessionStatus,
        systemPrompt: 'Updated prompt',
      });

      expect(updated).not.toBeNull();
      expect(updated?.status).toBe('paused');
      expect(updated?.systemPrompt).toBe('Updated prompt');
    });

    it('should return null when updating non-existent session', () => {
      const result = storage.updateSession('non-existent', { status: 'paused' });
      expect(result).toBeNull();
    });

    it('should delete a session', () => {
      const created = storage.createSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      // Add a message to test cascade delete
      storage.addMessage({
        sessionId: created.id,
        role: 'user',
        content: 'Hello',
      });

      const deleted = storage.deleteSession(created.id);
      expect(deleted).toBe(true);

      const session = storage.getSession(created.id);
      expect(session).toBeNull();

      // Messages should also be deleted
      const messages = storage.getMessages(created.id);
      expect(messages).toHaveLength(0);
    });

    it('should return false when deleting non-existent session', () => {
      const deleted = storage.deleteSession('non-existent');
      expect(deleted).toBe(false);
    });

    it('should list sessions', () => {
      storage.createSession({
        channel: 'slack',
        conversationId: 'conv-1',
        userId: 'user-1',
      });
      storage.createSession({
        channel: 'slack',
        conversationId: 'conv-2',
        userId: 'user-2',
      });
      storage.createSession({
        channel: 'discord',
        conversationId: 'conv-3',
        userId: 'user-3',
      });

      const allSessions = storage.listSessions();
      expect(allSessions).toHaveLength(3);

      const slackSessions = storage.listSessions({ channel: 'slack' });
      expect(slackSessions).toHaveLength(2);
    });

    it('should list sessions with status filter', () => {
      const session1 = storage.createSession({
        channel: 'slack',
        conversationId: 'conv-1',
        userId: 'user-1',
      });
      storage.createSession({
        channel: 'slack',
        conversationId: 'conv-2',
        userId: 'user-2',
      });

      storage.updateSession(session1.id, { status: 'ended' });

      const activeSessions = storage.listSessions({ status: 'active' });
      expect(activeSessions).toHaveLength(1);

      const endedSessions = storage.listSessions({ status: 'ended' });
      expect(endedSessions).toHaveLength(1);
    });

    it('should list sessions with pagination', () => {
      for (let i = 0; i < 5; i++) {
        storage.createSession({
          channel: 'slack',
          conversationId: `conv-${i}`,
          userId: `user-${i}`,
        });
      }

      const page1 = storage.listSessions({ limit: 2 });
      expect(page1).toHaveLength(2);

      const page2 = storage.listSessions({ limit: 2, offset: 2 });
      expect(page2).toHaveLength(2);

      const page3 = storage.listSessions({ limit: 2, offset: 4 });
      expect(page3).toHaveLength(1);
    });

    it('should enforce unique constraint on channel + conversation_id', () => {
      storage.createSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      expect(() => {
        storage.createSession({
          channel: 'slack',
          conversationId: 'conv-123',
          userId: 'user-789',
        });
      }).toThrow();
    });
  });

  describe('Message operations', () => {
    it('should add a message to a session', () => {
      const session = storage.createSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      const message = storage.addMessage({
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

    it('should add a message with tool calls', () => {
      const session = storage.createSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      const toolCalls = [{ name: 'search', arguments: { query: 'test' } }];
      const message = storage.addMessage({
        sessionId: session.id,
        role: 'assistant',
        content: 'Let me search for that',
        toolCalls,
      });

      expect(message.toolCalls).toEqual(toolCalls);
    });

    it('should get messages for a session', () => {
      const session = storage.createSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      storage.addMessage({
        sessionId: session.id,
        role: 'user',
        content: 'Message 1',
      });
      storage.addMessage({
        sessionId: session.id,
        role: 'assistant',
        content: 'Message 2',
      });
      storage.addMessage({
        sessionId: session.id,
        role: 'user',
        content: 'Message 3',
      });

      const messages = storage.getMessages(session.id);

      expect(messages).toHaveLength(3);
      expect(messages[0]?.content).toBe('Message 1');
      expect(messages[1]?.content).toBe('Message 2');
      expect(messages[2]?.content).toBe('Message 3');
    });

    it('should get messages with pagination', () => {
      const session = storage.createSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      for (let i = 0; i < 5; i++) {
        storage.addMessage({
          sessionId: session.id,
          role: 'user',
          content: `Message ${i}`,
        });
      }

      const page1 = storage.getMessages(session.id, { limit: 2 });
      expect(page1).toHaveLength(2);
      expect(page1[0]?.content).toBe('Message 0');

      const page2 = storage.getMessages(session.id, { limit: 2, offset: 2 });
      expect(page2).toHaveLength(2);
      expect(page2[0]?.content).toBe('Message 2');
    });

    it('should get session with messages', () => {
      const session = storage.createSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      storage.addMessage({
        sessionId: session.id,
        role: 'user',
        content: 'Hello',
      });
      storage.addMessage({
        sessionId: session.id,
        role: 'assistant',
        content: 'Hi there!',
      });

      const sessionWithMessages = storage.getSessionWithMessages(session.id);

      expect(sessionWithMessages).not.toBeNull();
      expect(sessionWithMessages?.messages).toHaveLength(2);
      expect(sessionWithMessages?.channel).toBe('slack');
    });

    it('should return null when getting non-existent session with messages', () => {
      const result = storage.getSessionWithMessages('non-existent');
      expect(result).toBeNull();
    });

    it('should get message count', () => {
      const session = storage.createSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      expect(storage.getMessageCount(session.id)).toBe(0);

      storage.addMessage({
        sessionId: session.id,
        role: 'user',
        content: 'Message 1',
      });
      storage.addMessage({
        sessionId: session.id,
        role: 'assistant',
        content: 'Message 2',
      });

      expect(storage.getMessageCount(session.id)).toBe(2);
    });

    it('should update session updatedAt when adding message', async () => {
      const session = storage.createSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      const originalUpdatedAt = session.updatedAt;

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      storage.addMessage({
        sessionId: session.id,
        role: 'user',
        content: 'Hello',
      });

      const updatedSession = storage.getSession(session.id);
      expect(updatedSession?.updatedAt).not.toBe(originalUpdatedAt);
    });
  });
});
