/**
 * SQLite state storage for sessions and messages
 */
import Database from 'better-sqlite3';
import type {
  Session,
  SessionStatus,
  Message,
  MessageRole,
  SessionConfig,
  SessionWithMessages,
} from '@nachos/types';
import { v4 as uuid } from 'uuid';

/**
 * Schema initialization SQL
 */
const INIT_SCHEMA = `
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    system_prompt TEXT,
    config TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(channel, conversation_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    tool_calls TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  );

  CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_channel_conversation ON sessions(channel, conversation_id);
`;

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
 * Row type for session database queries
 */
interface SessionRow {
  id: string;
  channel: string;
  conversation_id: string;
  user_id: string;
  status: SessionStatus;
  system_prompt: string | null;
  config: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Row type for message database queries
 */
interface MessageRow {
  id: string;
  session_id: string;
  role: MessageRole;
  content: string;
  tool_calls: string | null;
  created_at: string;
}

/**
 * State storage class for managing sessions and messages in SQLite
 */
export class StateStorage {
  private db: Database.Database;

  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(INIT_SCHEMA);
  }

  /**
   * Convert a database row to a Session object
   */
  private rowToSession(row: SessionRow): Session {
    return {
      id: row.id,
      channel: row.channel,
      conversationId: row.conversation_id,
      userId: row.user_id,
      status: row.status,
      systemPrompt: row.system_prompt ?? undefined,
      config: row.config ? (JSON.parse(row.config) as SessionConfig) : {},
      metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Convert a database row to a Message object
   */
  private rowToMessage(row: MessageRow): Message {
    return {
      id: row.id,
      sessionId: row.session_id,
      role: row.role,
      content: row.content,
      toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
      createdAt: row.created_at,
    };
  }

  /**
   * Create a new session
   */
  createSession(data: CreateSessionData): Session {
    const now = new Date().toISOString();
    const id = uuid();

    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, channel, conversation_id, user_id, status, system_prompt, config, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      data.channel,
      data.conversationId,
      data.userId,
      data.systemPrompt ?? null,
      data.config ? JSON.stringify(data.config) : null,
      data.metadata ? JSON.stringify(data.metadata) : null,
      now,
      now
    );

    return {
      id,
      channel: data.channel,
      conversationId: data.conversationId,
      userId: data.userId,
      status: 'active',
      systemPrompt: data.systemPrompt,
      config: data.config ?? {},
      metadata: data.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Get a session by ID
   */
  getSession(id: string): Session | null {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
    const row = stmt.get(id) as SessionRow | undefined;
    return row ? this.rowToSession(row) : null;
  }

  /**
   * Get a session by channel and conversation ID
   */
  getSessionByConversation(channel: string, conversationId: string): Session | null {
    const stmt = this.db.prepare(
      'SELECT * FROM sessions WHERE channel = ? AND conversation_id = ?'
    );
    const row = stmt.get(channel, conversationId) as SessionRow | undefined;
    return row ? this.rowToSession(row) : null;
  }

  /**
   * Update a session
   */
  updateSession(id: string, data: UpdateSessionData): Session | null {
    const session = this.getSession(id);
    if (!session) {
      return null;
    }

    const now = new Date().toISOString();
    const updates: string[] = ['updated_at = ?'];
    const values: unknown[] = [now];

    if (data.status !== undefined) {
      updates.push('status = ?');
      values.push(data.status);
    }
    if (data.systemPrompt !== undefined) {
      updates.push('system_prompt = ?');
      values.push(data.systemPrompt);
    }
    if (data.config !== undefined) {
      updates.push('config = ?');
      values.push(JSON.stringify(data.config));
    }
    if (data.metadata !== undefined) {
      updates.push('metadata = ?');
      values.push(JSON.stringify(data.metadata));
    }

    values.push(id);

    const stmt = this.db.prepare(`UPDATE sessions SET ${updates.join(', ')} WHERE id = ?`);
    stmt.run(...values);

    return this.getSession(id);
  }

  /**
   * Delete a session and its messages
   */
  deleteSession(id: string): boolean {
    const deleteMessages = this.db.prepare('DELETE FROM messages WHERE session_id = ?');
    const deleteSession = this.db.prepare('DELETE FROM sessions WHERE id = ?');

    const transaction = this.db.transaction(() => {
      deleteMessages.run(id);
      const result = deleteSession.run(id);
      return result.changes > 0;
    });

    return transaction();
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
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (options?.channel) {
      conditions.push('channel = ?');
      values.push(options.channel);
    }
    if (options?.status) {
      conditions.push('status = ?');
      values.push(options.status);
    }

    let sql = 'SELECT * FROM sessions';
    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }
    sql += ' ORDER BY updated_at DESC';

    if (options?.limit) {
      sql += ' LIMIT ?';
      values.push(options.limit);
    }
    if (options?.offset) {
      sql += ' OFFSET ?';
      values.push(options.offset);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...values) as SessionRow[];
    return rows.map((row) => this.rowToSession(row));
  }

  /**
   * Add a message to a session
   */
  addMessage(data: CreateMessageData): Message {
    const now = new Date().toISOString();
    const id = uuid();

    const stmt = this.db.prepare(`
      INSERT INTO messages (id, session_id, role, content, tool_calls, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      data.sessionId,
      data.role,
      data.content,
      data.toolCalls ? JSON.stringify(data.toolCalls) : null,
      now
    );

    // Update session's updated_at
    const updateSession = this.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?');
    updateSession.run(now, data.sessionId);

    return {
      id,
      sessionId: data.sessionId,
      role: data.role,
      content: data.content,
      toolCalls: data.toolCalls,
      createdAt: now,
    };
  }

  /**
   * Get messages for a session
   */
  getMessages(sessionId: string, options?: { limit?: number; offset?: number }): Message[] {
    let sql = 'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC';
    const values: unknown[] = [sessionId];

    if (options?.limit) {
      sql += ' LIMIT ?';
      values.push(options.limit);
    }
    if (options?.offset) {
      sql += ' OFFSET ?';
      values.push(options.offset);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...values) as MessageRow[];
    return rows.map((row) => this.rowToMessage(row));
  }

  /**
   * Get a session with its messages
   */
  getSessionWithMessages(id: string): SessionWithMessages | null {
    const session = this.getSession(id);
    if (!session) {
      return null;
    }

    const messages = this.getMessages(id);
    return { ...session, messages };
  }

  /**
   * Get the count of messages in a session
   */
  getMessageCount(sessionId: string): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM messages WHERE session_id = ?');
    const result = stmt.get(sessionId) as { count: number };
    return result.count;
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }
}
