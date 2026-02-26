/**
 * Interface for sessions and messages storage.
 * Implemented by both StateStorage (SQLite) and PostgresSessionsStore.
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
 * Sessions storage interface - supports both sync (SQLite) and async (Postgres) implementations
 */
export interface ISessionsStore {
  /**
   * Create a new session
   */
  createSession(data: CreateSessionData): Session | Promise<Session>;

  /**
   * Get or create a session atomically (race condition safe)
   */
  getOrCreateSessionAtomic(data: CreateSessionData): 
    | { session: Session; created: boolean }
    | Promise<{ session: Session; created: boolean }>;

  /**
   * Get a session by ID
   */
  getSession(id: string): Session | null | Promise<Session | null>;

  /**
   * Get a session by channel and conversation ID
   */
  getSessionByConversation(channel: string, conversationId: string): 
    | Session
    | null
    | Promise<Session | null>;

  /**
   * Update a session
   */
  updateSession(id: string, data: UpdateSessionData): Session | null | Promise<Session | null>;

  /**
   * Delete a session and its messages
   */
  deleteSession(id: string): boolean | Promise<boolean>;

  /**
   * List sessions with optional filtering
   */
  listSessions(options?: {
    channel?: string;
    status?: SessionStatus;
    limit?: number;
    offset?: number;
  }): Session[] | Promise<Session[]>;

  /**
   * Add a message to a session
   */
  addMessage(data: CreateMessageData): Message | Promise<Message>;

  /**
   * Get messages for a session
   */
  getMessages(
    sessionId: string,
    options?: { limit?: number; offset?: number }
  ): Message[] | Promise<Message[]>;

  /**
   * Get a session with its messages
   */
  getSessionWithMessages(id: string): SessionWithMessages | null | Promise<SessionWithMessages | null>;

  /**
   * Get the count of messages in a session
   */
  getMessageCount(sessionId: string): number | Promise<number>;

  /**
   * Replace all messages for a session (used after compaction)
   */
  replaceMessages(sessionId: string, messages: Message[]): number | Promise<number>;

  /**
   * Close the storage connection
   */
  close(): void | Promise<void>;
}
