import Database from 'better-sqlite3';
import type { AuditEvent } from '../types.js';
import type { AuditProvider, AuditQueryFilter } from '../provider.js';

const DEFAULT_BATCH_SIZE = 100;

export interface SQLiteAuditProviderConfig {
  path: string;
  flushIntervalMs?: number;
  batchSize?: number;
}

export class SQLiteAuditProvider implements AuditProvider {
  readonly name = 'sqlite';
  private db: Database.Database | null = null;
  private buffer: AuditEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(private readonly config: SQLiteAuditProviderConfig) {}

  async init(): Promise<void> {
    this.db = new Database(this.config.path);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        instance_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        event_type TEXT NOT NULL,
        action TEXT NOT NULL,
        resource TEXT,
        outcome TEXT NOT NULL,
        reason TEXT,
        security_mode TEXT NOT NULL,
        policy_matched TEXT,
        details TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_events(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_events(session_id);
    `);

    const interval = this.config.flushIntervalMs ?? 5000;
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, interval);
  }

  async log(event: AuditEvent): Promise<void> {
    this.buffer.push(event);
    const batchSize = this.config.batchSize ?? DEFAULT_BATCH_SIZE;
    if (this.buffer.length >= batchSize) {
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    if (!this.db || this.buffer.length === 0) {
      return;
    }

    const events = this.buffer.splice(0);
    const stmt = this.db.prepare(`
      INSERT INTO audit_events (
        id,
        timestamp,
        instance_id,
        user_id,
        session_id,
        channel,
        event_type,
        action,
        resource,
        outcome,
        reason,
        security_mode,
        policy_matched,
        details
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insert = this.db.transaction((entries: AuditEvent[]) => {
      for (const event of entries) {
        stmt.run(
          event.id,
          event.timestamp,
          event.instanceId,
          event.userId,
          event.sessionId,
          event.channel,
          event.eventType,
          event.action,
          event.resource ?? null,
          event.outcome,
          event.reason ?? null,
          event.securityMode,
          event.policyMatched ?? null,
          event.details ? JSON.stringify(event.details) : null
        );
      }
    });

    insert(events);
  }

  async query(filter: AuditQueryFilter): Promise<AuditEvent[]> {
    if (!this.db) {
      return [];
    }

    const conditions: string[] = [];
    const params: Array<string | number> = [];

    if (filter.startTime) {
      conditions.push('timestamp >= ?');
      params.push(filter.startTime);
    }
    if (filter.endTime) {
      conditions.push('timestamp <= ?');
      params.push(filter.endTime);
    }
    if (filter.userId) {
      conditions.push('user_id = ?');
      params.push(filter.userId);
    }
    if (filter.sessionId) {
      conditions.push('session_id = ?');
      params.push(filter.sessionId);
    }
    if (filter.eventType) {
      conditions.push('event_type = ?');
      params.push(filter.eventType);
    }
    if (filter.outcome) {
      conditions.push('outcome = ?');
      params.push(filter.outcome);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;
    const statement = this.db.prepare(`
      SELECT
        id,
        timestamp,
        instance_id,
        user_id,
        session_id,
        channel,
        event_type,
        action,
        resource,
        outcome,
        reason,
        security_mode,
        policy_matched,
        details
      FROM audit_events
      ${whereClause}
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `);

    const queryParams = [...params, limit, offset];
    const rows = statement.all(...queryParams) as Array<{
      id: string;
      timestamp: string;
      instance_id: string;
      user_id: string;
      session_id: string;
      channel: string;
      event_type: AuditEvent['eventType'];
      action: string;
      resource: string | null;
      outcome: AuditEvent['outcome'];
      reason: string | null;
      security_mode: AuditEvent['securityMode'];
      policy_matched: string | null;
      details: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      timestamp: row.timestamp,
      instanceId: row.instance_id,
      userId: row.user_id,
      sessionId: row.session_id,
      channel: row.channel,
      eventType: row.event_type,
      action: row.action,
      resource: row.resource ?? undefined,
      outcome: row.outcome,
      reason: row.reason ?? undefined,
      securityMode: row.security_mode,
      policyMatched: row.policy_matched ?? undefined,
      details: row.details ? (JSON.parse(row.details) as Record<string, unknown>) : undefined,
    }));
  }

  async close(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
    this.db?.close();
    this.db = null;
  }
}
