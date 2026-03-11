/**
 * SQLite MemoryStore implementation.
 *
 * Default backend for memory storage. Uses better-sqlite3 for synchronous,
 * single-process memory persistence. Suitable for local/dev deployments.
 */

import type Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import type {
  MemoryEntry,
  MemoryFact,
  MemoryQuery,
  MemoryQueryResult,
  MemoryStore,
  MemoryKind,
  MemoryFactType,
} from '@nachos/types';

interface MemoryEntryRow {
  id: string;
  agent_id: string;
  kind: string;
  content: string;
  tags: string | null;
  confidence: number | null;
  provenance: string | null;
  created_at: string;
  updated_at: string | null;
  expires_at: string | null;
}

interface MemoryFactRow {
  id: string;
  agent_id: string;
  subject: string;
  predicate: string;
  object: string;
  type: string | null;
  confidence: number | null;
  properties: string | null;
  source_entry_id: string | null;
  source_context: string | null;
  created_at: string;
  updated_at: string | null;
  expires_at: string | null;
}

export class SqliteMemoryStore implements MemoryStore {
  private db: Database.Database;
  private initialized = false;

  constructor(db: Database.Database) {
    this.db = db;
    this.ensureSchema();
  }

  private ensureSchema(): void {
    if (this.initialized) return;

    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_entries (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        tags TEXT,
        confidence REAL,
        provenance TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT,
        expires_at TEXT
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS memory_entries_agent_kind_idx
        ON memory_entries(agent_id, kind)
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS memory_entries_agent_idx
        ON memory_entries(agent_id)
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_facts (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        predicate TEXT NOT NULL,
        object TEXT NOT NULL,
        type TEXT DEFAULT 'general',
        confidence REAL,
        properties TEXT,
        source_entry_id TEXT,
        source_context TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT,
        expires_at TEXT
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS memory_facts_agent_idx
        ON memory_facts(agent_id)
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS memory_facts_agent_type_idx
        ON memory_facts(agent_id, type)
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS memory_facts_subject_idx
        ON memory_facts(agent_id, subject)
    `);

    this.initialized = true;
  }

  private rowToEntry(row: MemoryEntryRow): MemoryEntry {
    return {
      id: row.id,
      agentId: row.agent_id,
      kind: row.kind as MemoryKind,
      content: row.content,
      tags: row.tags ? JSON.parse(row.tags) : undefined,
      confidence: row.confidence ?? undefined,
      provenance: row.provenance ? JSON.parse(row.provenance) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at ?? undefined,
      expiresAt: row.expires_at ?? undefined,
    };
  }

  private rowToFact(row: MemoryFactRow): MemoryFact {
    return {
      id: row.id,
      agentId: row.agent_id,
      subject: row.subject,
      predicate: row.predicate,
      object: row.object,
      type: (row.type as MemoryFactType) ?? undefined,
      confidence: row.confidence ?? undefined,
      properties: row.properties ? JSON.parse(row.properties) : undefined,
      sourceEntryId: row.source_entry_id ?? undefined,
      sourceContext: row.source_context ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at ?? undefined,
      expiresAt: row.expires_at ?? undefined,
    };
  }

  async appendEntry(entry: MemoryEntry): Promise<MemoryEntry> {
    const id = entry.id || uuid();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO memory_entries
          (id, agent_id, kind, content, tags, confidence, provenance, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        entry.agentId,
        entry.kind,
        entry.content,
        entry.tags ? JSON.stringify(entry.tags) : null,
        entry.confidence ?? null,
        entry.provenance ? JSON.stringify(entry.provenance) : null,
        entry.createdAt || now,
        entry.updatedAt ?? null,
        entry.expiresAt ?? null
      );

    return { ...entry, id };
  }

  async appendFacts(facts: MemoryFact[]): Promise<MemoryFact[]> {
    if (facts.length === 0) return facts;

    const insert = this.db.prepare(
      `INSERT INTO memory_facts
        (id, agent_id, subject, predicate, object, type, confidence, properties, source_entry_id, source_context, created_at, updated_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const now = new Date().toISOString();
    const result: MemoryFact[] = [];
    const txn = this.db.transaction(() => {
      for (const fact of facts) {
        const id = fact.id || uuid();
        const createdAt = fact.createdAt || now;
        insert.run(
          id,
          fact.agentId,
          fact.subject,
          fact.predicate,
          fact.object,
          fact.type ?? 'general',
          fact.confidence ?? null,
          fact.properties ? JSON.stringify(fact.properties) : null,
          fact.sourceEntryId ?? null,
          fact.sourceContext ?? null,
          createdAt,
          fact.updatedAt ?? null,
          fact.expiresAt ?? null
        );
        result.push({ ...fact, id, createdAt });
      }
    });

    txn();
    return result;
  }

  async query(query: MemoryQuery): Promise<MemoryQueryResult> {
    // Query entries
    const conditions: string[] = ['agent_id = ?'];
    const values: unknown[] = [query.agentId];

    if (query.kinds && query.kinds.length > 0) {
      const placeholders = query.kinds.map(() => '?').join(', ');
      conditions.push(`kind IN (${placeholders})`);
      values.push(...query.kinds);
    }

    if (query.tags && query.tags.length > 0) {
      // SQLite JSON: check if any tag matches
      const tagConditions = query.tags.map(() => `tags LIKE ?`);
      conditions.push(`(${tagConditions.join(' OR ')})`);
      for (const tag of query.tags) {
        values.push(`%"${tag}"%`);
      }
    }

    if (query.text) {
      conditions.push('content LIKE ?');
      values.push(`%${query.text}%`);
    }

    const limit = query.limit ?? 100;
    const offset = query.offset ?? 0;

    const entrySql = `
      SELECT * FROM memory_entries
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;
    values.push(limit, offset);

    const entryRows = this.db.prepare(entrySql).all(...values) as MemoryEntryRow[];
    const entries = entryRows.map((row) => this.rowToEntry(row));

    // Query facts
    const includeFacts = !query.kinds || query.kinds.includes('fact');
    let facts: MemoryFact[] | undefined;

    if (includeFacts) {
      const factConditions: string[] = ['agent_id = ?'];
      const factValues: unknown[] = [query.agentId];

      if (query.text) {
        factConditions.push(
          `(subject LIKE ? OR predicate LIKE ? OR object LIKE ?)`
        );
        const pattern = `%${query.text}%`;
        factValues.push(pattern, pattern, pattern);
      }

      const factsLimit = query.limit ?? 200;
      const factSql = `
        SELECT * FROM memory_facts
        WHERE ${factConditions.join(' AND ')}
        ORDER BY created_at DESC
        LIMIT ?
      `;
      factValues.push(factsLimit);

      const factRows = this.db.prepare(factSql).all(...factValues) as MemoryFactRow[];
      facts = factRows.map((row) => this.rowToFact(row));
    }

    return { entries, facts };
  }

  async deleteEntry(id: string, agentId: string): Promise<void> {
    this.db
      .prepare('DELETE FROM memory_entries WHERE id = ? AND agent_id = ?')
      .run(id, agentId);
  }

  async close(): Promise<void> {
    try {
      this.db.close();
    } catch {
      // Ignore close errors to avoid impacting callers
    }
  }
}
