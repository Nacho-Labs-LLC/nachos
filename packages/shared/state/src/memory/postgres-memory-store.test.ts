/**
 * Tests for PostgresMemoryStore
 *
 * Unit tests use a mock Pool. Integration tests require a running PostgreSQL
 * instance and are gated behind POSTGRES_TEST_URL.
 *
 * export POSTGRES_TEST_URL="postgres://nachos:nachos@localhost:5432/nachos_test"
 * npx vitest run postgres-memory-store.test.ts
 */

import { describe, expect, it, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import type { MemoryEntry, MemoryFact } from '@nachos/types';
import { PostgresMemoryStore } from './postgres-memory-store.js';

describe('PostgresMemoryStore (unit)', () => {
  it('builds correct parameter indexes for multi-row appendFacts', async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const pool = {
      query: vi.fn(async (text: string, values?: unknown[]) => {
        queries.push({ text, values });
        return { rows: [], rowCount: 0 };
      }),
    } as unknown as Pool;

    const store = new PostgresMemoryStore(pool, 'test_schema');
    const facts: MemoryFact[] = [
      {
        id: 'fact-1',
        agentId: 'agent-1',
        subject: 'subject-1',
        predicate: 'predicate-1',
        object: 'object-1',
        createdAt: '2026-02-07T00:00:00.000Z',
      },
      {
        id: 'fact-2',
        agentId: 'agent-1',
        subject: 'subject-2',
        predicate: 'predicate-2',
        object: 'object-2',
        confidence: 0.42,
        sourceEntryId: 'entry-2',
        createdAt: '2026-02-07T00:01:00.000Z',
      },
    ];

    await store.appendFacts(facts);

    const insertQuery = queries.at(-1);
    // 13 columns per fact row: id, agent_id, subject, predicate, object, type, confidence, properties, source_entry_id, source_context, created_at, updated_at, expires_at
    expect(insertQuery?.text).toMatch(
      /\(\$1,\s*\$2,\s*\$3,\s*\$4,\s*\$5,\s*\$6,\s*\$7,\s*\$8,\s*\$9,\s*\$10,\s*\$11,\s*\$12,\s*\$13\)\s*,\s*\(\$14,\s*\$15,\s*\$16,\s*\$17,\s*\$18,\s*\$19,\s*\$20,\s*\$21,\s*\$22,\s*\$23,\s*\$24,\s*\$25,\s*\$26\)/
    );

    expect(insertQuery?.values).toHaveLength(26);
    expect(insertQuery?.values?.[0]).toBe('fact-1');
    expect(insertQuery?.values?.[13]).toBe('fact-2');
    expect(insertQuery?.values?.[23]).toBe('2026-02-07T00:01:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// Integration tests — require a live Postgres instance
// ---------------------------------------------------------------------------

const POSTGRES_URL = process.env.POSTGRES_TEST_URL;
const TEST_SCHEMA = 'nachos_memory_test';

const describeIfPostgres = POSTGRES_URL ? describe : describe.skip;

describeIfPostgres('PostgresMemoryStore (integration)', () => {
  let pgModule: typeof import('pg');
  let pool: InstanceType<typeof import('pg').Pool>;
  let store: PostgresMemoryStore;

  beforeAll(async () => {
    pgModule = await import('pg');
    pool = new pgModule.Pool({
      connectionString: POSTGRES_URL,
      max: 5,
    });

    await pool.query(`CREATE SCHEMA IF NOT EXISTS "${TEST_SCHEMA}"`);
    store = new PostgresMemoryStore(pool, TEST_SCHEMA);
  });

  afterAll(async () => {
    if (pool) {
      await pool.query(`DROP SCHEMA IF EXISTS "${TEST_SCHEMA}" CASCADE`);
      await pool.end();
    }
  });

  beforeEach(async () => {
    if (pool) {
      await pool.query(`DROP TABLE IF EXISTS "${TEST_SCHEMA}".memory_entries CASCADE`);
      await pool.query(`DROP TABLE IF EXISTS "${TEST_SCHEMA}".memory_facts CASCADE`);
      // Force schema re-creation by creating a new store instance
      store = new PostgresMemoryStore(pool, TEST_SCHEMA);
    }
  });

  function makeEntry(overrides?: Partial<MemoryEntry>): MemoryEntry {
    return {
      id: `entry-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      agentId: 'agent-1',
      kind: 'summary',
      content: 'Test memory entry',
      tags: ['test'],
      createdAt: new Date().toISOString(),
      ...overrides,
    };
  }

  function makeFact(overrides?: Partial<MemoryFact>): MemoryFact {
    return {
      id: `fact-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      agentId: 'agent-1',
      subject: 'user',
      predicate: 'likes',
      object: 'TypeScript',
      createdAt: new Date().toISOString(),
      ...overrides,
    };
  }

  it('appendEntry stores and retrieves an entry with all fields', async () => {
    const entry = makeEntry({
      kind: 'preference',
      content: 'User prefers dark mode',
      tags: ['ui', 'preference'],
      confidence: 0.95,
      provenance: {
        source: 'conversation',
        sessionId: 'sess-1',
        messageIds: ['msg-1', 'msg-2'],
      },
      updatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });

    const stored = await store.appendEntry(entry);
    expect(stored.id).toBe(entry.id);

    const result = await store.query({ agentId: 'agent-1' });
    expect(result.entries).toHaveLength(1);

    const found = result.entries[0]!;
    expect(found.id).toBe(entry.id);
    expect(found.kind).toBe('preference');
    expect(found.content).toBe('User prefers dark mode');
    expect(found.confidence).toBe(0.95);
    expect(found.createdAt).toBe(entry.createdAt);
  });

  it('appendFacts stores multiple facts', async () => {
    const facts: MemoryFact[] = [
      makeFact({ subject: 'user', predicate: 'likes', object: 'TypeScript' }),
      makeFact({ subject: 'user', predicate: 'dislikes', object: 'YAML' }),
      makeFact({
        subject: 'project',
        predicate: 'uses',
        object: 'pnpm',
        confidence: 0.85,
        sourceEntryId: 'entry-ref-1',
      }),
    ];

    const stored = await store.appendFacts(facts);
    expect(stored).toHaveLength(3);

    const result = await store.query({ agentId: 'agent-1' });
    expect(result.facts).toBeDefined();
    expect(result.facts!.length).toBe(3);
  });

  it('query with kind filter returns only matching kinds', async () => {
    await store.appendEntry(makeEntry({ kind: 'summary', content: 'A summary' }));
    await store.appendEntry(makeEntry({ kind: 'preference', content: 'A preference' }));
    await store.appendEntry(makeEntry({ kind: 'decision', content: 'A decision' }));

    const result = await store.query({ agentId: 'agent-1', kinds: ['summary'] });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.kind).toBe('summary');

    // When kinds filter does not include 'fact', facts should be excluded
    expect(result.facts).toBeUndefined();
  });

  it('query with tag filter returns matching entries', async () => {
    await store.appendEntry(makeEntry({ tags: ['important', 'urgent'], content: 'Tagged entry' }));
    await store.appendEntry(makeEntry({ tags: ['low-priority'], content: 'Not tagged' }));

    const result = await store.query({
      agentId: 'agent-1',
      tags: ['important'],
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.content).toBe('Tagged entry');
  });

  it('query with text search returns matching entries and facts', async () => {
    await store.appendEntry(makeEntry({ content: 'The user loves Rust programming' }));
    await store.appendEntry(makeEntry({ content: 'The weather is sunny' }));
    await store.appendFacts([
      makeFact({ subject: 'user', predicate: 'loves', object: 'Rust' }),
      makeFact({ subject: 'user', predicate: 'drinks', object: 'coffee' }),
    ]);

    const result = await store.query({ agentId: 'agent-1', text: 'Rust' });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.content).toContain('Rust');

    expect(result.facts).toBeDefined();
    expect(result.facts!).toHaveLength(1);
    expect(result.facts![0]!.object).toBe('Rust');
  });

  it('deleteEntry removes the specified entry', async () => {
    const entry1 = makeEntry({ content: 'Keep this' });
    const entry2 = makeEntry({ content: 'Delete this' });

    await store.appendEntry(entry1);
    await store.appendEntry(entry2);

    await store.deleteEntry(entry2.id, 'agent-1');

    const result = await store.query({ agentId: 'agent-1' });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.content).toBe('Keep this');
  });

  it('query returns empty results for non-matching agent', async () => {
    await store.appendEntry(makeEntry({ agentId: 'agent-1', content: 'Belongs to agent-1' }));

    const result = await store.query({ agentId: 'non-existent-agent' });
    expect(result.entries).toHaveLength(0);
    expect(result.facts).toBeDefined();
    expect(result.facts!).toHaveLength(0);
  });

  it('appendFacts returns empty array for empty input', async () => {
    const result = await store.appendFacts([]);
    expect(result).toEqual([]);
  });

  it('query with limit and offset paginates correctly', async () => {
    for (let i = 0; i < 5; i++) {
      await store.appendEntry(makeEntry({ content: `Entry ${i}` }));
    }

    const result = await store.query({ agentId: 'agent-1', limit: 2, offset: 1 });
    expect(result.entries).toHaveLength(2);
  });

  it('deleteEntry is idempotent for non-existent entries', async () => {
    await store.appendEntry(makeEntry());

    // Should not throw when deleting a non-existent entry
    await expect(store.deleteEntry('non-existent-id', 'agent-1')).resolves.not.toThrow();
  });
});
