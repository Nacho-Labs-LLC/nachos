/**
 * WebChat HTTP → RPC Bridge Routes
 * 
 * Provides REST API endpoints that call the WebChatRPCService via NATS.
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { createBusClient, type NachosBusClient } from '@nachos/bus';
import type {
  ListSessionsResponse,
  ListArchivedResponse,
  CreateSessionResponse,
  ArchiveSessionResponse,
  RestoreSessionResponse,
  DeleteSessionResponse,
  PinSessionResponse,
  SendMessageResponse,
  GetMessagesResponse,
} from '../types/webchat-rpc-types.js';

const NATS_URL = process.env['NATS_URL'] ?? 'nats://localhost:4222';
const NATS_TOKEN = process.env['NATS_TOKEN'] ?? '';

export const webchatRouter = new Hono();

// Get or create bus client connection
let busClient: NachosBusClient | null = null;

async function getBusClient(): Promise<NachosBusClient> {
  if (!busClient) {
    busClient = createBusClient({
      servers: [NATS_URL],
      name: 'admin-webchat',
      token: NATS_TOKEN || undefined,
    });
    await busClient.connect();
  }
  return busClient;
}

// Helper to extract userId from request (from auth middleware or headers)
function getUserId(c: any): string {
  // In a real implementation, this would come from the auth middleware
  // For now, use a header or default value
  return c.req.header('X-User-Id') || 'webchat-user';
}

// GET /api/webchat/sessions/active
// List active sessions (last 24h or pinned)
webchatRouter.get('/sessions/active', async (c) => {
  try {
    const userId = getUserId(c);
    const channel = c.req.query('channel') || 'webchat';
    const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined;
    const offset = c.req.query('offset') ? parseInt(c.req.query('offset')!) : undefined;

    const bus = await getBusClient();
    const response = await bus.request<any, ListSessionsResponse>(
      'nachos.webchat.sessions.list',
      { userId, channel, limit, offset }
    );

    return c.json(response.payload);
  } catch (err) {
    console.error('[webchat] Error listing sessions:', err);
    return c.json({ error: 'Failed to list sessions', details: String(err) }, 500);
  }
});

// GET /api/webchat/sessions/archived
// List archived sessions
webchatRouter.get('/sessions/archived', async (c) => {
  try {
    const userId = getUserId(c);
    const channel = c.req.query('channel') || 'webchat';
    const search = c.req.query('search');
    const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined;
    const offset = c.req.query('offset') ? parseInt(c.req.query('offset')!) : undefined;

    const bus = await getBusClient();
    const response = await bus.request<any, ListArchivedResponse>(
      'nachos.webchat.sessions.listArchived',
      { userId, channel, search, limit, offset }
    );

    return c.json(response.payload);
  } catch (err) {
    console.error('[webchat] Error listing archived sessions:', err);
    return c.json({ error: 'Failed to list archived sessions', details: String(err) }, 500);
  }
});

// POST /api/webchat/sessions/create
// Create a new session
webchatRouter.post('/sessions/create', async (c) => {
  try {
    const userId = getUserId(c);
    const body = await c.req.json<{ channel?: string; systemPrompt?: string }>();
    const channel = body.channel || 'webchat';

    const bus = await getBusClient();
    const response = await bus.request<any, CreateSessionResponse>(
      'nachos.webchat.sessions.create',
      { userId, channel, systemPrompt: body.systemPrompt }
    );

    return c.json(response.payload);
  } catch (err) {
    console.error('[webchat] Error creating session:', err);
    return c.json({ error: 'Failed to create session', details: String(err) }, 500);
  }
});

// POST /api/webchat/sessions/:sessionId/archive
// Archive a session
webchatRouter.post('/sessions/:sessionId/archive', async (c) => {
  try {
    const userId = getUserId(c);
    const sessionId = c.req.param('sessionId');

    const bus = await getBusClient();
    const response = await bus.request<any, ArchiveSessionResponse>(
      'nachos.webchat.sessions.archive',
      { sessionId, userId }
    );

    return c.json(response.payload);
  } catch (err) {
    console.error('[webchat] Error archiving session:', err);
    return c.json({ error: 'Failed to archive session', details: String(err) }, 500);
  }
});

// POST /api/webchat/sessions/:sessionId/restore
// Restore a session from archive
webchatRouter.post('/sessions/:sessionId/restore', async (c) => {
  try {
    const userId = getUserId(c);
    const sessionId = c.req.param('sessionId');

    const bus = await getBusClient();
    const response = await bus.request<any, RestoreSessionResponse>(
      'nachos.webchat.sessions.restore',
      { sessionId, userId }
    );

    return c.json(response.payload);
  } catch (err) {
    console.error('[webchat] Error restoring session:', err);
    return c.json({ error: 'Failed to restore session', details: String(err) }, 500);
  }
});

// DELETE /api/webchat/sessions/:sessionId
// Delete a session
webchatRouter.delete('/sessions/:sessionId', async (c) => {
  try {
    const userId = getUserId(c);
    const sessionId = c.req.param('sessionId');

    const bus = await getBusClient();
    const response = await bus.request<any, DeleteSessionResponse>(
      'nachos.webchat.sessions.delete',
      { sessionId, userId }
    );

    return c.json(response.payload);
  } catch (err) {
    console.error('[webchat] Error deleting session:', err);
    return c.json({ error: 'Failed to delete session', details: String(err) }, 500);
  }
});

// POST /api/webchat/sessions/:sessionId/pin
// Pin or unpin a session
webchatRouter.post('/sessions/:sessionId/pin', async (c) => {
  try {
    const userId = getUserId(c);
    const sessionId = c.req.param('sessionId');
    const body = await c.req.json<{ pinned: boolean }>();

    const bus = await getBusClient();
    const response = await bus.request<any, PinSessionResponse>(
      'nachos.webchat.sessions.pin',
      { sessionId, userId, pinned: body.pinned }
    );

    return c.json(response.payload);
  } catch (err) {
    console.error('[webchat] Error pinning session:', err);
    return c.json({ error: 'Failed to pin session', details: String(err) }, 500);
  }
});

// POST /api/webchat/messages/send
// Send a message
webchatRouter.post('/messages/send', async (c) => {
  try {
    const userId = getUserId(c);
    const body = await c.req.json<{ sessionId: string; text: string }>();

    const bus = await getBusClient();
    const response = await bus.request<any, SendMessageResponse>(
      'nachos.webchat.messages.send',
      { sessionId: body.sessionId, userId, text: body.text }
    );

    return c.json(response.payload);
  } catch (err) {
    console.error('[webchat] Error sending message:', err);
    return c.json({ error: 'Failed to send message', details: String(err) }, 500);
  }
});

// GET /api/webchat/messages/:sessionId
// Get messages for a session (with pagination)
webchatRouter.get('/messages/:sessionId', async (c) => {
  try {
    const userId = getUserId(c);
    const sessionId = c.req.param('sessionId');
    const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined;
    const offset = c.req.query('offset') ? parseInt(c.req.query('offset')!) : undefined;

    const bus = await getBusClient();
    const response = await bus.request<any, GetMessagesResponse>(
      'nachos.webchat.messages.get',
      { sessionId, userId, limit, offset }
    );

    return c.json(response.payload);
  } catch (err) {
    console.error('[webchat] Error getting messages:', err);
    return c.json({ error: 'Failed to get messages', details: String(err) }, 500);
  }
});

// GET /api/webchat/messages/:sessionId/stream
// Stream messages for a session (SSE)
webchatRouter.get('/messages/:sessionId/stream', async (c) => {
  try {
    const sessionId = c.req.param('sessionId');
    const userId = getUserId(c);

    return streamSSE(c, async (stream) => {
      try {
        const bus = await getBusClient();

        // Subscribe to session-specific message topic
        const subscription = await bus.subscribe(`nachos.webchat.messages.${sessionId}`, async (envelope) => {
          try {
            await stream.writeSSE({
              data: JSON.stringify(envelope.payload),
              event: 'message',
            });
          } catch (err) {
            console.error('[webchat] Error writing SSE:', err);
          }
        });

        // Send initial connection event
        await stream.writeSSE({
          data: JSON.stringify({ type: 'connected', sessionId, userId }),
          event: 'status',
        });

        // Keep connection alive
        const keepAlive = setInterval(async () => {
          try {
            await stream.writeSSE({
              data: JSON.stringify({ type: 'ping' }),
              event: 'ping',
            });
          } catch {
            clearInterval(keepAlive);
          }
        }, 30000);

        // Wait for client disconnect
        await new Promise<void>((resolve) => {
          stream.onAbort(() => {
            clearInterval(keepAlive);
            subscription.unsubscribe();
            resolve();
          });
        });
      } catch (err) {
        console.error('[webchat] SSE stream error:', err);
        await stream.writeSSE({
          data: JSON.stringify({ type: 'error', error: String(err) }),
          event: 'error',
        });
      }
    });
  } catch (err) {
    console.error('[webchat] Error setting up stream:', err);
    return c.json({ error: 'Failed to setup message stream', details: String(err) }, 500);
  }
});
