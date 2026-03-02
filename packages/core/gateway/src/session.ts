/**
 * Session Manager - Manages the lifecycle of sessions
 */
import type {
  Session,
  SessionStatus,
  SessionConfig,
  SessionWithMessages,
  Message,
  MessageRole,
} from '@nachos/types';
import { createLogger } from '@nachos/types';
import { StateStorage, type CreateSessionData } from './state.js';

const logger = createLogger('session-manager');

/**
 * Options for creating a session
 */
export interface CreateSessionOptions {
  channel: string;
  conversationId: string;
  userId: string;
  systemPrompt?: string;
  config?: SessionConfig;
  metadata?: Record<string, unknown>;
}

/**
 * Options for adding a message
 */
export interface AddMessageOptions {
  role: MessageRole;
  content: string;
  toolCalls?: unknown;
}

/**
 * Session Manager class
 */
export class SessionManager {
  private storage: StateStorage;
  private maxMessagesPerSession: number;
  private messageWarningThreshold: number;

  constructor(storage: StateStorage, options?: { maxMessagesPerSession?: number }) {
    this.storage = storage;
    // M2: Configurable max message limit (default: 10000)
    this.maxMessagesPerSession = options?.maxMessagesPerSession ?? 10000;
    // Warn when reaching 90% of max
    this.messageWarningThreshold = Math.floor(this.maxMessagesPerSession * 0.9);
  }

  /**
   * Create a new session or return existing one for the conversation
   * C2: Uses atomic transaction to prevent race conditions
   */
  async getOrCreateSession(options: CreateSessionOptions): Promise<Session> {
    const createData: CreateSessionData = {
      channel: options.channel,
      conversationId: options.conversationId,
      userId: options.userId,
      systemPrompt: options.systemPrompt,
      config: options.config,
      metadata: options.metadata,
    };

    // Use atomic transaction to prevent TOCTOU race
    const { session } = await this.storage.getOrCreateSessionAtomic(createData);
    return session;
  }

  /**
   * Create a new session for the conversation without checking for existing ones.
   */
  async createSession(options: CreateSessionOptions): Promise<Session> {
    const createData: CreateSessionData = {
      channel: options.channel,
      conversationId: options.conversationId,
      userId: options.userId,
      systemPrompt: options.systemPrompt,
      config: options.config,
      metadata: options.metadata,
    };

    return await this.storage.createSession(createData);
  }

  /**
   * Reset the session for a conversation by deleting the existing session and creating a new one.
   */
  async resetSession(
    options: CreateSessionOptions
  ): Promise<{ previous?: Session; session: Session }> {
    const existing = await this.getSessionByConversation(options.channel, options.conversationId);
    if (existing) {
      await this.storage.deleteSession(existing.id);
    }

    const session = await this.createSession(options);
    return { previous: existing ?? undefined, session };
  }

  /**
   * Get a session by ID
   */
  async getSession(sessionId: string): Promise<Session | null> {
    return await this.storage.getSession(sessionId);
  }

  /**
   * Get a session by channel and conversation ID
   */
  async getSessionByConversation(channel: string, conversationId: string): Promise<Session | null> {
    return await this.storage.getSessionByConversation(channel, conversationId);
  }

  /**
   * Get a session with its messages
   */
  async getSessionWithMessages(sessionId: string): Promise<SessionWithMessages | null> {
    return await this.storage.getSessionWithMessages(sessionId);
  }

  /**
   * Update session status
   */
  async updateStatus(sessionId: string, status: SessionStatus): Promise<Session | null> {
    return await this.storage.updateSession(sessionId, { status });
  }

  /**
   * Pause a session
   */
  async pauseSession(sessionId: string): Promise<Session | null> {
    return await this.updateStatus(sessionId, 'paused');
  }

  /**
   * End a session
   */
  async endSession(sessionId: string): Promise<Session | null> {
    return await this.updateStatus(sessionId, 'ended');
  }

  /**
   * Reactivate a session
   */
  async reactivateSession(sessionId: string): Promise<Session | null> {
    const session = await this.getSession(sessionId);
    if (!session) {
      return null;
    }

    if (session.status === 'active') {
      return session;
    }

    return await this.updateStatus(sessionId, 'active');
  }

  /**
   * Update session configuration
   */
  async updateConfig(sessionId: string, config: Partial<SessionConfig>): Promise<Session | null> {
    const session = await this.getSession(sessionId);
    if (!session) {
      return null;
    }

    const newConfig: SessionConfig = {
      ...session.config,
      ...config,
    };

    return await this.storage.updateSession(sessionId, { config: newConfig });
  }

  /**
   * Update session system prompt
   */
  async updateSystemPrompt(sessionId: string, systemPrompt: string): Promise<Session | null> {
    return await this.storage.updateSession(sessionId, { systemPrompt });
  }

  /**
   * Update session metadata
   */
  async updateMetadata(
    sessionId: string,
    metadata: Record<string, unknown>
  ): Promise<Session | null> {
    const session = await this.getSession(sessionId);
    if (!session) {
      return null;
    }

    const newMetadata = {
      ...session.metadata,
      ...metadata,
    };

    return await this.storage.updateSession(sessionId, { metadata: newMetadata });
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<boolean> {
    return await this.storage.deleteSession(sessionId);
  }

  /**
   * List sessions with optional filtering
   */
  async listSessions(options?: {
    channel?: string;
    status?: SessionStatus;
    limit?: number;
    offset?: number;
  }): Promise<Session[]> {
    return await this.storage.listSessions(options);
  }

  /**
   * Add a message to a session
   * M2: Logs warning when approaching message limit
   */
  async addMessage(sessionId: string, options: AddMessageOptions): Promise<Message | null> {
    const session = await this.getSession(sessionId);
    if (!session) {
      return null;
    }

    if (session.status !== 'active') {
      return null;
    }

    // M2: Check message count and warn if approaching limit
    const currentCount = await this.storage.getMessageCount(sessionId);

    if (currentCount >= this.maxMessagesPerSession) {
      logger.warn(
        { sessionId, messageCount: currentCount, maxMessages: this.maxMessagesPerSession },
        'Session has reached maximum message limit'
      );
      return null;
    }

    if (currentCount >= this.messageWarningThreshold) {
      logger.warn(
        { sessionId, messageCount: currentCount, maxMessages: this.maxMessagesPerSession },
        'Session is approaching maximum message limit'
      );
    }

    return await this.storage.addMessage({
      sessionId,
      role: options.role,
      content: options.content,
      toolCalls: options.toolCalls,
    });
  }

  /**
   * Get messages for a session
   */
  async getMessages(
    sessionId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<Message[]> {
    return await this.storage.getMessages(sessionId, options);
  }

  /**
   * Get the count of messages in a session
   */
  async getMessageCount(sessionId: string): Promise<number> {
    return await this.storage.getMessageCount(sessionId);
  }

  /**
   * Replace all messages for a session (used after context compaction)
   *
   * This is an atomic operation that deletes existing messages and inserts new ones.
   * Used by context management to update message history after compaction.
   */
  async replaceMessages(sessionId: string, messages: Message[]): Promise<number> {
    return await this.storage.replaceMessages(sessionId, messages);
  }
}
