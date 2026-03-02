/**
 * Interface for sessions and messages storage.
 * Implemented by both SqliteSessionsStore and PostgresSessionsStore.
 */

import type {
  Session,
  SessionStatus,
  Message,
  SessionWithMessages,
  SessionConfig,
  MessageRole,
} from '@nachos/types';

/**
 * Data for creating a new session
 */
export interface CreateSessionData {
  channel: string;
  conversationId: string;
  userId: string;
  systemPrompt?: string;
  config?: SessionConfig;
  metadata?: Record<string, unknown>;
}

/**
 * Data for updating a session
 */
export interface UpdateSessionData {
  status?: SessionStatus;
  systemPrompt?: string;
  config?: SessionConfig;
  metadata?: Record<string, unknown>;
}

/**
 * Data for creating a new message
 */
export interface CreateMessageData {
  sessionId: string;
  role: MessageRole;
  content: string;
  toolCalls?: unknown;
}

/**
 * Sessions storage interface - all methods return promises for consistency
 */
export interface SessionsStore {
  /**
   * Create a new session
   */
  createSession(data: CreateSessionData): Promise<Session>;

  /**
   * Get or create a session atomically (race condition safe)
   */
  getOrCreateSessionAtomic(
    data: CreateSessionData
  ): Promise<{ session: Session; created: boolean }>;

  /**
   * Get a session by ID
   */
  getSession(id: string): Promise<Session | null>;

  /**
   * Get a session by channel and conversation ID
   */
  getSessionByConversation(channel: string, conversationId: string): Promise<Session | null>;

  /**
   * Update a session
   */
  updateSession(id: string, data: UpdateSessionData): Promise<Session | null>;

  /**
   * Delete a session and its messages
   */
  deleteSession(id: string): Promise<boolean>;

  /**
   * List sessions with optional filtering
   */
  listSessions(options?: {
    channel?: string;
    status?: SessionStatus;
    limit?: number;
    offset?: number;
  }): Promise<Session[]>;

  /**
   * Add a message to a session
   */
  addMessage(data: CreateMessageData): Promise<Message>;

  /**
   * Get messages for a session
   */
  getMessages(sessionId: string, options?: { limit?: number; offset?: number }): Promise<Message[]>;

  /**
   * Get a session with its messages
   */
  getSessionWithMessages(id: string): Promise<SessionWithMessages | null>;

  /**
   * Get the count of messages in a session
   */
  getMessageCount(sessionId: string): Promise<number>;

  /**
   * Replace all messages for a session (used after compaction)
   */
  replaceMessages(sessionId: string, messages: Message[]): Promise<number>;

  /**
   * List active sessions (last activity within 24 hours OR pinned)
   */
  listActive(options?: {
    channel?: string;
    userId?: string;
    limit?: number;
    offset?: number;
  }): Promise<Session[]>;

  /**
   * List archived sessions
   */
  listArchived(options?: {
    channel?: string;
    userId?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<Session[]>;

  /**
   * Archive a session
   */
  archive(sessionId: string): Promise<boolean>;

  /**
   * Restore a session from archive
   */
  restore(sessionId: string): Promise<boolean>;

  /**
   * Pin or unpin a session
   */
  pin(sessionId: string, pinned: boolean): Promise<boolean>;

  /**
   * Close the storage connection
   */
  close(): Promise<void>;
}

/**
 * @deprecated Use SessionsStore instead
 */
export type ISessionsStore = SessionsStore;
