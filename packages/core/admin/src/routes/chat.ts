import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { createBusClient, TOPICS } from '@nachos/bus';
import type { NachosBusClient } from '@nachos/bus';
import type {
  ChannelInboundMessageType as ChannelInboundMessage,
  ChannelOutboundMessageType as ChannelOutboundMessage,
} from '@nachos/types';
import { createLogger } from '@nachos/types';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { AdminChatSessionStore } from './admin-chat-session-store.js';

const logger = createLogger('admin-chat');

const NATS_URL = process.env['NATS_URL'] ?? 'nats://localhost:4222';
const NATS_TOKEN = process.env['NATS_TOKEN'] ?? '';
const CHANNEL_ID = 'webchat';
const STATE_DIR = process.env['NACHOS_STATE_DIR'] ?? '/app/state';

export const chatRouter = new Hono();

// Get or create bus client connection
let busClient: NachosBusClient | null = null;

async function getBusClient(): Promise<NachosBusClient> {
  if (!busClient) {
    busClient = createBusClient({
      servers: [NATS_URL],
      name: 'admin-chat',
      token: NATS_TOKEN || undefined,
    });
    await busClient.connect();
  }
  return busClient;
}

// SQLite-backed session store (persists across restarts)
const sessions = new AdminChatSessionStore(path.join(STATE_DIR, 'admin-chat.db'));

// POST /api/chat/send
chatRouter.post('/send', async (c) => {
  try {
    const body = await c.req.json<{ message: string; sessionId?: string }>();
    const { message, sessionId: clientSessionId } = body;

    if (!message || typeof message !== 'string') {
      return c.json({ error: 'Message is required' }, 400);
    }

    const bus = await getBusClient();

    // Get or create session
    let session = clientSessionId ? sessions.get(clientSessionId) : undefined;
    if (!session) {
      const newSessionId = randomUUID();
      const now = new Date().toISOString();
      session = {
        id: newSessionId,
        userId: `web-user-${newSessionId.slice(0, 8)}`,
        conversationId: newSessionId,
        createdAt: now,
        updatedAt: now,
      };
      sessions.set(session);
    }

    // Publish message to gateway via bus client (auto-wraps in envelope)
    const inboundMsg: ChannelInboundMessage = {
      channel: CHANNEL_ID,
      channelMessageId: randomUUID(),
      sessionId: session.id,
      sender: {
        id: session.userId,
        name: 'Web User',
        isAllowed: true,
      },
      conversation: {
        id: session.conversationId,
        type: 'dm' as const,
      },
      content: {
        text: message,
      },
      metadata: {},
    };

    const topic = TOPICS.channel.inbound(CHANNEL_ID);
    bus.publish(topic, inboundMsg, { type: 'channel.inbound' });

    return c.json({
      ok: true,
      sessionId: session.id,
      messageId: randomUUID(),
    });
  } catch (err) {
    logger.error({ err }, 'Send error');
    return c.json({ error: 'Failed to send message', details: String(err) }, 500);
  }
});

// POST /api/chat/reset
chatRouter.post('/reset', async (c) => {
  try {
    const body = await c.req.json<{ sessionId?: string }>();
    const { sessionId } = body;

    if (sessionId) {
      sessions.delete(sessionId);
    }

    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: 'Failed to reset session', details: String(err) }, 500);
  }
});

// GET /api/chat/stream (SSE)
chatRouter.get('/stream', async (c) => {
  const sessionId = c.req.query('sessionId');

  if (!sessionId) {
    return c.json({ error: 'sessionId query parameter required' }, 400);
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return c.json({ error: 'Session not found' }, 404);
  }

  return streamSSE(c, async (stream) => {
    try {
      const bus = await getBusClient();

      // Subscribe to outbound messages for this channel
      const outboundTopic = TOPICS.channel.outbound(CHANNEL_ID);
      await bus.subscribe<ChannelOutboundMessage>(outboundTopic, async (envelope) => {
        try {
          const outbound = envelope.payload;
          if (outbound?.conversationId === session.conversationId) {
            await stream.writeSSE({
              data: JSON.stringify({
                type: 'message',
                text: outbound.content.text,
                timestamp: new Date().toISOString(),
              }),
              event: 'message',
            });
          }
        } catch (err) {
          logger.error({ err }, 'Error processing outbound message');
        }
      });

      // Send initial connection event
      await stream.writeSSE({
        data: JSON.stringify({ type: 'connected', sessionId }),
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
          resolve();
        });
      });
    } catch (err) {
      logger.error({ err }, 'SSE stream error');
      await stream.writeSSE({
        data: JSON.stringify({ type: 'error', error: String(err) }),
        event: 'error',
      });
    }
  });
});
