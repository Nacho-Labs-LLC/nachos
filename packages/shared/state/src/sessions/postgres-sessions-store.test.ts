/**
 * Tests for PostgresSessionsStore
 *
 * Note: These tests require a running PostgreSQL instance.
 * Set POSTGRES_TEST_URL environment variable to run these tests:
 *
 * export POSTGRES_TEST_URL="postgres://nachos:nachos@localhost:5432/nachos_test"
 * npm test -- postgres-sessions-store.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { PostgresSessionsStore } from './postgres-sessions-store.js';
import type { CreateSessionData, CreateMessageData } from './sessions-store-interface.js';

const POSTGRES_URL = process.env.POSTGRES_TEST_URL;
const TEST_SCHEMA = 'nachos_test';

// Skip tests if no Postgres connection available
const describeIfPostgres = POSTGRES_URL ? describe : describe.skip;

describeIfPostgres('PostgresSessionsStore', () => {
  let pool: Pool;
  let store: PostgresSessionsStore;

  beforeAll(async () => {
    if (!POSTGRES_URL) return;

    pool = new Pool({
      connectionString: POSTGRES_URL,
      max: 5,
    });

    // Create test schema
    await pool.query(`CREATE SCHEMA IF NOT EXISTS "${TEST_SCHEMA}"`);

    store = new PostgresSessionsStore(pool, TEST_SCHEMA);
  });

  afterAll(async () => {
    if (pool) {
      // Clean up test schema
      await pool.query(`DROP SCHEMA IF EXISTS "${TEST_SCHEMA}" CASCADE`);
      await pool.end();
    }
  });

  beforeEach(async () => {
    // Clean up tables before each test
    if (store) {
      await pool.query(`DROP TABLE IF EXISTS "${TEST_SCHEMA}".messages CASCADE`);
      await pool.query(`DROP TABLE IF EXISTS "${TEST_SCHEMA}".sessions CASCADE`);
    }
  });

  it('should create and retrieve a session', async () => {
    const sessionData: CreateSessionData = {
      channel: 'discord',
      conversationId: 'test-conversation-1',
      userId: 'user-123',
      systemPrompt: 'You are a helpful assistant',
      config: { model: 'claude-3' },
      metadata: { source: 'test' },
    };

    const created = await store.createSession(sessionData);

    expect(created).toMatchObject({
      channel: 'discord',
      conversationId: 'test-conversation-1',
      userId: 'user-123',
      status: 'active',
      systemPrompt: 'You are a helpful assistant',
    });
    expect(created.id).toBeTruthy();
    expect(created.createdAt).toBeTruthy();

    const retrieved = await store.getSession(created.id);
    expect(retrieved).toMatchObject(created);
  });

  it('should get or create session atomically', async () => {
    const sessionData: CreateSessionData = {
      channel: 'slack',
      conversationId: 'test-conversation-2',
      userId: 'user-456',
    };

    const first = await store.getOrCreateSessionAtomic(sessionData);
    expect(first.created).toBe(true);
    expect(first.session.status).toBe('active');

    const second = await store.getOrCreateSessionAtomic(sessionData);
    expect(second.created).toBe(false);
    expect(second.session.id).toBe(first.session.id);
  });

  it('should handle concurrent get or create', async () => {
    const sessionData: CreateSessionData = {
      channel: 'telegram',
      conversationId: 'test-conversation-3',
      userId: 'user-789',
    };

    // Simulate concurrent requests
    const results = await Promise.all([
      store.getOrCreateSessionAtomic(sessionData),
      store.getOrCreateSessionAtomic(sessionData),
      store.getOrCreateSessionAtomic(sessionData),
    ]);

    // All should get the same session
    const sessionIds = results.map((r) => r.session.id);
    expect(new Set(sessionIds).size).toBe(1);

    // Only one should have created it
    const createdCount = results.filter((r) => r.created).length;
    expect(createdCount).toBe(1);
  });

  it('should add and retrieve messages', async () => {
    const session = await store.createSession({
      channel: 'discord',
      conversationId: 'test-conversation-4',
      userId: 'user-123',
    });

    const message1: CreateMessageData = {
      sessionId: session.id,
      role: 'user',
      content: 'Hello!',
    };

    const message2: CreateMessageData = {
      sessionId: session.id,
      role: 'assistant',
      content: 'Hi there! How can I help?',
      toolCalls: [{ name: 'greet', args: {} }],
    };

    const created1 = await store.addMessage(message1);
    const created2 = await store.addMessage(message2);

    expect(created1.content).toBe('Hello!');
    expect(created2.content).toBe('Hi there! How can I help?');
    expect(created2.toolCalls).toEqual([{ name: 'greet', args: {} }]);

    const messages = await store.getMessages(session.id);
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toBe('Hello!');
    expect(messages[1].content).toBe('Hi there! How can I help?');
  });

  it('should get session with messages', async () => {
    const session = await store.createSession({
      channel: 'discord',
      conversationId: 'test-conversation-5',
      userId: 'user-123',
    });

    await store.addMessage({
      sessionId: session.id,
      role: 'user',
      content: 'Test message',
    });

    const withMessages = await store.getSessionWithMessages(session.id);
    expect(withMessages).toBeTruthy();
    expect(withMessages!.messages).toHaveLength(1);
    expect(withMessages!.messages[0].content).toBe('Test message');
  });

  it('should update session', async () => {
    const session = await store.createSession({
      channel: 'discord',
      conversationId: 'test-conversation-6',
      userId: 'user-123',
      systemPrompt: 'Original prompt',
    });

    const updated = await store.updateSession(session.id, {
      systemPrompt: 'Updated prompt',
      status: 'paused',
    });

    expect(updated).toBeTruthy();
    expect(updated!.systemPrompt).toBe('Updated prompt');
    expect(updated!.status).toBe('paused');
  });

  it('should delete session and messages', async () => {
    const session = await store.createSession({
      channel: 'discord',
      conversationId: 'test-conversation-7',
      userId: 'user-123',
    });

    await store.addMessage({
      sessionId: session.id,
      role: 'user',
      content: 'Test',
    });

    const deleted = await store.deleteSession(session.id);
    expect(deleted).toBe(true);

    const retrieved = await store.getSession(session.id);
    expect(retrieved).toBeNull();

    const messages = await store.getMessages(session.id);
    expect(messages).toHaveLength(0);
  });

  it('should list sessions with filtering', async () => {
    await store.createSession({
      channel: 'discord',
      conversationId: 'conv-1',
      userId: 'user-1',
    });

    await store.createSession({
      channel: 'slack',
      conversationId: 'conv-2',
      userId: 'user-2',
    });

    const session3 = await store.createSession({
      channel: 'discord',
      conversationId: 'conv-3',
      userId: 'user-3',
    });

    await store.updateSession(session3.id, { status: 'ended' });

    const allSessions = await store.listSessions();
    expect(allSessions.length).toBeGreaterThanOrEqual(3);

    const discordSessions = await store.listSessions({ channel: 'discord' });
    expect(discordSessions.length).toBeGreaterThanOrEqual(2);

    const activeSessions = await store.listSessions({ status: 'active' });
    expect(activeSessions.length).toBeGreaterThanOrEqual(2);

    const limited = await store.listSessions({ limit: 2 });
    expect(limited).toHaveLength(2);
  });

  it('should get message count', async () => {
    const session = await store.createSession({
      channel: 'discord',
      conversationId: 'test-conversation-8',
      userId: 'user-123',
    });

    expect(await store.getMessageCount(session.id)).toBe(0);

    await store.addMessage({
      sessionId: session.id,
      role: 'user',
      content: 'Message 1',
    });

    await store.addMessage({
      sessionId: session.id,
      role: 'assistant',
      content: 'Message 2',
    });

    expect(await store.getMessageCount(session.id)).toBe(2);
  });

  it('should replace messages', async () => {
    const session = await store.createSession({
      channel: 'discord',
      conversationId: 'test-conversation-9',
      userId: 'user-123',
    });

    // Add initial messages
    await store.addMessage({
      sessionId: session.id,
      role: 'user',
      content: 'Old message 1',
    });

    await store.addMessage({
      sessionId: session.id,
      role: 'assistant',
      content: 'Old message 2',
    });

    // Replace with new messages (simulating context compaction)
    const now = new Date().toISOString();
    const newMessages = [
      {
        id: 'new-msg-1',
        sessionId: session.id,
        role: 'user' as const,
        content: 'Compacted message',
        createdAt: now,
      },
    ];

    const count = await store.replaceMessages(session.id, newMessages);
    expect(count).toBe(1);

    const messages = await store.getMessages(session.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('Compacted message');
  });

  it('should handle JSONB config and metadata', async () => {
    const complexConfig = {
      model: 'claude-3',
      temperature: 0.7,
      maxTokens: 4096,
      tools: ['browser', 'filesystem'],
    };

    const complexMetadata = {
      source: 'api',
      version: '1.0',
      flags: { experimental: true, beta: false },
    };

    const session = await store.createSession({
      channel: 'discord',
      conversationId: 'test-conversation-10',
      userId: 'user-123',
      config: complexConfig,
      metadata: complexMetadata,
    });

    const retrieved = await store.getSession(session.id);
    expect(retrieved).toBeTruthy();
    expect(retrieved!.config).toEqual(complexConfig);
    expect(retrieved!.metadata).toEqual(complexMetadata);
  });

  it('should create session with default isPinned and isArchived as false', async () => {
    const session = await store.createSession({
      channel: 'discord',
      conversationId: 'test-conversation-11',
      userId: 'user-123',
    });

    expect(session.isPinned).toBe(false);
    expect(session.isArchived).toBe(false);
    expect(session.lastActivity).toBeTruthy();
  });

  it('should pin and unpin a session', async () => {
    const session = await store.createSession({
      channel: 'discord',
      conversationId: 'test-conversation-12',
      userId: 'user-123',
    });

    const pinned = await store.pin(session.id, true);
    expect(pinned).toBe(true);

    const pinnedSession = await store.getSession(session.id);
    expect(pinnedSession!.isPinned).toBe(true);

    const unpinned = await store.pin(session.id, false);
    expect(unpinned).toBe(true);

    const unpinnedSession = await store.getSession(session.id);
    expect(unpinnedSession!.isPinned).toBe(false);
  });

  it('should archive and restore a session', async () => {
    const session = await store.createSession({
      channel: 'discord',
      conversationId: 'test-conversation-13',
      userId: 'user-123',
    });

    const archived = await store.archive(session.id);
    expect(archived).toBe(true);

    const archivedSession = await store.getSession(session.id);
    expect(archivedSession!.isArchived).toBe(true);

    const restored = await store.restore(session.id);
    expect(restored).toBe(true);

    const restoredSession = await store.getSession(session.id);
    expect(restoredSession!.isArchived).toBe(false);
  });

  it('should list active sessions (within 24h or pinned)', async () => {
    // Create a recent session
    const recentSession = await store.createSession({
      channel: 'discord',
      conversationId: 'test-conversation-14',
      userId: 'user-123',
    });

    // Create an old session (simulate by manually updating timestamp)
    const oldSession = await store.createSession({
      channel: 'discord',
      conversationId: 'test-conversation-15',
      userId: 'user-123',
    });

    // Manually set old session's last_activity to 48 hours ago
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    await pool.query(`UPDATE ${TEST_SCHEMA}.sessions SET last_activity = $1 WHERE id = $2`, [
      fortyEightHoursAgo,
      oldSession.id,
    ]);

    // Create a pinned old session
    const pinnedOldSession = await store.createSession({
      channel: 'discord',
      conversationId: 'test-conversation-16',
      userId: 'user-123',
    });

    await pool.query(`UPDATE ${TEST_SCHEMA}.sessions SET last_activity = $1 WHERE id = $2`, [
      fortyEightHoursAgo,
      pinnedOldSession.id,
    ]);
    await store.pin(pinnedOldSession.id, true);

    // List active sessions
    const activeSessions = await store.listActive({ channel: 'discord', userId: 'user-123' });

    const activeIds = activeSessions.map((s) => s.id);
    expect(activeIds).toContain(recentSession.id);
    expect(activeIds).toContain(pinnedOldSession.id);
    expect(activeIds).not.toContain(oldSession.id);
  });

  it('should list archived sessions', async () => {
    const session1 = await store.createSession({
      channel: 'discord',
      conversationId: 'test-conversation-17',
      userId: 'user-123',
    });
    await store.archive(session1.id);

    const session2 = await store.createSession({
      channel: 'discord',
      conversationId: 'test-conversation-18',
      userId: 'user-123',
    });
    await store.archive(session2.id);

    await store.createSession({
      channel: 'discord',
      conversationId: 'test-conversation-19',
      userId: 'user-123',
    });

    const archivedSessions = await store.listArchived({ channel: 'discord', userId: 'user-123' });

    const archivedIds = archivedSessions.map((s) => s.id);
    expect(archivedIds).toContain(session1.id);
    expect(archivedIds).toContain(session2.id);
    expect(archivedSessions.every((s) => s.isArchived)).toBe(true);
  });

  it('should search archived sessions', async () => {
    const session1 = await store.createSession({
      channel: 'discord',
      conversationId: 'search-test-foo',
      userId: 'user-123',
      systemPrompt: 'You are a helpful assistant',
    });
    await store.archive(session1.id);

    const session2 = await store.createSession({
      channel: 'discord',
      conversationId: 'search-test-bar',
      userId: 'user-123',
      systemPrompt: 'You are a coding assistant',
    });
    await store.archive(session2.id);

    const fooResults = await store.listArchived({
      channel: 'discord',
      userId: 'user-123',
      search: 'foo',
    });

    expect(fooResults.length).toBeGreaterThanOrEqual(1);
    expect(fooResults.some((s) => s.id === session1.id)).toBe(true);

    const codingResults = await store.listArchived({
      channel: 'discord',
      userId: 'user-123',
      search: 'coding',
    });

    expect(codingResults.length).toBeGreaterThanOrEqual(1);
    expect(codingResults.some((s) => s.id === session2.id)).toBe(true);
  });

  it('should update lastActivity when adding messages', async () => {
    const session = await store.createSession({
      channel: 'discord',
      conversationId: 'test-conversation-20',
      userId: 'user-123',
    });

    const initialActivity = session.lastActivity;

    await new Promise((resolve) => setTimeout(resolve, 10));

    await store.addMessage({
      sessionId: session.id,
      role: 'user',
      content: 'Test message',
    });

    const updatedSession = await store.getSession(session.id);
    expect(updatedSession!.lastActivity).not.toBe(initialActivity);
  });
});
