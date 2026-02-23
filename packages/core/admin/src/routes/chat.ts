import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { connect, type NatsConnection } from 'nats';
import { TOPICS } from '@nachos/bus';
import type { 
  ChannelInboundMessageType as ChannelInboundMessage,
  ChannelOutboundMessageType as ChannelOutboundMessage 
} from '@nachos/types';
import { randomUUID } from 'node:crypto';

const NATS_URL = process.env['NATS_URL'] ?? 'nats://localhost:4222';
const CHANNEL_ID = 'web';

export const chatRouter = new Hono();

// Get or create NATS connection
let natsConnection: NatsConnection | null = null;

async function getNatsConnection(): Promise<NatsConnection> {
  if (!natsConnection || natsConnection.isClosed()) {
    natsConnection = await connect({ servers: NATS_URL });
  }
  return natsConnection;
}

// Session store (in-memory for now, could be moved to DB)
const sessions = new Map<string, { sessionId: string; userId: string; conversationId: string }>();

// POST /api/chat/send
chatRouter.post('/send', async (c) => {
  try {
    const body = await c.req.json<{ message: string; sessionId?: string }>();
    const { message, sessionId: clientSessionId } = body;

    if (!message || typeof message !== 'string') {
      return c.json({ error: 'Message is required' }, 400);
    }

    const nc = await getNatsConnection();

    // Get or create session
    let session = clientSessionId ? sessions.get(clientSessionId) : null;
    if (!session) {
      const newSessionId = randomUUID();
      session = {
        sessionId: newSessionId,
        userId: `web-user-${newSessionId.slice(0, 8)}`,
        conversationId: newSessionId,
      };
      sessions.set(newSessionId, session);
    }

    // Publish message to gateway via NATS
    const inboundMsg: ChannelInboundMessage = {
      channel: CHANNEL_ID,
      channelMessageId: randomUUID(),
      sessionId: session.sessionId,
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
    nc.publish(topic, JSON.stringify(inboundMsg));

    return c.json({
      ok: true,
      sessionId: session.sessionId,
      messageId: randomUUID(),
    });
  } catch (err) {
    console.error('[chat] Send error:', err);
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
      const nc = await getNatsConnection();

      // Subscribe to outbound messages for this channel
      const outboundTopic = TOPICS.channel.outbound(CHANNEL_ID);
      const outboundSub = nc.subscribe(outboundTopic);

      // Subscribe to status topics for this session
      const statusTopics = [
        TOPICS.status.thinking(session.sessionId),
        TOPICS.status.tool(session.sessionId),
        TOPICS.status.done(session.sessionId),
        TOPICS.status.error(session.sessionId),
      ];

      const statusSubs = await Promise.all(
        statusTopics.map((topic) => nc.subscribe(topic))
      );

      // Send initial connection event
      await stream.writeSSE({
        data: JSON.stringify({ type: 'connected', sessionId }),
        event: 'status',
      });

      // Process outbound messages
      (async () => {
        for await (const msg of outboundSub) {
          try {
            const outbound: ChannelOutboundMessage = JSON.parse(msg.string());
            if (outbound.conversationId === session.conversationId) {
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
            console.error('[chat] Error processing outbound message:', err);
          }
        }
      })();

      // Process status updates
      for (const statusSub of statusSubs) {
        (async () => {
          for await (const msg of statusSub) {
            try {
              const data = JSON.parse(msg.string());
              const topic = msg.subject;

              let type: string;
              if (topic.includes('.thinking')) type = 'thinking';
              else if (topic.includes('.tool')) type = 'tool';
              else if (topic.includes('.done')) type = 'done';
              else if (topic.includes('.error')) type = 'error';
              else continue;

              await stream.writeSSE({
                data: JSON.stringify({ type, ...data }),
                event: 'status',
              });
            } catch (err) {
              console.error('[chat] Error processing status message:', err);
            }
          }
        })();
      }

      // Keep connection alive
      const keepAlive = setInterval(async () => {
        try {
          await stream.writeSSE({
            data: JSON.stringify({ type: 'ping' }),
            event: 'ping',
          });
        } catch (err) {
          clearInterval(keepAlive);
        }
      }, 30000);

      // Wait for client disconnect
      await stream.onAbort(() => {
        clearInterval(keepAlive);
        outboundSub.unsubscribe();
        statusSubs.forEach((sub) => sub.unsubscribe());
      });
    } catch (err) {
      console.error('[chat] SSE stream error:', err);
      await stream.writeSSE({
        data: JSON.stringify({ type: 'error', error: String(err) }),
        event: 'error',
      });
    }
  });
});
