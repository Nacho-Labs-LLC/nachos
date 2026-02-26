import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { MemoryFact } from '@nachos/types';
import { PostgresMemoryStore } from './postgres-memory-store.js';

describe('PostgresMemoryStore', () => {
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
    expect(insertQuery?.text).toMatch(
      /\(\$1,\s*\$2,\s*\$3,\s*\$4,\s*\$5,\s*\$6,\s*\$7,\s*\$8\)\s*,\s*\(\$9,\s*\$10,\s*\$11,\s*\$12,\s*\$13,\s*\$14,\s*\$15,\s*\$16\)/
    );

    expect(insertQuery?.values).toHaveLength(16);
    expect(insertQuery?.values?.[0]).toBe('fact-1');
    expect(insertQuery?.values?.[8]).toBe('fact-2');
    expect(insertQuery?.values?.[15]).toBe('2026-02-07T00:01:00.000Z');
  });
});
