/**
 * SQLite sessions and messages storage implementation.
 *
 * Uses better-sqlite3 for synchronous, single-process session storage.
 * Suitable for local/dev deployments where PostgreSQL is not needed.
 */

import type Database from 'better-sqlite3';
import type {
  Session,
  SessionStatus,
  Message,
  MessageRole,
  SessionWithMessages,
} from '@nachos/types';
import { createLogger } from '@nachos/types';
import { v4 as uuid } from 'uuid';
import type {
  CreateSessionData,
  UpdateSessionData,
  CreateMessageData,
  SessionsStore,
  ConversationSearchResult,
} from './sessions-store-interface.js';

const logger = createLogger('sqlite-sessions-store');

// Lazy import to avoid crashing on platforms without glibc (e.g., Alpine)
type EnhancedSemanticSearchType = import('@nacho-labs/nachos-embeddings').EnhancedSemanticSearch;

export interface SqliteSessionsStoreSemanticConfig {
  model?: string;
  cacheDir?: string;
  storePath: string;
}

/**
 * Row type for session database queries
 */
interface SessionRow {
  id: string;
  channel: string;
  conversation_id: string;
  user_id: string;
  status: string;
  system_prompt: string | null;
  config: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
  is_pinned: number; // SQLite stores booleans as 0/1
  is_archived: number;
  last_activity: string;
}

/**
 * Row type for message database queries
 */
interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  tool_calls: string | null;
  created_at: string;
}

/**
 * SQLite-based state storage for sessions and messages
 */
export class SqliteSessionsStore implements SessionsStore {
  private db: Database.Database;
  private initialized = false;
  private semanticSearch: EnhancedSemanticSearchType | null = null;
  private semanticConfig: SqliteSessionsStoreSemanticConfig | null = null;

  constructor(db: Database.Database, semanticConfig?: SqliteSessionsStoreSemanticConfig) {
    this.db = db;
    this.semanticConfig = semanticConfig ?? null;
    this.ensureSchema();
  }

  /**
   * Initialize semantic search for conversation history.
   * Called automatically if semanticConfig was provided to the constructor.
   * Safe to call multiple times (idempotent).
   */
  async init(): Promise<void> {
    if (!this.semanticConfig || this.semanticSearch) return;
    try {
      const { EnhancedSemanticSearch } = await import('@nacho-labs/nachos-embeddings');
      this.semanticSearch = new EnhancedSemanticSearch({
        model: this.semanticConfig.model,
        cacheDir: this.semanticConfig.cacheDir,
        autoSave: true,
        storePath: this.semanticConfig.storePath,
        temporalBoost: true,
        deduplicateExact: true,
      });
      await this.semanticSearch.init(); // loads persisted index from disk
      logger.info(
        { storePath: this.semanticConfig.storePath, size: this.semanticSearch.size() },
        'Conversation semantic search initialized'
      );
    } catch (err) {
      logger.warn({ err }, 'Conversation semantic search unavailable — continuing without it');
      this.semanticSearch = null;
    }
  }

  /**
   * Create schema and tables if they don't exist
   */
  private ensureSchema(): void {
    if (this.initialized) return;

    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');

    this.db.exec(`
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
        is_pinned INTEGER DEFAULT 0,
        is_archived INTEGER DEFAULT 0,
        last_activity TEXT NOT NULL,
        UNIQUE(channel, conversation_id)
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS sessions_channel_conversation_idx
        ON sessions(channel, conversation_id)
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS sessions_active_idx
        ON sessions(channel, is_archived, last_activity)
        WHERE is_archived = 0
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS sessions_archived_idx
        ON sessions(channel, is_archived, updated_at)
        WHERE is_archived = 1
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_calls TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS messages_session_id_idx
        ON messages(session_id)
    `);

    this.initialized = true;
  }

  private rowToSession(row: SessionRow): Session {
    return {
      id: row.id,
      channel: row.channel,
      conversationId: row.conversation_id,
      userId: row.user_id,
      status: row.status as SessionStatus,
      systemPrompt: row.system_prompt ?? undefined,
      config: row.config ? JSON.parse(row.config) : {},
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      isPinned: row.is_pinned === 1,
      isArchived: row.is_archived === 1,
      lastActivity: row.last_activity,
    };
  }

  private rowToMessage(row: MessageRow): Message {
    return {
      id: row.id,
      sessionId: row.session_id,
      role: row.role as MessageRole,
      content: row.content,
      toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
      createdAt: row.created_at,
    };
  }

  async createSession(data: CreateSessionData): Promise<Session> {
    const now = new Date().toISOString();
    const id = uuid();

    this.db
      .prepare(
        `
      INSERT INTO sessions
        (id, channel, conversation_id, user_id, status, system_prompt, config, metadata, created_at, updated_at, is_pinned, is_archived, last_activity)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
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
        0, // is_pinned
        0, // is_archived
        now // last_activity
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
      isPinned: false,
      isArchived: false,
      lastActivity: now,
    };
  }

  async getOrCreateSessionAtomic(
    data: CreateSessionData
  ): Promise<{ session: Session; created: boolean }> {
    // SQLite is single-writer, so we use a transaction for atomicity
    const txn = this.db.transaction(() => {
      const existing = this.db
        .prepare('SELECT * FROM sessions WHERE channel = ? AND conversation_id = ?')
        .get(data.channel, data.conversationId) as SessionRow | undefined;

      if (existing) {
        return { session: this.rowToSession(existing), created: false };
      }

      const now = new Date().toISOString();
      const id = uuid();

      this.db
        .prepare(
          `
        INSERT INTO sessions
          (id, channel, conversation_id, user_id, status, system_prompt, config, metadata, created_at, updated_at, is_pinned, is_archived, last_activity)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
        )
        .run(
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
          0,
          0,
          now
        );

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
        isPinned: false,
        isArchived: false,
        lastActivity: now,
      };

      return { session, created: true };
    });

    return txn();
  }

  async getSession(id: string): Promise<Session | null> {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as
      | SessionRow
      | undefined;
    return row ? this.rowToSession(row) : null;
  }

  async getSessionByConversation(channel: string, conversationId: string): Promise<Session | null> {
    const row = this.db
      .prepare('SELECT * FROM sessions WHERE channel = ? AND conversation_id = ?')
      .get(channel, conversationId) as SessionRow | undefined;
    return row ? this.rowToSession(row) : null;
  }

  async updateSession(id: string, data: UpdateSessionData): Promise<Session | null> {
    const session = await this.getSession(id);
    if (!session) return null;

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

    this.db.prepare(`UPDATE sessions SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    return await this.getSession(id);
  }

  async deleteSession(id: string): Promise<boolean> {
    const txn = this.db.transaction(() => {
      this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(id);
      const result = this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
      return result.changes > 0;
    });
    return txn();
  }

  async listSessions(options?: {
    channel?: string;
    status?: SessionStatus;
    limit?: number;
    offset?: number;
  }): Promise<Session[]> {
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

    const rows = this.db.prepare(sql).all(...values) as SessionRow[];
    return rows.map((row) => this.rowToSession(row));
  }

  async addMessage(data: CreateMessageData): Promise<Message> {
    const now = new Date().toISOString();
    const id = uuid();

    const txn = this.db.transaction(() => {
      this.db
        .prepare(
          `
        INSERT INTO messages (id, session_id, role, content, tool_calls, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `
        )
        .run(
          id,
          data.sessionId,
          data.role,
          data.content,
          data.toolCalls ? JSON.stringify(data.toolCalls) : null,
          now
        );

      this.db
        .prepare('UPDATE sessions SET updated_at = ?, last_activity = ? WHERE id = ?')
        .run(now, now, data.sessionId);
    });

    txn();

    const saved: Message = {
      id,
      sessionId: data.sessionId,
      role: data.role,
      content: data.content,
      toolCalls: data.toolCalls,
      createdAt: now,
    };

    // Fire-and-forget embedding — never blocks or fails the message save
    if (this.semanticSearch && (data.role === 'user' || data.role === 'assistant')) {
      void this.embedMessage(saved).catch((err) =>
        logger.warn({ err, messageId: id }, 'Failed to embed conversation turn')
      );
    }

    return saved;
  }

  private async embedMessage(msg: Message): Promise<void> {
    if (!this.semanticSearch) return;
    const text = `${msg.role}: ${msg.content}`;
    await this.semanticSearch.addDocument({
      id: msg.id,
      text,
      metadata: {
        messageId: msg.id,
        sessionId: msg.sessionId,
        role: msg.role,
        timestamp: msg.createdAt ? new Date(msg.createdAt).getTime() : Date.now(),
      },
    });
  }

  async searchMessages(
    query: string,
    options?: {
      limit?: number;
      minSimilarity?: number;
      sessionId?: string;
      since?: string;
    }
  ): Promise<ConversationSearchResult[]> {
    if (!this.semanticSearch) return [];

    const sinceMs = options?.since ? new Date(options.since).getTime() : undefined;

    const results = await this.semanticSearch.search(query, {
      limit: options?.limit ?? 5,
      minSimilarity: options?.minSimilarity,
      filter:
        options?.sessionId || sinceMs !== undefined
          ? (meta: Record<string, unknown> | undefined) => {
              if (options?.sessionId && meta?.['sessionId'] !== options.sessionId) return false;
              if (sinceMs !== undefined && typeof meta?.['timestamp'] === 'number' && (meta['timestamp'] as number) < sinceMs) return false;
              return true;
            }
          : undefined,
    });

    type SearchHit = { id: string; similarity: number; text: string; metadata?: Record<string, unknown> };
    return (results as SearchHit[]).map((r) => ({
      messageId: (r.metadata?.messageId as string | undefined) ?? r.id,
      sessionId: (r.metadata?.sessionId as string | undefined) ?? '',
      similarity: r.similarity,
      role: (r.metadata?.role as string | undefined) ?? 'unknown',
      content: r.text,
      timestamp:
        typeof r.metadata?.timestamp === 'number'
          ? new Date(r.metadata.timestamp).toISOString()
          : new Date().toISOString(),
    }));
  }

  async getMessages(
    sessionId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<Message[]> {
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

    const rows = this.db.prepare(sql).all(...values) as MessageRow[];
    return rows.map((row) => this.rowToMessage(row));
  }

  async getSessionWithMessages(id: string): Promise<SessionWithMessages | null> {
    const session = await this.getSession(id);
    if (!session) return null;

    const messages = await this.getMessages(id);
    return { ...session, messages };
  }

  async getMessageCount(sessionId: string): Promise<number> {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM messages WHERE session_id = ?')
      .get(sessionId) as { count: number };
    return row.count;
  }

  async replaceMessages(sessionId: string, messages: Message[]): Promise<number> {
    const txn = this.db.transaction(() => {
      this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);

      const insert = this.db.prepare(`
        INSERT INTO messages (id, session_id, role, content, tool_calls, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      for (const msg of messages) {
        insert.run(
          msg.id,
          sessionId,
          msg.role,
          msg.content,
          msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
          msg.createdAt
        );
      }

      const now = new Date().toISOString();
      this.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId);

      return messages.length;
    });

    return txn();
  }

  async listActive(options?: {
    channel?: string;
    userId?: string;
    limit?: number;
    offset?: number;
  }): Promise<Session[]> {
    const conditions: string[] = ['is_archived = 0'];
    const values: unknown[] = [];

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    conditions.push('(last_activity >= ? OR is_pinned = 1)');
    values.push(twentyFourHoursAgo);

    if (options?.channel) {
      conditions.push('channel = ?');
      values.push(options.channel);
    }
    if (options?.userId) {
      conditions.push('user_id = ?');
      values.push(options.userId);
    }

    let sql = `SELECT * FROM sessions WHERE ${conditions.join(' AND ')}`;
    sql += ' ORDER BY is_pinned DESC, last_activity DESC';

    if (options?.limit) {
      sql += ' LIMIT ?';
      values.push(options.limit);
    }
    if (options?.offset) {
      sql += ' OFFSET ?';
      values.push(options.offset);
    }

    const rows = this.db.prepare(sql).all(...values) as SessionRow[];
    return rows.map((row) => this.rowToSession(row));
  }

  async listArchived(options?: {
    channel?: string;
    userId?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<Session[]> {
    const conditions: string[] = ['is_archived = 1'];
    const values: unknown[] = [];

    if (options?.channel) {
      conditions.push('channel = ?');
      values.push(options.channel);
    }
    if (options?.userId) {
      conditions.push('user_id = ?');
      values.push(options.userId);
    }
    if (options?.search) {
      conditions.push('(conversation_id LIKE ? OR system_prompt LIKE ?)');
      values.push(`%${options.search}%`, `%${options.search}%`);
    }

    let sql = `SELECT * FROM sessions WHERE ${conditions.join(' AND ')}`;
    sql += ' ORDER BY updated_at DESC';

    if (options?.limit) {
      sql += ' LIMIT ?';
      values.push(options.limit);
    }
    if (options?.offset) {
      sql += ' OFFSET ?';
      values.push(options.offset);
    }

    const rows = this.db.prepare(sql).all(...values) as SessionRow[];
    return rows.map((row) => this.rowToSession(row));
  }

  async archive(sessionId: string): Promise<boolean> {
    const now = new Date().toISOString();
    const result = this.db
      .prepare('UPDATE sessions SET is_archived = 1, updated_at = ? WHERE id = ?')
      .run(now, sessionId);
    return result.changes > 0;
  }

  async restore(sessionId: string): Promise<boolean> {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        'UPDATE sessions SET is_archived = 0, last_activity = ?, updated_at = ? WHERE id = ?'
      )
      .run(now, now, sessionId);
    return result.changes > 0;
  }

  async pin(sessionId: string, pinned: boolean): Promise<boolean> {
    const now = new Date().toISOString();
    const result = this.db
      .prepare('UPDATE sessions SET is_pinned = ?, updated_at = ? WHERE id = ?')
      .run(pinned ? 1 : 0, now, sessionId);
    return result.changes > 0;
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
