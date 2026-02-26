/**
 * PostgreSQL sessions and messages storage implementation.
 * 
 * This store implements the same interface as StateStorage (SQLite version)
 * but uses PostgreSQL for multi-instance deployments with shared conversation history.
 */

import type { Pool } from 'pg';
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
 * PostgreSQL-based state storage for sessions and messages
 */
export class PostgresSessionsStore {
  private initialized = false;
  private schemaPromise: Promise<void> | null = null;
  private schema: string;

  constructor(
    private pool: Pool,
    schema?: string
  ) {
    this.schema = schema ?? 'public';
  }

  /**
   * Ensure schema and tables exist
   */
  private async ensureSchema(): Promise<void> {
    if (this.initialized) return;
    if (!this.schemaPromise) {
      this.schemaPromise = this.runSchema()
        .then(() => {
          this.initialized = true;
          this.schemaPromise = null;
        })
        .catch((err) => {
          this.schemaPromise = null;
          throw err;
        });
    }
    return this.schemaPromise;
  }

  /**
   * Create schema and tables if they don't exist
   */
  private async runSchema(): Promise<void> {
    await this.pool.query(`CREATE SCHEMA IF NOT EXISTS "${this.schema}"`);

    // Create sessions table
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS ${this.qualified('sessions')} (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        system_prompt TEXT,
        config JSONB,
        metadata JSONB,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(channel, conversation_id)
      )`
    );

    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS sessions_channel_conversation_idx 
       ON ${this.qualified('sessions')}(channel, conversation_id)`
    );

    // Create messages table
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS ${this.qualified('messages')} (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_calls JSONB,
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES ${this.qualified('sessions')}(id)
      )`
    );

    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS messages_session_id_idx 
       ON ${this.qualified('messages')}(session_id)`
    );
  }

  /**
   * Generate qualified table name with schema
   */
  private qualified(table: string): string {
    return `"${this.schema}".${table}`;
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
      config: row.config ? (typeof row.config === 'string' ? JSON.parse(row.config) : row.config) : {},
      metadata: row.metadata ? (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) : {},
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
      toolCalls: row.tool_calls ? (typeof row.tool_calls === 'string' ? JSON.parse(row.tool_calls) : row.tool_calls) : undefined,
      createdAt: row.created_at,
    };
  }

  /**
   * Create a new session
   */
  async createSession(data: CreateSessionData): Promise<Session> {
    await this.ensureSchema();
    const now = new Date().toISOString();
    const id = uuid();

    await this.pool.query(
      `INSERT INTO ${this.qualified('sessions')} 
       (id, channel, conversation_id, user_id, status, system_prompt, config, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        data.channel,
        data.conversationId,
        data.userId,
        'active',
        data.systemPrompt ?? null,
        data.config ? JSON.stringify(data.config) : null,
        data.metadata ? JSON.stringify(data.metadata) : null,
        now,
        now,
      ]
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
   * Get or create a session atomically (race condition safe)
   * Uses PostgreSQL transaction with SELECT FOR UPDATE to prevent TOCTOU
   */
  async getOrCreateSessionAtomic(data: CreateSessionData): Promise<{ session: Session; created: boolean }> {
    await this.ensureSchema();
    
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Try to get existing session with lock
      const getResult = await client.query(
        `SELECT * FROM ${this.qualified('sessions')} 
         WHERE channel = $1 AND conversation_id = $2
         FOR UPDATE`,
        [data.channel, data.conversationId]
      );

      if (getResult.rows.length > 0) {
        const row = getResult.rows[0] as SessionRow;
        
        if (row.status === 'active') {
          await client.query('COMMIT');
          return { session: this.rowToSession(row), created: false };
        }

        // Reactivate existing session
        const now = new Date().toISOString();
        await client.query(
          `UPDATE ${this.qualified('sessions')} 
           SET status = $1, updated_at = $2 
           WHERE id = $3`,
          ['active', now, row.id]
        );

        const updated = await this.getSession(row.id);
        await client.query('COMMIT');
        return { session: updated!, created: false };
      }

      // Create new session
      const now = new Date().toISOString();
      const id = uuid();

      await client.query(
        `INSERT INTO ${this.qualified('sessions')} 
         (id, channel, conversation_id, user_id, status, system_prompt, config, metadata, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          id,
          data.channel,
          data.conversationId,
          data.userId,
          'active',
          data.systemPrompt ?? null,
          data.config ? JSON.stringify(data.config) : null,
          data.metadata ? JSON.stringify(data.metadata) : null,
          now,
          now,
        ]
      );

      await client.query('COMMIT');

      const session: Session = {
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

      return { session, created: true };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Get a session by ID
   */
  async getSession(id: string): Promise<Session | null> {
    await this.ensureSchema();
    const result = await this.pool.query(
      `SELECT * FROM ${this.qualified('sessions')} WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.rowToSession(result.rows[0] as SessionRow);
  }

  /**
   * Get a session by channel and conversation ID
   */
  async getSessionByConversation(channel: string, conversationId: string): Promise<Session | null> {
    await this.ensureSchema();
    const result = await this.pool.query(
      `SELECT * FROM ${this.qualified('sessions')} 
       WHERE channel = $1 AND conversation_id = $2`,
      [channel, conversationId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.rowToSession(result.rows[0] as SessionRow);
  }

  /**
   * Update a session
   */
  async updateSession(id: string, data: UpdateSessionData): Promise<Session | null> {
    await this.ensureSchema();
    const session = await this.getSession(id);
    if (!session) {
      return null;
    }

    const now = new Date().toISOString();
    const updates: string[] = ['updated_at = $1'];
    const values: unknown[] = [now];
    let paramIndex = 2;

    if (data.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(data.status);
    }
    if (data.systemPrompt !== undefined) {
      updates.push(`system_prompt = $${paramIndex++}`);
      values.push(data.systemPrompt);
    }
    if (data.config !== undefined) {
      updates.push(`config = $${paramIndex++}`);
      values.push(JSON.stringify(data.config));
    }
    if (data.metadata !== undefined) {
      updates.push(`metadata = $${paramIndex++}`);
      values.push(JSON.stringify(data.metadata));
    }

    values.push(id);

    await this.pool.query(
      `UPDATE ${this.qualified('sessions')} 
       SET ${updates.join(', ')} 
       WHERE id = $${paramIndex}`,
      values
    );

    return await this.getSession(id);
  }

  /**
   * Delete a session and its messages
   */
  async deleteSession(id: string): Promise<boolean> {
    await this.ensureSchema();
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      await client.query(
        `DELETE FROM ${this.qualified('messages')} WHERE session_id = $1`,
        [id]
      );
      
      const result = await client.query(
        `DELETE FROM ${this.qualified('sessions')} WHERE id = $1`,
        [id]
      );
      
      await client.query('COMMIT');
      return result.rowCount !== null && result.rowCount > 0;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
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
    await this.ensureSchema();
    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (options?.channel) {
      conditions.push(`channel = $${paramIndex++}`);
      values.push(options.channel);
    }
    if (options?.status) {
      conditions.push(`status = $${paramIndex++}`);
      values.push(options.status);
    }

    let sql = `SELECT * FROM ${this.qualified('sessions')}`;
    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }
    sql += ' ORDER BY updated_at DESC';

    if (options?.limit) {
      sql += ` LIMIT $${paramIndex++}`;
      values.push(options.limit);
    }
    if (options?.offset) {
      sql += ` OFFSET $${paramIndex++}`;
      values.push(options.offset);
    }

    const result = await this.pool.query(sql, values);
    return result.rows.map((row: SessionRow) => this.rowToSession(row));
  }

  /**
   * Add a message to a session
   */
  async addMessage(data: CreateMessageData): Promise<Message> {
    await this.ensureSchema();
    const now = new Date().toISOString();
    const id = uuid();

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO ${this.qualified('messages')} 
         (id, session_id, role, content, tool_calls, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          id,
          data.sessionId,
          data.role,
          data.content,
          data.toolCalls ? JSON.stringify(data.toolCalls) : null,
          now,
        ]
      );

      // Update session's updated_at
      await client.query(
        `UPDATE ${this.qualified('sessions')} 
         SET updated_at = $1 
         WHERE id = $2`,
        [now, data.sessionId]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

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
  async getMessages(sessionId: string, options?: { limit?: number; offset?: number }): Promise<Message[]> {
    await this.ensureSchema();
    let sql = `SELECT * FROM ${this.qualified('messages')} WHERE session_id = $1 ORDER BY created_at ASC`;
    const values: unknown[] = [sessionId];
    let paramIndex = 2;

    if (options?.limit) {
      sql += ` LIMIT $${paramIndex++}`;
      values.push(options.limit);
    }
    if (options?.offset) {
      sql += ` OFFSET $${paramIndex++}`;
      values.push(options.offset);
    }

    const result = await this.pool.query(sql, values);
    return result.rows.map((row: MessageRow) => this.rowToMessage(row));
  }

  /**
   * Get a session with its messages
   */
  async getSessionWithMessages(id: string): Promise<SessionWithMessages | null> {
    await this.ensureSchema();
    const session = await this.getSession(id);
    if (!session) {
      return null;
    }

    const messages = await this.getMessages(id);
    return { ...session, messages };
  }

  /**
   * Get the count of messages in a session
   */
  async getMessageCount(sessionId: string): Promise<number> {
    await this.ensureSchema();
    const result = await this.pool.query(
      `SELECT COUNT(*) as count FROM ${this.qualified('messages')} WHERE session_id = $1`,
      [sessionId]
    );
    return parseInt(result.rows[0].count, 10);
  }

  /**
   * Replace all messages for a session (used after compaction)
   *
   * This is an atomic operation that deletes existing messages and inserts new ones.
   * Used by context management to update message history after compaction.
   *
   * @param sessionId - Session ID to replace messages for
   * @param messages - New messages to insert
   * @returns Number of messages inserted
   */
  async replaceMessages(sessionId: string, messages: Message[]): Promise<number> {
    await this.ensureSchema();
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');

      // Delete existing messages
      await client.query(
        `DELETE FROM ${this.qualified('messages')} WHERE session_id = $1`,
        [sessionId]
      );

      // Insert new messages
      for (const msg of messages) {
        await client.query(
          `INSERT INTO ${this.qualified('messages')} 
           (id, session_id, role, content, tool_calls, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            msg.id,
            sessionId,
            msg.role,
            msg.content,
            msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
            msg.createdAt,
          ]
        );
      }

      // Update session's updated_at timestamp
      const now = new Date().toISOString();
      await client.query(
        `UPDATE ${this.qualified('sessions')} 
         SET updated_at = $1 
         WHERE id = $2`,
        [now, sessionId]
      );

      await client.query('COMMIT');
      return messages.length;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Close the database connection pool
   */
  async close(): Promise<void> {
    // Pool lifecycle is managed by the StateLayer that created this store.
  }
}
