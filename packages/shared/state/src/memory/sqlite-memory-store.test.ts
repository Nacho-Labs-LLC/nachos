/**
 * Tests for SqliteMemoryStore
 *
 * Uses an in-memory SQLite database for fast, isolated tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteMemoryStore } from './sqlite-memory-store.js';
import type { MemoryEntry, MemoryFact } from '@nachos/types';

describe('SqliteMemoryStore', () => {
  let db: Database.Database;
  let store: SqliteMemoryStore;

  beforeEach(() => {
    db = new Database(':memory:');
    store = new SqliteMemoryStore(db);
  });

  afterEach(async () => {
    await store.close();
    try {
      db.close();
    } catch {
      // already closed
    }
  });

  const makeEntry = (overrides?: Partial<MemoryEntry>): MemoryEntry => ({
    id: `entry-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    agentId: 'agent-1',
    kind: 'fact',
    content: 'TypeScript is a superset of JavaScript',
    tags: ['typescript', 'languages'],
    confidence: 0.9,
    createdAt: new Date().toISOString(),
    ...overrides,
  });

  const makeFact = (overrides?: Partial<MemoryFact>): MemoryFact => ({
    id: `fact-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    agentId: 'agent-1',
    subject: 'TypeScript',
    predicate: 'is_superset_of',
    object: 'JavaScript',
    type: 'relationship',
    confidence: 0.95,
    properties: { category: 'programming' },
    sourceContext: 'user mentioned this in conversation',
    createdAt: new Date().toISOString(),
    ...overrides,
  });

  describe('appendEntry', () => {
    it('stores and retrieves a memory entry', async () => {
      const entry = makeEntry();
      const stored = await store.appendEntry(entry);

      expect(stored.id).toBe(entry.id);
      expect(stored.agentId).toBe('agent-1');
      expect(stored.kind).toBe('fact');
    });

    it('stores entries with all optional fields', async () => {
      const entry = makeEntry({
        provenance: { source: 'conversation', sessionId: 'sess-1', messageIds: ['msg-1'] },
        expiresAt: '2027-01-01T00:00:00.000Z',
        updatedAt: new Date().toISOString(),
      });

      await store.appendEntry(entry);
      const result = await store.query({ agentId: 'agent-1' });

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]!.provenance?.source).toBe('conversation');
      expect(result.entries[0]!.expiresAt).toBe('2027-01-01T00:00:00.000Z');
    });

    it('stores entries with minimal fields', async () => {
      const entry = makeEntry({
        tags: undefined,
        confidence: undefined,
        provenance: undefined,
      });

      const stored = await store.appendEntry(entry);
      const result = await store.query({ agentId: 'agent-1' });

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]!.tags).toBeUndefined();
      expect(result.entries[0]!.confidence).toBeUndefined();
    });
  });

  describe('appendFacts', () => {
    it('stores enriched facts with all new fields', async () => {
      const fact = makeFact();
      await store.appendFacts([fact]);

      const result = await store.query({ agentId: 'agent-1' });
      expect(result.facts).toHaveLength(1);
      expect(result.facts![0]!.type).toBe('relationship');
      expect(result.facts![0]!.properties).toEqual({ category: 'programming' });
      expect(result.facts![0]!.sourceContext).toBe('user mentioned this in conversation');
    });

    it('stores multiple facts in a transaction', async () => {
      const facts = [
        makeFact({ subject: 'Node.js', predicate: 'uses', object: 'V8' }),
        makeFact({ subject: 'Deno', predicate: 'uses', object: 'V8' }),
        makeFact({ subject: 'Bun', predicate: 'uses', object: 'JavaScriptCore' }),
      ];

      const stored = await store.appendFacts(facts);
      expect(stored).toHaveLength(3);

      const result = await store.query({ agentId: 'agent-1' });
      expect(result.facts).toHaveLength(3);
    });

    it('handles empty facts array', async () => {
      const stored = await store.appendFacts([]);
      expect(stored).toHaveLength(0);
    });

    it('stores facts with expiration', async () => {
      const fact = makeFact({
        expiresAt: '2027-06-01T00:00:00.000Z',
        updatedAt: new Date().toISOString(),
      });

      await store.appendFacts([fact]);
      const result = await store.query({ agentId: 'agent-1' });

      expect(result.facts![0]!.expiresAt).toBe('2027-06-01T00:00:00.000Z');
      expect(result.facts![0]!.updatedAt).toBeDefined();
    });

    it('defaults type to general when not specified', async () => {
      const fact = makeFact({ type: undefined });
      await store.appendFacts([fact]);

      const result = await store.query({ agentId: 'agent-1' });
      expect(result.facts![0]!.type).toBe('general');
    });
  });

  describe('query', () => {
    it('filters entries by agentId', async () => {
      await store.appendEntry(makeEntry({ agentId: 'agent-1' }));
      await store.appendEntry(makeEntry({ agentId: 'agent-2' }));

      const result = await store.query({ agentId: 'agent-1' });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]!.agentId).toBe('agent-1');
    });

    it('filters entries by kind', async () => {
      await store.appendEntry(makeEntry({ kind: 'fact' }));
      await store.appendEntry(makeEntry({ kind: 'preference' }));
      await store.appendEntry(makeEntry({ kind: 'decision' }));

      const result = await store.query({
        agentId: 'agent-1',
        kinds: ['fact', 'decision'],
      });
      expect(result.entries).toHaveLength(2);
    });

    it('filters entries by tags', async () => {
      await store.appendEntry(makeEntry({ tags: ['typescript', 'backend'] }));
      await store.appendEntry(makeEntry({ tags: ['python', 'ml'] }));

      const result = await store.query({
        agentId: 'agent-1',
        tags: ['typescript'],
      });
      expect(result.entries).toHaveLength(1);
    });

    it('filters entries by text search', async () => {
      await store.appendEntry(makeEntry({ content: 'TypeScript is great' }));
      await store.appendEntry(makeEntry({ content: 'Python is also great' }));

      const result = await store.query({
        agentId: 'agent-1',
        text: 'TypeScript',
      });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]!.content).toContain('TypeScript');
    });

    it('filters facts by text search', async () => {
      await store.appendFacts([
        makeFact({ subject: 'TypeScript', predicate: 'extends', object: 'JavaScript' }),
        makeFact({ subject: 'Python', predicate: 'has', object: 'GIL' }),
      ]);

      const result = await store.query({
        agentId: 'agent-1',
        text: 'TypeScript',
      });
      expect(result.facts).toHaveLength(1);
      expect(result.facts![0]!.subject).toBe('TypeScript');
    });

    it('respects limit and offset', async () => {
      for (let i = 0; i < 10; i++) {
        await store.appendEntry(makeEntry({ content: `Entry ${i}` }));
      }

      const result = await store.query({
        agentId: 'agent-1',
        limit: 3,
        offset: 2,
      });
      expect(result.entries).toHaveLength(3);
    });

    it('excludes facts when kinds filter does not include fact', async () => {
      await store.appendEntry(makeEntry({ kind: 'preference' }));
      await store.appendFacts([makeFact()]);

      const result = await store.query({
        agentId: 'agent-1',
        kinds: ['preference'],
      });
      expect(result.entries).toHaveLength(1);
      expect(result.facts).toBeUndefined();
    });
  });

  describe('deleteEntry', () => {
    it('deletes a specific entry', async () => {
      const entry = makeEntry();
      await store.appendEntry(entry);

      await store.deleteEntry(entry.id, 'agent-1');

      const result = await store.query({ agentId: 'agent-1' });
      expect(result.entries).toHaveLength(0);
    });

    it('does not delete entries from other agents', async () => {
      const entry = makeEntry({ agentId: 'agent-1' });
      await store.appendEntry(entry);

      await store.deleteEntry(entry.id, 'agent-2');

      const result = await store.query({ agentId: 'agent-1' });
      expect(result.entries).toHaveLength(1);
    });
  });
});
