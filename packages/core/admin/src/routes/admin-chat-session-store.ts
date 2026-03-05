import Database from 'better-sqlite3';

export interface AdminChatSession {
  id: string;
  conversationId: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export class AdminChatSessionStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS admin_chat_sessions (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  get(sessionId: string): AdminChatSession | undefined {
    const row = this.db
      .prepare(
        `SELECT id, conversation_id, user_id, created_at, updated_at
         FROM admin_chat_sessions WHERE id = ?`
      )
      .get(sessionId) as
      | {
          id: string;
          conversation_id: string;
          user_id: string;
          created_at: string;
          updated_at: string;
        }
      | undefined;

    if (!row) return undefined;

    return {
      id: row.id,
      conversationId: row.conversation_id,
      userId: row.user_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  set(session: AdminChatSession): void {
    this.db
      .prepare(
        `INSERT INTO admin_chat_sessions (id, conversation_id, user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           conversation_id = excluded.conversation_id,
           user_id = excluded.user_id,
           updated_at = excluded.updated_at`
      )
      .run(
        session.id,
        session.conversationId,
        session.userId,
        session.createdAt,
        session.updatedAt
      );
  }

  delete(sessionId: string): void {
    this.db.prepare('DELETE FROM admin_chat_sessions WHERE id = ?').run(sessionId);
  }

  close(): void {
    this.db.close();
  }
}
