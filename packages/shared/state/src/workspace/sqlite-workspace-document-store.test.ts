/**
 * Tests for SqliteWorkspaceDocumentStore
 *
 * Uses an in-memory SQLite database for fast, isolated tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SqliteWorkspaceDocumentStore } from './sqlite-workspace-document-store.js';
import type { WorkspaceDocument, DocumentChunk } from '@nachos/types';

describe('SqliteWorkspaceDocumentStore', () => {
  let db: Database.Database;
  let store: SqliteWorkspaceDocumentStore;

  beforeEach(() => {
    db = new Database(':memory:');
    store = new SqliteWorkspaceDocumentStore(db);
  });

  afterEach(async () => {
    await store.close();
    try {
      db.close();
    } catch {
      // already closed
    }
  });

  const makeDoc = (overrides?: Partial<WorkspaceDocument>): WorkspaceDocument => ({
    id: `doc-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    path: '/src/gateway.ts',
    contentHash: 'abc123',
    projectId: 'nachos',
    chunkCount: 0,
    lastIndexed: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  });

  const makeChunks = (docId: string, count: number): DocumentChunk[] =>
    Array.from({ length: count }, (_, i) => ({
      id: `chunk-${docId}-${i}`,
      documentId: docId,
      chunkIndex: i,
      content: `Chunk ${i} content for document`,
      tokenCount: 50 + i * 10,
      createdAt: new Date().toISOString(),
    }));

  describe('indexDocument', () => {
    it('indexes a document with chunks', async () => {
      const doc = makeDoc();
      const chunks = makeChunks(doc.id, 3);

      const result = await store.indexDocument(doc, chunks);

      expect(result.path).toBe('/src/gateway.ts');
      expect(result.contentHash).toBe('abc123');
      expect(result.chunkCount).toBe(3);
      expect(result.projectId).toBe('nachos');
    });

    it('retrieves chunks in order', async () => {
      const doc = makeDoc();
      const chunks = makeChunks(doc.id, 5);
      await store.indexDocument(doc, chunks);

      const stored = await store.getDocumentByPath('/src/gateway.ts', 'nachos');
      expect(stored).not.toBeNull();

      const storedChunks = await store.getChunks(stored!.id);
      expect(storedChunks).toHaveLength(5);
      expect(storedChunks[0]!.chunkIndex).toBe(0);
      expect(storedChunks[4]!.chunkIndex).toBe(4);
      expect(storedChunks[2]!.tokenCount).toBe(70);
    });

    it('re-indexes a document (replaces old chunks)', async () => {
      const doc = makeDoc();
      const oldChunks = makeChunks(doc.id, 3);
      await store.indexDocument(doc, oldChunks);

      // Re-index with different content
      const updatedDoc = makeDoc({ contentHash: 'def456' });
      const newChunks = makeChunks(updatedDoc.id, 2);
      await store.indexDocument(updatedDoc, newChunks);

      // Should have only 1 document (upserted)
      const docs = await store.listDocuments({ projectId: 'nachos' });
      expect(docs).toHaveLength(1);
      expect(docs[0]!.contentHash).toBe('def456');
      expect(docs[0]!.chunkCount).toBe(2);

      // Old chunks should be gone
      const chunks = await store.getChunks(docs[0]!.id);
      expect(chunks).toHaveLength(2);
    });

    it('indexes a document without projectId', async () => {
      const doc = makeDoc({ projectId: undefined });
      const chunks = makeChunks(doc.id, 1);
      const result = await store.indexDocument(doc, chunks);

      expect(result.projectId).toBeUndefined();

      const _found = await store.getDocumentByPath('/src/gateway.ts');
      expect(found).not.toBeNull();
    });

    it('stores document metadata as JSON', async () => {
      const doc = makeDoc({
        metadata: { language: 'typescript', framework: 'hono' },
      });
      await store.indexDocument(doc, []);

      const _found = await store.getDocument(doc.id);
      // May get a different ID if upserted
      const docs = await store.listDocuments({ projectId: 'nachos' });
      expect(docs[0]!.metadata).toEqual({ language: 'typescript', framework: 'hono' });
    });
  });

  describe('getDocument', () => {
    it('returns a document by ID', async () => {
      const doc = makeDoc();
      const result = await store.indexDocument(doc, []);

      const _found = await store.getDocument(result.id);
      expect(found).not.toBeNull();
      expect(found!.path).toBe('/src/gateway.ts');
    });

    it('returns null for non-existent ID', async () => {
      const _found = await store.getDocument('non-existent');
      expect(found).toBeNull();
    });
  });

  describe('getDocumentByPath', () => {
    it('finds a document by path and projectId', async () => {
      const doc = makeDoc();
      await store.indexDocument(doc, []);

      const _found = await store.getDocumentByPath('/src/gateway.ts', 'nachos');
      expect(found).not.toBeNull();
      expect(found!.contentHash).toBe('abc123');
    });

    it('returns null when path does not match', async () => {
      const doc = makeDoc();
      await store.indexDocument(doc, []);

      const _found = await store.getDocumentByPath('/src/other.ts', 'nachos');
      expect(found).toBeNull();
    });

    it('differentiates by projectId', async () => {
      await store.indexDocument(
        makeDoc({ path: '/src/app.ts', projectId: 'proj-a', contentHash: 'aaa' }),
        []
      );
      await store.indexDocument(
        makeDoc({ path: '/src/app.ts', projectId: 'proj-b', contentHash: 'bbb' }),
        []
      );

      const a = await store.getDocumentByPath('/src/app.ts', 'proj-a');
      const b = await store.getDocumentByPath('/src/app.ts', 'proj-b');

      expect(a!.contentHash).toBe('aaa');
      expect(b!.contentHash).toBe('bbb');
    });
  });

  describe('removeDocument', () => {
    it('removes a document and its chunks', async () => {
      const doc = makeDoc();
      const chunks = makeChunks(doc.id, 3);
      const indexed = await store.indexDocument(doc, chunks);

      const removed = await store.removeDocument(indexed.id);
      expect(removed).toBe(true);

      const _found = await store.getDocument(indexed.id);
      expect(found).toBeNull();

      const remainingChunks = await store.getChunks(indexed.id);
      expect(remainingChunks).toHaveLength(0);
    });

    it('returns false for non-existent document', async () => {
      const removed = await store.removeDocument('non-existent');
      expect(removed).toBe(false);
    });
  });

  describe('listDocuments', () => {
    it('lists all documents', async () => {
      await store.indexDocument(makeDoc({ path: '/src/a.ts' }), []);
      await store.indexDocument(makeDoc({ path: '/src/b.ts' }), []);
      await store.indexDocument(makeDoc({ path: '/src/c.ts' }), []);

      const docs = await store.listDocuments();
      expect(docs).toHaveLength(3);
    });

    it('filters by projectId', async () => {
      await store.indexDocument(makeDoc({ path: '/a.ts', projectId: 'proj-a' }), []);
      await store.indexDocument(makeDoc({ path: '/b.ts', projectId: 'proj-b' }), []);

      const docs = await store.listDocuments({ projectId: 'proj-a' });
      expect(docs).toHaveLength(1);
      expect(docs[0]!.projectId).toBe('proj-a');
    });

    it('filters by path pattern', async () => {
      await store.indexDocument(makeDoc({ path: '/src/gateway.ts' }), []);
      await store.indexDocument(makeDoc({ path: '/src/router.ts' }), []);
      await store.indexDocument(makeDoc({ path: '/tests/test.ts' }), []);

      const docs = await store.listDocuments({ path: '/src/' });
      expect(docs).toHaveLength(2);
    });

    it('respects limit and offset', async () => {
      for (let i = 0; i < 10; i++) {
        await store.indexDocument(makeDoc({ path: `/src/file-${i}.ts` }), []);
      }

      const docs = await store.listDocuments({ limit: 3, offset: 2 });
      expect(docs).toHaveLength(3);
    });
  });
});
