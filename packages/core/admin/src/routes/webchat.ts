/**
 * WebChat HTTP → RPC Bridge Routes
 *
 * Provides REST API endpoints that call the WebChatRPCService via NATS.
 */

import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { createBusClient, type NachosBusClient } from '@nachos/bus';
import { createLogger } from '@nachos/types';
import { createHash } from 'node:crypto';
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

const logger = createLogger('admin-webchat');

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

/**
 * Derive a stable user ID from the admin token.
 *
 * The admin auth middleware already validated the Bearer token or cookie before
 * this handler runs. We derive the user identity from the authenticated token
 * rather than trusting a client-supplied X-User-Id header, which is trivially
 * spoofable. The SHA-256 hash ensures the raw token is never used as an
 * identifier and produces a stable, deterministic ID for the same token.
 */
function getUserId(c: Context): string {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;

  if (!token) {
    // Auth middleware already validated the request, so this path should only
    // be reached if authentication came via cookie. Fall back to a hash of the
    // configured admin token to keep identity stable.
    const envToken = process.env['NACHOS_ADMIN_TOKEN'];
    if (envToken) {
      return `admin-${createHash('sha256').update(envToken).digest('hex').slice(0, 16)}`;
    }
    return 'admin-default';
  }

  return `admin-${createHash('sha256').update(token).digest('hex').slice(0, 16)}`;
}

// RPC request payload types
interface ListSessionsRequest {
  userId: string;
  channel: string;
  limit?: number;
  offset?: number;
}

interface ListArchivedRequest {
  userId: string;
  channel: string;
  search?: string;
  limit?: number;
  offset?: number;
}

interface CreateSessionRequest {
  userId: string;
  channel: string;
  systemPrompt?: string;
}

interface SessionActionRequest {
  sessionId: string;
  userId: string;
}

interface PinSessionRequest {
  sessionId: string;
  userId: string;
  pinned: boolean;
}

interface SendMessageRpcRequest {
  sessionId: string;
  userId: string;
  text: string;
}

interface GetMessagesRequest {
  sessionId: string;
  userId: string;
  limit?: number;
  offset?: number;
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
    const response = await bus.request<ListSessionsRequest, ListSessionsResponse>(
      'nachos.webchat.sessions.list',
      { userId, channel, limit, offset }
    );

    return c.json(response.payload);
  } catch (err) {
    logger.error({ err }, 'Error listing sessions');
    return c.json({ error: 'Failed to list sessions' }, 500);
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
    const response = await bus.request<ListArchivedRequest, ListArchivedResponse>(
      'nachos.webchat.sessions.listArchived',
      { userId, channel, search, limit, offset }
    );

    return c.json(response.payload);
  } catch (err) {
    logger.error({ err }, 'Error listing archived sessions');
    return c.json({ error: 'Failed to list archived sessions' }, 500);
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
    const response = await bus.request<CreateSessionRequest, CreateSessionResponse>(
      'nachos.webchat.sessions.create',
      { userId, channel, systemPrompt: body.systemPrompt }
    );

    return c.json(response.payload);
  } catch (err) {
    logger.error({ err }, 'Error creating session');
    return c.json({ error: 'Failed to create session' }, 500);
  }
});

// POST /api/webchat/sessions/:sessionId/archive
// Archive a session
webchatRouter.post('/sessions/:sessionId/archive', async (c) => {
  try {
    const userId = getUserId(c);
    const sessionId = c.req.param('sessionId');

    const bus = await getBusClient();
    const response = await bus.request<SessionActionRequest, ArchiveSessionResponse>(
      'nachos.webchat.sessions.archive',
      { sessionId, userId }
    );

    return c.json(response.payload);
  } catch (err) {
    logger.error({ err }, 'Error archiving session');
    return c.json({ error: 'Failed to archive session' }, 500);
  }
});

// POST /api/webchat/sessions/:sessionId/restore
// Restore a session from archive
webchatRouter.post('/sessions/:sessionId/restore', async (c) => {
  try {
    const userId = getUserId(c);
    const sessionId = c.req.param('sessionId');

    const bus = await getBusClient();
    const response = await bus.request<SessionActionRequest, RestoreSessionResponse>(
      'nachos.webchat.sessions.restore',
      { sessionId, userId }
    );

    return c.json(response.payload);
  } catch (err) {
    logger.error({ err }, 'Error restoring session');
    return c.json({ error: 'Failed to restore session' }, 500);
  }
});

// DELETE /api/webchat/sessions/:sessionId
// Delete a session
webchatRouter.delete('/sessions/:sessionId', async (c) => {
  try {
    const userId = getUserId(c);
    const sessionId = c.req.param('sessionId');

    const bus = await getBusClient();
    const response = await bus.request<SessionActionRequest, DeleteSessionResponse>(
      'nachos.webchat.sessions.delete',
      { sessionId, userId }
    );

    return c.json(response.payload);
  } catch (err) {
    logger.error({ err }, 'Error deleting session');
    return c.json({ error: 'Failed to delete session' }, 500);
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
    const response = await bus.request<PinSessionRequest, PinSessionResponse>(
      'nachos.webchat.sessions.pin',
      { sessionId, userId, pinned: body.pinned }
    );

    return c.json(response.payload);
  } catch (err) {
    logger.error({ err }, 'Error pinning session');
    return c.json({ error: 'Failed to pin session' }, 500);
  }
});

// POST /api/webchat/messages/send
// Send a message
webchatRouter.post('/messages/send', async (c) => {
  try {
    const userId = getUserId(c);
    const body = await c.req.json<{ sessionId: string; text: string }>();

    const bus = await getBusClient();
    const response = await bus.request<SendMessageRpcRequest, SendMessageResponse>(
      'nachos.webchat.messages.send',
      { sessionId: body.sessionId, userId, text: body.text }
    );

    return c.json(response.payload);
  } catch (err) {
    logger.error({ err }, 'Error sending message');
    return c.json({ error: 'Failed to send message' }, 500);
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
    const response = await bus.request<GetMessagesRequest, GetMessagesResponse>(
      'nachos.webchat.messages.get',
      { sessionId, userId, limit, offset }
    );

    return c.json(response.payload);
  } catch (err) {
    logger.error({ err }, 'Error getting messages');
    return c.json({ error: 'Failed to get messages' }, 500);
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
        const subscription = await bus.subscribe(
          `nachos.webchat.messages.${sessionId}`,
          async (envelope) => {
            try {
              await stream.writeSSE({
                data: JSON.stringify(envelope.payload),
                event: 'message',
              });
            } catch (err) {
              logger.error({ err }, 'Error writing SSE');
            }
          }
        );

        // Subscribe to status events (thinking, tool, done, error)
        const statusSubscription = await bus.subscribe(
          `nachos.status.${sessionId}.*`,
          async (envelope) => {
            try {
              const payload = envelope.payload as {
                status?: string;
                toolName?: string;
                error?: string;
              };
              await stream.writeSSE({
                data: JSON.stringify({
                  type: payload.status,
                  tool: payload.toolName,
                  error: payload.error,
                }),
                event: 'status',
              });
            } catch (err) {
              logger.error({ err }, 'Error writing status SSE');
            }
          }
        );

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
            statusSubscription.unsubscribe();
            resolve();
          });
        });
      } catch (err) {
        logger.error({ err }, 'SSE stream error');
        await stream.writeSSE({
          data: JSON.stringify({ type: 'error', error: 'Internal stream error' }),
          event: 'error',
        });
      }
    });
  } catch (err) {
    logger.error({ err }, 'Error setting up stream');
    return c.json({ error: 'Failed to setup message stream' }, 500);
  }
});
