/**
 * Tests for FilesystemMemoryStore
 *
 * Uses a temp directory for isolation, cleaned up after each test.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Mock @nachos/types
vi.mock('@nachos/types', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { FilesystemMemoryStore } from './filesystem-memory-store.js';
import type { MemoryEntry, MemoryFact, MemoryQuery } from '@nachos/types';

describe('FilesystemMemoryStore', () => {
  let tempDir: string;
  let store: FilesystemMemoryStore;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nachos-memory-test-'));
    store = new FilesystemMemoryStore(tempDir);
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  function makeEntry(overrides?: Partial<MemoryEntry>): MemoryEntry {
    return {
      id: `entry-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      agentId: 'agent-1',
      kind: 'summary',
      content: 'Test memory entry content',
      tags: ['test'],
      createdAt: new Date().toISOString(),
      source: 'test',
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
      confidence: 0.9,
      createdAt: new Date().toISOString(),
      source: 'test',
      ...overrides,
    };
  }

  describe('appendEntry', () => {
    it('appends an entry and returns it', async () => {
      const entry = makeEntry();
      const result = await store.appendEntry(entry);

      expect(result).toEqual(entry);
    });

    it('creates the agent directory if it does not exist', async () => {
      const entry = makeEntry({ agentId: 'new-agent' });
      await store.appendEntry(entry);

      const agentDir = path.join(tempDir, 'new-agent');
      const stat = await fs.stat(agentDir);
      expect(stat.isDirectory()).toBe(true);
    });

    it('persists entries to disk as JSONL', async () => {
      const entry = makeEntry();
      await store.appendEntry(entry);

      const filePath = path.join(tempDir, entry.agentId, 'entries.jsonl');
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(1);

      const parsed = JSON.parse(lines[0]!);
      expect(parsed.id).toBe(entry.id);
      expect(parsed.content).toBe(entry.content);
    });

    it('appends multiple entries to the same file', async () => {
      const entry1 = makeEntry({ content: 'First' });
      const entry2 = makeEntry({ content: 'Second' });

      await store.appendEntry(entry1);
      await store.appendEntry(entry2);

      const filePath = path.join(tempDir, 'agent-1', 'entries.jsonl');
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(2);
    });
  });

  describe('appendFacts', () => {
    it('appends facts and returns them', async () => {
      const facts = [
        makeFact({ subject: 'user', predicate: 'likes', object: 'coffee' }),
        makeFact({ subject: 'user', predicate: 'dislikes', object: 'bugs' }),
      ];

      const result = await store.appendFacts(facts);
      expect(result).toEqual(facts);
    });

    it('persists facts to disk as JSONL', async () => {
      const fact = makeFact();
      await store.appendFacts([fact]);

      const filePath = path.join(tempDir, fact.agentId, 'facts.jsonl');
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines).toHaveLength(1);

      const parsed = JSON.parse(lines[0]!);
      expect(parsed.subject).toBe(fact.subject);
    });

    it('returns empty array when given empty facts', async () => {
      const result = await store.appendFacts([]);
      expect(result).toEqual([]);
    });
  });

  describe('query', () => {
    it('returns all entries for an agent', async () => {
      await store.appendEntry(makeEntry({ content: 'Entry 1' }));
      await store.appendEntry(makeEntry({ content: 'Entry 2' }));

      const result = await store.query({ agentId: 'agent-1' });
      expect(result.entries).toHaveLength(2);
    });

    it('returns empty results for non-existent agent', async () => {
      const result = await store.query({ agentId: 'no-such-agent' });
      expect(result.entries).toHaveLength(0);
    });

    it('filters entries by kind', async () => {
      await store.appendEntry(makeEntry({ kind: 'summary', content: 'Summary' }));
      await store.appendEntry(makeEntry({ kind: 'preference', content: 'Preference' }));

      const result = await store.query({ agentId: 'agent-1', kinds: ['summary'] });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]!.kind).toBe('summary');
    });

    it('filters entries by tags', async () => {
      await store.appendEntry(makeEntry({ tags: ['important'], content: 'Tagged' }));
      await store.appendEntry(makeEntry({ tags: ['low-priority'], content: 'Other' }));

      const result = await store.query({ agentId: 'agent-1', tags: ['important'] });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]!.content).toBe('Tagged');
    });

    it('filters entries by text search (case-insensitive)', async () => {
      await store.appendEntry(makeEntry({ content: 'The user likes TypeScript' }));
      await store.appendEntry(makeEntry({ content: 'No match here' }));

      const result = await store.query({ agentId: 'agent-1', text: 'typescript' });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]!.content).toContain('TypeScript');
    });

    it('applies limit and offset', async () => {
      for (let i = 0; i < 5; i++) {
        await store.appendEntry(makeEntry({ content: `Entry ${i}` }));
      }

      const result = await store.query({
        agentId: 'agent-1',
        limit: 2,
        offset: 1,
      });
      expect(result.entries).toHaveLength(2);
      expect(result.entries[0]!.content).toBe('Entry 1');
    });

    it('includes facts in query results', async () => {
      await store.appendFacts([
        makeFact({ subject: 'user', predicate: 'likes', object: 'TypeScript' }),
      ]);

      const result = await store.query({ agentId: 'agent-1' });
      expect(result.facts).toBeDefined();
      expect(result.facts!.length).toBeGreaterThanOrEqual(1);
    });

    it('filters facts by text search', async () => {
      await store.appendFacts([
        makeFact({ subject: 'user', predicate: 'likes', object: 'TypeScript' }),
        makeFact({ subject: 'user', predicate: 'hates', object: 'Python' }),
      ]);

      const result = await store.query({ agentId: 'agent-1', text: 'typescript' });
      expect(result.facts).toBeDefined();
      expect(result.facts!).toHaveLength(1);
      expect(result.facts![0]!.object).toBe('TypeScript');
    });

    it('excludes facts when kinds filter does not include "fact"', async () => {
      await store.appendFacts([makeFact()]);
      await store.appendEntry(makeEntry({ kind: 'summary' }));

      const result = await store.query({ agentId: 'agent-1', kinds: ['summary'] });
      expect(result.facts).toBeUndefined();
    });
  });

  describe('deleteEntry', () => {
    it('removes an entry by ID', async () => {
      const entry1 = makeEntry({ content: 'Keep this' });
      const entry2 = makeEntry({ content: 'Delete this' });

      await store.appendEntry(entry1);
      await store.appendEntry(entry2);

      await store.deleteEntry(entry2.id, 'agent-1');

      const result = await store.query({ agentId: 'agent-1' });
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0]!.content).toBe('Keep this');
    });

    it('does not throw when deleting non-existent entry', async () => {
      await store.appendEntry(makeEntry());

      await expect(
        store.deleteEntry('non-existent-id', 'agent-1')
      ).resolves.not.toThrow();
    });

    it('throws when agent directory does not exist', async () => {
      // deleteEntry reads entries (returns []) but then tries to write
      // the filtered list back, which fails because the directory is missing
      await expect(
        store.deleteEntry('some-id', 'no-such-agent')
      ).rejects.toThrow('ENOENT');
    });
  });

  describe('constructor with config object', () => {
    it('accepts a config object with baseDir', () => {
      const configStore = new FilesystemMemoryStore({
        baseDir: tempDir,
        enableSemantic: false,
      });

      expect(configStore).toBeDefined();
    });

    it('defaults semantic search to disabled', async () => {
      const configStore = new FilesystemMemoryStore({
        baseDir: tempDir,
      });

      const entry = makeEntry();
      await configStore.appendEntry(entry);

      const result = await configStore.query({ agentId: entry.agentId });
      expect(result.entries).toHaveLength(1);
    });
  });
});
