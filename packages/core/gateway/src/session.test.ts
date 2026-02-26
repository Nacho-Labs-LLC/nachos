import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionManager } from './session.js';
import { StateStorage } from './state.js';

describe('SessionManager', () => {
  let storage: StateStorage;
  let sessionManager: SessionManager;

  beforeEach(async () => {
    storage = new StateStorage(':memory:');
    sessionManager = new SessionManager(storage);
  });

  afterEach(async () => {
    storage.close();
  });

  describe('getOrCreateSession', () => {
    it('should create a new session', async () => {
      const session = await sessionManager.getOrCreateSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      expect(session.id).toBeDefined();
      expect(session.channel).toBe('slack');
      expect(session.conversationId).toBe('conv-123');
      expect(session.userId).toBe('user-456');
      expect(session.status).toBe('active');
    });

    it('should return existing active session', async () => {
      const session1 = await sessionManager.getOrCreateSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      const session2 = await sessionManager.getOrCreateSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      expect(session2.id).toBe(session1.id);
    });

    it('should reactivate paused session', async () => {
      const session1 = await sessionManager.getOrCreateSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      await sessionManager.pauseSession(session1.id);

      const session2 = await sessionManager.getOrCreateSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      expect(session2.id).toBe(session1.id);
      expect(session2.status).toBe('active');
    });

    it('should reactivate ended session', async () => {
      const session1 = await sessionManager.getOrCreateSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      await sessionManager.endSession(session1.id);

      const session2 = await sessionManager.getOrCreateSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      expect(session2.id).toBe(session1.id);
      expect(session2.status).toBe('active');
    });

    it('should create session with system prompt', async () => {
      const session = await sessionManager.getOrCreateSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
        systemPrompt: 'You are a helpful assistant',
      });

      expect(session.systemPrompt).toBe('You are a helpful assistant');
    });

    it('should create session with config', async () => {
      const session = await sessionManager.getOrCreateSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
        config: { model: 'gpt-4', maxTokens: 1000 },
      });

      expect(session.config).toEqual({ model: 'gpt-4', maxTokens: 1000 });
    });
  });

  describe('getSession', () => {
    it('should get a session by ID', async () => {
      const created = await sessionManager.getOrCreateSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      const retrieved = await sessionManager.getSession(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(created.id);
    });

    it('should return null for non-existent session', async () => {
      const session = await sessionManager.getSession('non-existent');
      expect(session).toBeNull();
    });
  });

  describe('getSessionByConversation', () => {
    it('should get a session by channel and conversation ID', async () => {
      await sessionManager.getOrCreateSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      const session = await sessionManager.getSessionByConversation('slack', 'conv-123');

      expect(session).not.toBeNull();
      expect(session?.channel).toBe('slack');
      expect(session?.conversationId).toBe('conv-123');
    });
  });

  describe('Session status management', () => {
    it('should pause a session', async () => {
      const session = await sessionManager.getOrCreateSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      const paused = await sessionManager.pauseSession(session.id);

      expect(paused?.status).toBe('paused');
    });

    it('should end a session', async () => {
      const session = await sessionManager.getOrCreateSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      const ended = await sessionManager.endSession(session.id);

      expect(ended?.status).toBe('ended');
    });

    it('should reactivate a session', async () => {
      const session = await sessionManager.getOrCreateSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      await sessionManager.pauseSession(session.id);
      const reactivated = await sessionManager.reactivateSession(session.id);

      expect(reactivated?.status).toBe('active');
    });

    it('should return same session when reactivating already active session', async () => {
      const session = await sessionManager.getOrCreateSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      const reactivated = await sessionManager.reactivateSession(session.id);

      expect(reactivated?.id).toBe(session.id);
      expect(reactivated?.status).toBe('active');
    });

    it('should return null when reactivating non-existent session', async () => {
      const result = await sessionManager.reactivateSession('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('Session updates', () => {
    it('should update session config', async () => {
      const session = await sessionManager.getOrCreateSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
        config: { model: 'gpt-4' },
      });

      const updated = await sessionManager.updateConfig(session.id, {
        maxTokens: 2000,
      });

      expect(updated?.config).toEqual({ model: 'gpt-4', maxTokens: 2000 });
    });

    it('should return null when updating config of non-existent session', async () => {
      const result = await sessionManager.updateConfig('non-existent', {
        maxTokens: 2000,
      });
      expect(result).toBeNull();
    });

    it('should update system prompt', async () => {
      const session = await sessionManager.getOrCreateSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      const updated = await sessionManager.updateSystemPrompt(session.id, 'New prompt');

      expect(updated?.systemPrompt).toBe('New prompt');
    });

    it('should update metadata', async () => {
      const session = await sessionManager.getOrCreateSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
        metadata: { key1: 'value1' },
      });

      const updated = await sessionManager.updateMetadata(session.id, {
        key2: 'value2',
      });

      expect(updated?.metadata).toEqual({ key1: 'value1', key2: 'value2' });
    });

    it('should return null when updating metadata of non-existent session', async () => {
      const result = await sessionManager.updateMetadata('non-existent', {});
      expect(result).toBeNull();
    });
  });

  describe('deleteSession', () => {
    it('should delete a session', async () => {
      const session = await sessionManager.getOrCreateSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      const deleted = await sessionManager.deleteSession(session.id);

      expect(deleted).toBe(true);
      expect(await sessionManager.getSession(session.id)).toBeNull();
    });
  });

  describe('listSessions', () => {
    it('should list all sessions', async () => {
      await sessionManager.getOrCreateSession({
        channel: 'slack',
        conversationId: 'conv-1',
        userId: 'user-1',
      });
      await sessionManager.getOrCreateSession({
        channel: 'discord',
        conversationId: 'conv-2',
        userId: 'user-2',
      });

      const sessions = await sessionManager.listSessions();

      expect(sessions).toHaveLength(2);
    });

    it('should list sessions with filter', async () => {
      await sessionManager.getOrCreateSession({
        channel: 'slack',
        conversationId: 'conv-1',
        userId: 'user-1',
      });
      await sessionManager.getOrCreateSession({
        channel: 'discord',
        conversationId: 'conv-2',
        userId: 'user-2',
      });

      const sessions = await sessionManager.listSessions({ channel: 'slack' });

      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.channel).toBe('slack');
    });
  });

  describe('Message operations', () => {
    it('should add a message to a session', async () => {
      const session = await sessionManager.getOrCreateSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      const message = await sessionManager.addMessage(session.id, {
        role: 'user',
        content: 'Hello!',
      });

      expect(message).not.toBeNull();
      expect(message?.role).toBe('user');
      expect(message?.content).toBe('Hello!');
    });

    it('should return null when adding message to non-existent session', async () => {
      const message = await sessionManager.addMessage('non-existent', {
        role: 'user',
        content: 'Hello!',
      });

      expect(message).toBeNull();
    });

    it('should return null when adding message to inactive session', async () => {
      const session = await sessionManager.getOrCreateSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      await sessionManager.pauseSession(session.id);

      const message = await sessionManager.addMessage(session.id, {
        role: 'user',
        content: 'Hello!',
      });

      expect(message).toBeNull();
    });

    it('should get messages for a session', async () => {
      const session = await sessionManager.getOrCreateSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      await sessionManager.addMessage(session.id, { role: 'user', content: 'Hi!' });
      await sessionManager.addMessage(session.id, {
        role: 'assistant',
        content: 'Hello!',
      });

      const messages = await sessionManager.getMessages(session.id);

      expect(messages).toHaveLength(2);
    });

    it('should get message count', async () => {
      const session = await sessionManager.getOrCreateSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      await sessionManager.addMessage(session.id, { role: 'user', content: 'Hi!' });
      await sessionManager.addMessage(session.id, {
        role: 'assistant',
        content: 'Hello!',
      });

      const count = await sessionManager.getMessageCount(session.id);

      expect(count).toBe(2);
    });

    it('should get session with messages', async () => {
      const session = await sessionManager.getOrCreateSession({
        channel: 'slack',
        conversationId: 'conv-123',
        userId: 'user-456',
      });

      await sessionManager.addMessage(session.id, { role: 'user', content: 'Hi!' });

      const sessionWithMessages = await sessionManager.getSessionWithMessages(session.id);

      expect(sessionWithMessages).not.toBeNull();
      expect(sessionWithMessages?.messages).toHaveLength(1);
    });
  });
});
