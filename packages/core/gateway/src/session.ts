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
  getOrCreateSession(options: CreateSessionOptions): Session {
    const createData: CreateSessionData = {
      channel: options.channel,
      conversationId: options.conversationId,
      userId: options.userId,
      systemPrompt: options.systemPrompt,
      config: options.config,
      metadata: options.metadata,
    };

    // Use atomic transaction to prevent TOCTOU race
    const { session } = this.storage.getOrCreateSessionAtomic(createData);
    return session;
  }

  /**
   * Create a new session for the conversation without checking for existing ones.
   */
  createSession(options: CreateSessionOptions): Session {
    const createData: CreateSessionData = {
      channel: options.channel,
      conversationId: options.conversationId,
      userId: options.userId,
      systemPrompt: options.systemPrompt,
      config: options.config,
      metadata: options.metadata,
    };

    return this.storage.createSession(createData);
  }

  /**
   * Reset the session for a conversation by deleting the existing session and creating a new one.
   */
  resetSession(options: CreateSessionOptions): { previous?: Session; session: Session } {
    const existing = this.getSessionByConversation(options.channel, options.conversationId);
    if (existing) {
      this.storage.deleteSession(existing.id);
    }

    const session = this.createSession(options);
    return { previous: existing ?? undefined, session };
  }

  /**
   * Get a session by ID
   */
  getSession(sessionId: string): Session | null {
    return this.storage.getSession(sessionId);
  }

  /**
   * Get a session by channel and conversation ID
   */
  getSessionByConversation(channel: string, conversationId: string): Session | null {
    return this.storage.getSessionByConversation(channel, conversationId);
  }

  /**
   * Get a session with its messages
   */
  getSessionWithMessages(sessionId: string): SessionWithMessages | null {
    return this.storage.getSessionWithMessages(sessionId);
  }

  /**
   * Update session status
   */
  updateStatus(sessionId: string, status: SessionStatus): Session | null {
    return this.storage.updateSession(sessionId, { status });
  }

  /**
   * Pause a session
   */
  pauseSession(sessionId: string): Session | null {
    return this.updateStatus(sessionId, 'paused');
  }

  /**
   * End a session
   */
  endSession(sessionId: string): Session | null {
    return this.updateStatus(sessionId, 'ended');
  }

  /**
   * Reactivate a session
   */
  reactivateSession(sessionId: string): Session | null {
    const session = this.getSession(sessionId);
    if (!session) {
      return null;
    }

    if (session.status === 'active') {
      return session;
    }

    return this.updateStatus(sessionId, 'active');
  }

  /**
   * Update session configuration
   */
  updateConfig(sessionId: string, config: Partial<SessionConfig>): Session | null {
    const session = this.getSession(sessionId);
    if (!session) {
      return null;
    }

    const newConfig: SessionConfig = {
      ...session.config,
      ...config,
    };

    return this.storage.updateSession(sessionId, { config: newConfig });
  }

  /**
   * Update session system prompt
   */
  updateSystemPrompt(sessionId: string, systemPrompt: string): Session | null {
    return this.storage.updateSession(sessionId, { systemPrompt });
  }

  /**
   * Update session metadata
   */
  updateMetadata(sessionId: string, metadata: Record<string, unknown>): Session | null {
    const session = this.getSession(sessionId);
    if (!session) {
      return null;
    }

    const newMetadata = {
      ...session.metadata,
      ...metadata,
    };

    return this.storage.updateSession(sessionId, { metadata: newMetadata });
  }

  /**
   * Delete a session
   */
  deleteSession(sessionId: string): boolean {
    return this.storage.deleteSession(sessionId);
  }

  /**
   * List sessions with optional filtering
   */
  listSessions(options?: {
    channel?: string;
    status?: SessionStatus;
    limit?: number;
    offset?: number;
  }): Session[] {
    return this.storage.listSessions(options);
  }

  /**
   * Add a message to a session
   * M2: Logs warning when approaching message limit
   */
  addMessage(sessionId: string, options: AddMessageOptions): Message | null {
    const session = this.getSession(sessionId);
    if (!session) {
      return null;
    }

    if (session.status !== 'active') {
      return null;
    }

    // M2: Check message count and warn if approaching limit
    const currentCount = this.storage.getMessageCount(sessionId);
    
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

    return this.storage.addMessage({
      sessionId,
      role: options.role,
      content: options.content,
      toolCalls: options.toolCalls,
    });
  }

  /**
   * Get messages for a session
   */
  getMessages(sessionId: string, options?: { limit?: number; offset?: number }): Message[] {
    return this.storage.getMessages(sessionId, options);
  }

  /**
   * Get the count of messages in a session
   */
  getMessageCount(sessionId: string): number {
    return this.storage.getMessageCount(sessionId);
  }

  /**
   * Replace all messages for a session (used after context compaction)
   *
   * This is an atomic operation that deletes existing messages and inserts new ones.
   * Used by context management to update message history after compaction.
   */
  replaceMessages(sessionId: string, messages: Message[]): number {
    return this.storage.replaceMessages(sessionId, messages);
  }
}
