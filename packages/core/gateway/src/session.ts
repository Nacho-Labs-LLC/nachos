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
import { StateStorage, type CreateSessionData } from './state.js';

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

  constructor(storage: StateStorage) {
    this.storage = storage;
  }

  /**
   * Create a new session or return existing one for the conversation
   */
  getOrCreateSession(options: CreateSessionOptions): Session {
    // Check if session already exists for this conversation
    const existing = this.storage.getSessionByConversation(options.channel, options.conversationId);

    if (existing && existing.status === 'active') {
      return existing;
    }

    // If session exists but is not active, reactivate it
    if (existing) {
      const updated = this.storage.updateSession(existing.id, {
        status: 'active',
      });
      if (updated) {
        return updated;
      }
    }

    // Create new session
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
   */
  addMessage(sessionId: string, options: AddMessageOptions): Message | null {
    const session = this.getSession(sessionId);
    if (!session) {
      return null;
    }

    if (session.status !== 'active') {
      return null;
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
