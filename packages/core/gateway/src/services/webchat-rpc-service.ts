/**
 * WebChat RPC Service
 *
 * Provides NATS-based RPC endpoints for web chat session management
 * and message streaming via pub/sub.
 */

import type { NachosBusClient, MessageHandler, MessageEnvelope } from '@nachos/bus';
import { TOPICS } from '@nachos/bus';
import type { SessionsStore } from '@nachos/state';
import type { Message } from '@nachos/types';
import { createLogger } from '@nachos/types';

/**
 * Raw NATS message interface for RPC responses
 */
interface RpcRawMsg {
  subject: string;
  reply?: string;
  respond: (data: unknown) => boolean;
}

const logger = createLogger('webchat-rpc');

/**
 * RPC request/response types
 */

export interface ListSessionsRequest {
  userId: string;
  channel?: string;
  limit?: number;
  offset?: number;
}

export interface ListSessionsResponse {
  sessions: Array<{
    id: string;
    name: string;
    lastActivity: string;
    messageCount: number;
    isPinned: boolean;
  }>;
}

export interface ListArchivedRequest {
  userId: string;
  channel?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ListArchivedResponse {
  sessions: Array<{
    id: string;
    name: string;
    archivedAt: string;
    messageCount: number;
  }>;
  total: number;
}

export interface CreateSessionRequest {
  userId: string;
  channel: string;
  conversationId?: string;
  systemPrompt?: string;
}

export interface CreateSessionResponse {
  session: {
    id: string;
    name: string;
    createdAt: string;
  };
}

export interface ArchiveSessionRequest {
  sessionId: string;
  userId: string;
}

export interface ArchiveSessionResponse {
  ok: boolean;
}

export interface RestoreSessionRequest {
  sessionId: string;
  userId: string;
}

export interface RestoreSessionResponse {
  ok: boolean;
}

export interface DeleteSessionRequest {
  sessionId: string;
  userId: string;
}

export interface DeleteSessionResponse {
  ok: boolean;
}

export interface PinSessionRequest {
  sessionId: string;
  userId: string;
  pinned: boolean;
}

export interface PinSessionResponse {
  ok: boolean;
}

export interface SendMessageRequest {
  sessionId: string;
  userId: string;
  text: string;
}

export interface SendMessageResponse {
  messageId: string;
  timestamp: string;
}

export interface GetMessagesRequest {
  sessionId: string;
  userId: string;
  limit?: number;
  offset?: number;
}

export interface GetMessagesResponse {
  messages: Message[];
  total: number;
}

/**
 * Message published to topic for streaming
 */
export interface StreamedMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: string;
  toolCalls?: unknown;
}

/**
 * WebChat RPC Service
 *
 * Handles RPC requests for session management and publishes messages
 * to session-specific topics for real-time streaming.
 */
export class WebChatRPCService {
  private subscriptions: Array<{ unsubscribe: () => void }> = [];

  constructor(
    private bus: NachosBusClient,
    private store: SessionsStore
  ) {}

  /**
   * Start the RPC service and register handlers
   */
  async start(): Promise<void> {
    logger.info('Starting WebChat RPC service');

    // Register RPC handlers
    await this.registerHandler('nachos.webchat.sessions.list', this.handleListSessions.bind(this));
    await this.registerHandler(
      'nachos.webchat.sessions.listArchived',
      this.handleListArchived.bind(this)
    );
    await this.registerHandler(
      'nachos.webchat.sessions.create',
      this.handleCreateSession.bind(this)
    );
    await this.registerHandler(
      'nachos.webchat.sessions.archive',
      this.handleArchiveSession.bind(this)
    );
    await this.registerHandler(
      'nachos.webchat.sessions.restore',
      this.handleRestoreSession.bind(this)
    );
    await this.registerHandler(
      'nachos.webchat.sessions.delete',
      this.handleDeleteSession.bind(this)
    );
    await this.registerHandler('nachos.webchat.sessions.pin', this.handlePinSession.bind(this));
    await this.registerHandler('nachos.webchat.messages.send', this.handleSendMessage.bind(this));
    await this.registerHandler('nachos.webchat.messages.get', this.handleGetMessages.bind(this));

    // Listen for outbound messages from the gateway and forward to the SSE stream
    const outboundSub = await this.bus.subscribe(
      TOPICS.channel.outbound('webchat'),
      async (
        outboundEnvelope: MessageEnvelope<{
          sessionId?: string;
          conversationId?: string;
          content?: { text?: string; format?: string };
        }>
      ) => {
        try {
          const outbound = outboundEnvelope.payload;
          const sessionId = outbound.sessionId;
          const conversationId = outbound.conversationId;

          // Resolve session ID from conversation ID if needed
          let resolvedSessionId = sessionId;
          if (!resolvedSessionId && conversationId) {
            const session = await this.store.getSessionByConversation('webchat', conversationId);
            resolvedSessionId = session?.id;
          }

          if (!resolvedSessionId) {
            logger.warn({ outbound }, 'Could not resolve session for outbound webchat message');
            return;
          }

          const text = outbound.content?.text ?? '';

          const streamedMessage: StreamedMessage = {
            id: `assistant-${Date.now()}`,
            sessionId: resolvedSessionId,
            role: 'assistant',
            content: text,
            timestamp: new Date().toISOString(),
          };

          this.bus.publish(`nachos.webchat.messages.${resolvedSessionId}`, streamedMessage);
          logger.debug(
            { sessionId: resolvedSessionId },
            'Forwarded assistant response to webchat stream'
          );
        } catch (err) {
          logger.error({ err }, 'Error handling webchat outbound message');
        }
      }
    );
    this.subscriptions.push(outboundSub);

    logger.info('WebChat RPC service started');
  }

  /**
   * Stop the RPC service and clean up subscriptions
   */
  async stop(): Promise<void> {
    logger.info('Stopping WebChat RPC service');

    for (const sub of this.subscriptions) {
      sub.unsubscribe();
    }
    this.subscriptions = [];

    logger.info('WebChat RPC service stopped');
  }

  /**
   * Register an RPC handler
   */
  private async registerHandler<TReq>(topic: string, handler: MessageHandler<TReq>): Promise<void> {
    const sub = await this.bus.subscribe(topic, handler);
    this.subscriptions.push(sub);
    logger.debug({ topic }, 'Registered RPC handler');
  }

  /**
   * Generate session name from timestamp
   */
  private generateSessionName(): string {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const timeStr = now.toTimeString().substring(0, 5); // HH:MM
    return `Session ${dateStr} ${timeStr}`;
  }

  /**
   * Handler: List active sessions
   */
  private async handleListSessions(
    envelope: MessageEnvelope<ListSessionsRequest>,
    rawMsg: RpcRawMsg
  ): Promise<void> {
    try {
      const request = envelope.payload;
      logger.debug({ request }, 'Handling listSessions');

      const sessions = await this.store.listActive({
        channel: request.channel,
        userId: request.userId,
        limit: request.limit,
        offset: request.offset,
      });

      const response: ListSessionsResponse = {
        sessions: await Promise.all(
          sessions.map(async (session) => ({
            id: session.id,
            name: this.generateSessionName(), // Use auto-generated name
            lastActivity: session.lastActivity,
            messageCount: await this.store.getMessageCount(session.id),
            isPinned: session.isPinned,
          }))
        ),
      };

      rawMsg.respond(response);
    } catch (error) {
      logger.error({ err: error }, 'Error in handleListSessions');
      rawMsg.respond({ error: 'Failed to list sessions' });
    }
  }

  /**
   * Handler: List archived sessions
   */
  private async handleListArchived(
    envelope: MessageEnvelope<ListArchivedRequest>,
    rawMsg: RpcRawMsg
  ): Promise<void> {
    try {
      const request = envelope.payload;
      logger.debug({ request }, 'Handling listArchived');

      const sessions = await this.store.listArchived({
        channel: request.channel,
        userId: request.userId,
        search: request.search,
        limit: request.limit,
        offset: request.offset,
      });

      const response: ListArchivedResponse = {
        sessions: await Promise.all(
          sessions.map(async (session) => ({
            id: session.id,
            name: this.generateSessionName(),
            archivedAt: session.updatedAt, // Use updatedAt as archived time
            messageCount: await this.store.getMessageCount(session.id),
          }))
        ),
        total: sessions.length,
      };

      rawMsg.respond(response);
    } catch (error) {
      logger.error({ err: error }, 'Error in handleListArchived');
      rawMsg.respond({ error: 'Failed to list archived sessions' });
    }
  }

  /**
   * Handler: Create session
   */
  private async handleCreateSession(
    envelope: MessageEnvelope<CreateSessionRequest>,
    rawMsg: RpcRawMsg
  ): Promise<void> {
    try {
      const request = envelope.payload;
      logger.debug({ request }, 'Handling createSession');

      // Generate conversation ID if not provided
      const conversationId = request.conversationId || `webchat-${Date.now()}`;

      const session = await this.store.createSession({
        channel: request.channel,
        conversationId,
        userId: request.userId,
        systemPrompt: request.systemPrompt,
      });

      const response: CreateSessionResponse = {
        session: {
          id: session.id,
          name: this.generateSessionName(),
          createdAt: session.createdAt,
        },
      };

      rawMsg.respond(response);
    } catch (error) {
      logger.error({ err: error }, 'Error in handleCreateSession');
      rawMsg.respond({ error: 'Failed to create session' });
    }
  }

  /**
   * Handler: Archive session
   */
  private async handleArchiveSession(
    envelope: MessageEnvelope<ArchiveSessionRequest>,
    rawMsg: RpcRawMsg
  ): Promise<void> {
    try {
      const request = envelope.payload;
      logger.debug({ request }, 'Handling archiveSession');

      // Verify user owns the session
      const session = await this.store.getSession(request.sessionId);
      if (!session || session.userId !== request.userId) {
        rawMsg.respond({ error: 'Session not found or access denied' });
        return;
      }

      const ok = await this.store.archive(request.sessionId);
      const response: ArchiveSessionResponse = { ok };

      rawMsg.respond(response);
    } catch (error) {
      logger.error({ err: error }, 'Error in handleArchiveSession');
      rawMsg.respond({ error: 'Failed to archive session' });
    }
  }

  /**
   * Handler: Restore session
   */
  private async handleRestoreSession(
    envelope: MessageEnvelope<RestoreSessionRequest>,
    rawMsg: RpcRawMsg
  ): Promise<void> {
    try {
      const request = envelope.payload;
      logger.debug({ request }, 'Handling restoreSession');

      // Verify user owns the session
      const session = await this.store.getSession(request.sessionId);
      if (!session || session.userId !== request.userId) {
        rawMsg.respond({ error: 'Session not found or access denied' });
        return;
      }

      const ok = await this.store.restore(request.sessionId);
      const response: RestoreSessionResponse = { ok };

      rawMsg.respond(response);
    } catch (error) {
      logger.error({ err: error }, 'Error in handleRestoreSession');
      rawMsg.respond({ error: 'Failed to restore session' });
    }
  }

  /**
   * Handler: Delete session
   */
  private async handleDeleteSession(
    envelope: MessageEnvelope<DeleteSessionRequest>,
    rawMsg: RpcRawMsg
  ): Promise<void> {
    try {
      const request = envelope.payload;
      logger.debug({ request }, 'Handling deleteSession');

      // Verify user owns the session
      const session = await this.store.getSession(request.sessionId);
      if (!session || session.userId !== request.userId) {
        rawMsg.respond({ error: 'Session not found or access denied' });
        return;
      }

      const ok = await this.store.deleteSession(request.sessionId);
      const response: DeleteSessionResponse = { ok };

      rawMsg.respond(response);
    } catch (error) {
      logger.error({ err: error }, 'Error in handleDeleteSession');
      rawMsg.respond({ error: 'Failed to delete session' });
    }
  }

  /**
   * Handler: Pin/unpin session
   */
  private async handlePinSession(
    envelope: MessageEnvelope<PinSessionRequest>,
    rawMsg: RpcRawMsg
  ): Promise<void> {
    try {
      const request = envelope.payload;
      logger.debug({ request }, 'Handling pinSession');

      // Verify user owns the session
      const session = await this.store.getSession(request.sessionId);
      if (!session || session.userId !== request.userId) {
        rawMsg.respond({ error: 'Session not found or access denied' });
        return;
      }

      const ok = await this.store.pin(request.sessionId, request.pinned);
      const response: PinSessionResponse = { ok };

      rawMsg.respond(response);
    } catch (error) {
      logger.error({ err: error }, 'Error in handlePinSession');
      rawMsg.respond({ error: 'Failed to pin session' });
    }
  }

  /**
   * Handler: Send message
   *
   * Publishes a ChannelInboundMessage to the gateway's inbound topic so the
   * message flows through the full pipeline (session management, LLM, tools).
   * The assistant response arrives via the outbound listener registered in start().
   */
  private async handleSendMessage(
    envelope: MessageEnvelope<SendMessageRequest>,
    rawMsg: RpcRawMsg
  ): Promise<void> {
    try {
      const request = envelope.payload;
      logger.debug({ request }, 'Handling sendMessage');

      // Verify user owns the session
      const session = await this.store.getSession(request.sessionId);
      if (!session || session.userId !== request.userId) {
        rawMsg.respond({ error: 'Session not found or access denied' });
        return;
      }

      // Build a ChannelInboundMessage and publish to the gateway's inbound topic
      const inbound = {
        channel: 'webchat',
        channelMessageId: `webchat-${Date.now()}`,
        sessionId: request.sessionId,
        sender: {
          id: request.userId,
          isAllowed: true,
        },
        conversation: {
          id: session.conversationId,
          type: 'dm' as const,
        },
        content: {
          text: request.text,
        },
        metadata: {
          is_paired: true,
        },
      };

      await this.bus.publish(TOPICS.channel.inbound('webchat'), inbound, {
        type: 'channel.inbound',
      });

      const response: SendMessageResponse = {
        messageId: `pending-${Date.now()}`,
        timestamp: new Date().toISOString(),
      };

      rawMsg.respond(response);
    } catch (error) {
      logger.error({ err: error }, 'Error in handleSendMessage');
      rawMsg.respond({ error: 'Failed to send message' });
    }
  }

  /**
   * Handler: Get messages (with pagination)
   */
  private async handleGetMessages(
    envelope: MessageEnvelope<GetMessagesRequest>,
    rawMsg: RpcRawMsg
  ): Promise<void> {
    try {
      const request = envelope.payload;
      logger.debug({ request }, 'Handling getMessages');

      // Verify user owns the session
      const session = await this.store.getSession(request.sessionId);
      if (!session || session.userId !== request.userId) {
        rawMsg.respond({ error: 'Session not found or access denied' });
        return;
      }

      const messages = await this.store.getMessages(request.sessionId, {
        limit: request.limit,
        offset: request.offset,
      });

      const total = await this.store.getMessageCount(request.sessionId);

      const response: GetMessagesResponse = {
        messages,
        total,
      };

      rawMsg.respond(response);
    } catch (error) {
      logger.error({ err: error }, 'Error in handleGetMessages');
      rawMsg.respond({ error: 'Failed to get messages' });
    }
  }

  /**
   * Publish a message to a session's stream
   * (for use by other components, e.g., when assistant responds)
   */
  publishMessage(sessionId: string, message: StreamedMessage): void {
    this.bus.publish(`nachos.webchat.messages.${sessionId}`, message);
  }
}
