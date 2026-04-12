/**
 * Integration tests for WebChatRPCService
 *
 * Note: These tests require a running PostgreSQL and NATS instance.
 * Set POSTGRES_TEST_URL and NATS_TEST_URL environment variables to run these tests:
 *
 * export POSTGRES_TEST_URL="postgres://nachos:nachos@localhost:5432/nachos_test"
 * export NATS_TEST_URL="nats://localhost:4222"
 * npm test -- webchat-rpc-service.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { createBusClient, type NachosBusClient } from '@nachos/bus';
import { PostgresSessionsStore } from '@nachos/state';
import { WebChatRPCService } from './webchat-rpc-service.js';
import type {
  ListSessionsRequest,
  ListSessionsResponse,
  ListArchivedRequest,
  ListArchivedResponse,
  CreateSessionRequest,
  CreateSessionResponse,
  ArchiveSessionRequest,
  ArchiveSessionResponse,
  RestoreSessionRequest,
  RestoreSessionResponse,
  DeleteSessionRequest,
  DeleteSessionResponse,
  PinSessionRequest,
  PinSessionResponse,
  SendMessageRequest,
  SendMessageResponse,
  GetMessagesRequest,
  GetMessagesResponse,
} from './webchat-rpc-service.js';

const POSTGRES_URL = process.env.POSTGRES_TEST_URL;
const NATS_URL = process.env.NATS_TEST_URL;
const TEST_SCHEMA = 'webchat_rpc_test';

// Skip tests if no Postgres or NATS connection available
const describeIfInfra = POSTGRES_URL && NATS_URL ? describe : describe.skip;

describeIfInfra('WebChatRPCService', () => {
  let pool: Pool;
  let store: PostgresSessionsStore;
  let bus: NachosBusClient;
  let rpcService: WebChatRPCService;

  beforeAll(async () => {
    if (!POSTGRES_URL || !NATS_URL) return;

    // Set up Postgres
    pool = new Pool({
      connectionString: POSTGRES_URL,
      max: 5,
    });

    await pool.query(`CREATE SCHEMA IF NOT EXISTS "${TEST_SCHEMA}"`);
    store = new PostgresSessionsStore(pool, TEST_SCHEMA);

    // Set up NATS
    bus = createBusClient({
      servers: [NATS_URL],
      name: 'webchat-rpc-test',
    });
    await bus.connect();

    // Create RPC service
    rpcService = new WebChatRPCService(bus, store);
    await rpcService.start();
  });

  afterAll(async () => {
    if (rpcService) {
      await rpcService.stop();
    }
    if (bus) {
      await bus.disconnect();
    }
    if (pool) {
      await pool.query(`DROP SCHEMA IF EXISTS "${TEST_SCHEMA}" CASCADE`);
      await pool.end();
    }
  });

  beforeEach(async () => {
    // Clean up tables and create fresh store before each test
    // (the store caches initialized=true, so we need a new instance after dropping tables)
    if (pool) {
      await pool.query(`DROP TABLE IF EXISTS "${TEST_SCHEMA}".messages CASCADE`);
      await pool.query(`DROP TABLE IF EXISTS "${TEST_SCHEMA}".sessions CASCADE`);
      store = new PostgresSessionsStore(pool, TEST_SCHEMA);
    }
  });

  it('should handle createSession RPC request', async () => {
    const response = await bus.request<CreateSessionRequest, CreateSessionResponse>(
      'nachos.webchat.sessions.create',
      {
        userId: 'test-user-1',
        channel: 'webchat',
      }
    );

    const payload = response.payload as CreateSessionResponse;
    expect(payload).toHaveProperty('session');
    expect(payload.session).toHaveProperty('id');
    expect(payload.session).toHaveProperty('name');
    expect(payload.session).toHaveProperty('createdAt');
  });

  it('should handle listSessions RPC request', async () => {
    // Create a few sessions
    await store.createSession({
      channel: 'webchat',
      conversationId: 'conv-1',
      userId: 'test-user-2',
    });

    await store.createSession({
      channel: 'webchat',
      conversationId: 'conv-2',
      userId: 'test-user-2',
    });

    const response = await bus.request<ListSessionsRequest, ListSessionsResponse>(
      'nachos.webchat.sessions.list',
      {
        userId: 'test-user-2',
        channel: 'webchat',
      }
    );

    const payload = response.payload as ListSessionsResponse;
    expect(payload).toHaveProperty('sessions');
    expect(Array.isArray(payload.sessions)).toBe(true);
    expect(payload.sessions.length).toBeGreaterThanOrEqual(2);
  });

  it('should handle archiveSession and listArchived RPC requests', async () => {
    // Create a session
    const session = await store.createSession({
      channel: 'webchat',
      conversationId: 'conv-3',
      userId: 'test-user-3',
    });

    // Archive the session
    const archiveResponse = await bus.request<ArchiveSessionRequest, ArchiveSessionResponse>(
      'nachos.webchat.sessions.archive',
      {
        sessionId: session.id,
        userId: 'test-user-3',
      }
    );

    const archivePayload = archiveResponse.payload as ArchiveSessionResponse;
    expect(archivePayload).toHaveProperty('ok', true);

    // List archived sessions
    const listResponse = await bus.request<ListArchivedRequest, ListArchivedResponse>(
      'nachos.webchat.sessions.listArchived',
      {
        userId: 'test-user-3',
        channel: 'webchat',
      }
    );

    const listPayload = listResponse.payload as ListArchivedResponse;
    expect(listPayload).toHaveProperty('sessions');
    expect(listPayload.sessions.length).toBeGreaterThanOrEqual(1);
    expect(listPayload.sessions.some((s) => s.id === session.id)).toBe(true);
  });

  it('should handle restoreSession RPC request', async () => {
    // Create and archive a session
    const session = await store.createSession({
      channel: 'webchat',
      conversationId: 'conv-4',
      userId: 'test-user-4',
    });

    await store.archive(session.id);

    // Restore the session
    const restoreResponse = await bus.request<RestoreSessionRequest, RestoreSessionResponse>(
      'nachos.webchat.sessions.restore',
      {
        sessionId: session.id,
        userId: 'test-user-4',
      }
    );

    const restorePayload = restoreResponse.payload as RestoreSessionResponse;
    expect(restorePayload).toHaveProperty('ok', true);

    // Verify it's no longer in archived list
    const listResponse = await bus.request<ListArchivedRequest, ListArchivedResponse>(
      'nachos.webchat.sessions.listArchived',
      {
        userId: 'test-user-4',
        channel: 'webchat',
      }
    );

    const listPayload = listResponse.payload as ListArchivedResponse;
    expect(listPayload.sessions.every((s) => s.id !== session.id)).toBe(true);
  });

  it('should handle pinSession RPC request', async () => {
    // Create a session
    const session = await store.createSession({
      channel: 'webchat',
      conversationId: 'conv-5',
      userId: 'test-user-5',
    });

    // Pin the session
    const pinResponse = await bus.request<PinSessionRequest, PinSessionResponse>(
      'nachos.webchat.sessions.pin',
      {
        sessionId: session.id,
        userId: 'test-user-5',
        pinned: true,
      }
    );

    const pinPayload = pinResponse.payload as PinSessionResponse;
    expect(pinPayload).toHaveProperty('ok', true);

    // Verify it's pinned
    const sessions = await bus.request<ListSessionsRequest, ListSessionsResponse>(
      'nachos.webchat.sessions.list',
      {
        userId: 'test-user-5',
        channel: 'webchat',
      }
    );

    const sessionsPayload = sessions.payload as ListSessionsResponse;
    const pinnedSession = sessionsPayload.sessions.find((s) => s.id === session.id);
    expect(pinnedSession).toBeTruthy();
    expect(pinnedSession!.isPinned).toBe(true);
  });

  it('should handle deleteSession RPC request', async () => {
    // Create a session
    const session = await store.createSession({
      channel: 'webchat',
      conversationId: 'conv-6',
      userId: 'test-user-6',
    });

    // Delete the session
    const deleteResponse = await bus.request<DeleteSessionRequest, DeleteSessionResponse>(
      'nachos.webchat.sessions.delete',
      {
        sessionId: session.id,
        userId: 'test-user-6',
      }
    );

    const deletePayload = deleteResponse.payload as DeleteSessionResponse;
    expect(deletePayload).toHaveProperty('ok', true);

    // Verify it's deleted
    const retrieved = await store.getSession(session.id);
    expect(retrieved).toBeNull();
  });

  it('should handle sendMessage and publish to stream', async () => {
    // Create a session
    const session = await store.createSession({
      channel: 'webchat',
      conversationId: 'conv-7',
      userId: 'test-user-7',
    });

    // Subscribe to message stream before sending
    const receivedMessages: unknown[] = [];
    await bus.subscribe(`nachos.webchat.messages.${session.id}`, async (envelope) => {
      receivedMessages.push(envelope.payload);
    });

    // Wait a bit for subscription to be ready
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Send a message
    const sendResponse = await bus.request<SendMessageRequest, SendMessageResponse>(
      'nachos.webchat.messages.send',
      {
        sessionId: session.id,
        userId: 'test-user-7',
        text: 'Hello, world!',
      }
    );

    const payload = sendResponse.payload as SendMessageResponse;
    expect(payload).toHaveProperty('messageId');
    expect(payload).toHaveProperty('timestamp');

    // Wait for message to be published
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify message was published to stream
    expect(receivedMessages.length).toBeGreaterThanOrEqual(1);
    expect(receivedMessages[0]).toHaveProperty('content', 'Hello, world!');
  });

  it('should handle getMessages RPC request with pagination', async () => {
    // Create a session
    const session = await store.createSession({
      channel: 'webchat',
      conversationId: 'conv-8',
      userId: 'test-user-8',
    });

    // Add some messages
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

    await store.addMessage({
      sessionId: session.id,
      role: 'user',
      content: 'Message 3',
    });

    // Get messages with pagination
    const response = await bus.request<GetMessagesRequest, GetMessagesResponse>(
      'nachos.webchat.messages.get',
      {
        sessionId: session.id,
        userId: 'test-user-8',
        limit: 2,
        offset: 0,
      }
    );

    const payload = response.payload as GetMessagesResponse;
    expect(payload).toHaveProperty('messages');
    expect(payload).toHaveProperty('total', 3);
    expect(payload.messages.length).toBe(2);
  });

  it('should enforce user ownership for session operations', async () => {
    // Create a session owned by user-1
    const session = await store.createSession({
      channel: 'webchat',
      conversationId: 'conv-9',
      userId: 'user-1',
    });

    // Try to archive as user-2 (should fail)
    const archiveResponse = await bus.request<
      ArchiveSessionRequest,
      ArchiveSessionResponse | { error: string }
    >('nachos.webchat.sessions.archive', {
      sessionId: session.id,
      userId: 'user-2',
    });

    const payload = archiveResponse.payload as Record<string, unknown>;
    expect(payload).toHaveProperty('error');
    expect(payload.error).toContain('access denied');
  });
});
