/**
 * Postgres MemoryStore implementation.
 */

import type { Pool } from 'pg';
import type {
  MemoryEntry,
  MemoryFact,
  MemoryQuery,
  MemoryQueryResult,
  MemoryStore,
} from '@nachos/types';

type MemoryEntryRow = {
  id: string;
  agent_id: string;
  kind: MemoryEntry['kind'];
  content: string;
  tags: string[] | null;
  confidence: number | null;
  provenance: MemoryEntry['provenance'] | null;
  created_at: string;
  updated_at: string | null;
  expires_at: string | null;
};

type MemoryFactRow = {
  id: string;
  agent_id: string;
  subject: string;
  predicate: string;
  object: string;
  confidence: number | null;
  source_entry_id: string | null;
  created_at: string;
};

export class PostgresMemoryStore implements MemoryStore {
  private initialized = false;
  private schema: string;

  constructor(
    private pool: Pool,
    schema?: string
  ) {
    this.schema = schema ?? 'public';
  }

  async appendEntry(entry: MemoryEntry): Promise<MemoryEntry> {
    await this.ensureSchema();
    await this.pool.query(
      `INSERT INTO ${this.qualified('memory_entries')} (
        id, agent_id, kind, content, tags, confidence, provenance, created_at, updated_at, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        entry.id,
        entry.agentId,
        entry.kind,
        entry.content,
        entry.tags ? JSON.stringify(entry.tags) : null,
        entry.confidence ?? null,
        entry.provenance ? JSON.stringify(entry.provenance) : null,
        entry.createdAt,
        entry.updatedAt ?? null,
        entry.expiresAt ?? null,
      ]
    );
    return entry;
  }

  async appendFacts(facts: MemoryFact[]): Promise<MemoryFact[]> {
    await this.ensureSchema();
    if (facts.length === 0) return facts;

    const values: Array<unknown> = [];
    const rows = facts
      .map((fact, index) => {
        const base = index * 8;
        values.push(
          fact.id,
          fact.agentId,
          fact.subject,
          fact.predicate,
          fact.object,
          fact.confidence ?? null,
          fact.sourceEntryId ?? null,
          fact.createdAt
        );
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`;
      })
      .join(', ');

    await this.pool.query(
      `INSERT INTO ${this.qualified('memory_facts')} (
        id, agent_id, subject, predicate, object, confidence, source_entry_id, created_at
      ) VALUES ${rows}`,
      values
    );

    return facts;
  }

  async query(query: MemoryQuery): Promise<MemoryQueryResult> {
    await this.ensureSchema();
    const where: string[] = ['agent_id = $1'];
    const values: Array<unknown> = [query.agentId];

    if (query.kinds && query.kinds.length > 0) {
      values.push(query.kinds);
      where.push(`kind = ANY($${values.length})`);
    }

    if (query.text) {
      values.push(`%${query.text}%`);
      where.push(`content ILIKE $${values.length}`);
    }

    if (query.tags && query.tags.length > 0) {
      values.push(JSON.stringify(query.tags));
      where.push(`tags @> $${values.length}::jsonb`);
    }

    const limit = query.limit ?? 100;
    const offset = query.offset ?? 0;

    values.push(limit, offset);
    const entriesResult = await this.pool.query(
      `SELECT id, agent_id, kind, content, tags, confidence, provenance, created_at, updated_at, expires_at
       FROM ${this.qualified('memory_entries')}
       WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );

    const entries: MemoryEntry[] = entriesResult.rows.map((row: MemoryEntryRow) => ({
      id: row.id,
      agentId: row.agent_id,
      kind: row.kind,
      content: row.content,
      tags: row.tags ?? undefined,
      confidence: row.confidence ?? undefined,
      provenance: row.provenance ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at ?? undefined,
      expiresAt: row.expires_at ?? undefined,
    }));

    const includeFacts = !query.kinds || query.kinds.includes('fact');
    let facts: MemoryFact[] | undefined = undefined;

    if (includeFacts) {
      const factsWhere = ['agent_id = $1'];
      const factsValues: Array<unknown> = [query.agentId];
      if (query.text) {
        factsValues.push(`%${query.text}%`);
        factsWhere.push(
          `(subject ILIKE $${factsValues.length} OR predicate ILIKE $${factsValues.length} OR object ILIKE $${factsValues.length})`
        );
      }

      const factsResult = await this.pool.query(
        `SELECT id, agent_id, subject, predicate, object, confidence, source_entry_id, created_at
         FROM ${this.qualified('memory_facts')}
         WHERE ${factsWhere.join(' AND ')}
         ORDER BY created_at DESC
         LIMIT 200`,
        factsValues
      );

      facts = factsResult.rows.map((row: MemoryFactRow) => ({
        id: row.id,
        agentId: row.agent_id,
        subject: row.subject,
        predicate: row.predicate,
        object: row.object,
        confidence: row.confidence ?? undefined,
        sourceEntryId: row.source_entry_id ?? undefined,
        createdAt: row.created_at,
      }));
    }

    return { entries, facts };
  }

  async deleteEntry(id: string): Promise<void> {
    await this.ensureSchema();
    await this.pool.query(`DELETE FROM ${this.qualified('memory_entries')} WHERE id = $1`, [id]);
  }

  private qualified(table: string): string {
    return `"${this.schema}".${table}`;
  }

  private async ensureSchema(): Promise<void> {
    if (this.initialized) return;

    await this.pool.query(`CREATE SCHEMA IF NOT EXISTS "${this.schema}"`);

    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS ${this.qualified('memory_entries')} (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        tags JSONB,
        confidence DOUBLE PRECISION,
        provenance JSONB,
        created_at TEXT NOT NULL,
        updated_at TEXT,
        expires_at TEXT
      )`
    );

    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS memory_entries_agent_kind_idx ON ${this.qualified('memory_entries')}(agent_id, kind)`
    );

    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS ${this.qualified('memory_facts')} (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        predicate TEXT NOT NULL,
        object TEXT NOT NULL,
        confidence DOUBLE PRECISION,
        source_entry_id TEXT,
        created_at TEXT NOT NULL
      )`
    );

    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS memory_facts_agent_idx ON ${this.qualified('memory_facts')}(agent_id)`
    );

    this.initialized = true;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
