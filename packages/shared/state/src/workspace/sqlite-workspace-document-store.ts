/**
 * SQLite WorkspaceDocumentStore implementation.
 *
 * Stores workspace document metadata and chunks in SQLite.
 * Vectors are handled externally by nachos-embeddings (not stored here).
 */

import type Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import type {
  WorkspaceDocument,
  DocumentChunk,
  WorkspaceDocumentQuery,
  WorkspaceDocumentStore,
} from '@nachos/types';

interface DocumentRow {
  id: string;
  path: string;
  content_hash: string;
  project_id: string | null;
  metadata: string | null;
  chunk_count: number;
  last_indexed: string;
  created_at: string;
  updated_at: string;
}

interface ChunkRow {
  id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  token_count: number | null;
  created_at: string;
}

export class SqliteWorkspaceDocumentStore implements WorkspaceDocumentStore {
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
      CREATE TABLE IF NOT EXISTS workspace_documents (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        project_id TEXT,
        metadata TEXT,
        chunk_count INTEGER NOT NULL DEFAULT 0,
        last_indexed TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS workspace_documents_path_project_idx
        ON workspace_documents(path, COALESCE(project_id, ''))
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS workspace_documents_project_idx
        ON workspace_documents(project_id)
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS document_chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        token_count INTEGER,
        created_at TEXT NOT NULL,
        FOREIGN KEY (document_id) REFERENCES workspace_documents(id) ON DELETE CASCADE
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS document_chunks_document_idx
        ON document_chunks(document_id, chunk_index)
    `);

    this.initialized = true;
  }

  private rowToDocument(row: DocumentRow): WorkspaceDocument {
    return {
      id: row.id,
      path: row.path,
      contentHash: row.content_hash,
      projectId: row.project_id ?? undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      chunkCount: row.chunk_count,
      lastIndexed: row.last_indexed,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private rowToChunk(row: ChunkRow): DocumentChunk {
    return {
      id: row.id,
      documentId: row.document_id,
      chunkIndex: row.chunk_index,
      content: row.content,
      tokenCount: row.token_count ?? undefined,
      createdAt: row.created_at,
    };
  }

  async indexDocument(doc: WorkspaceDocument, chunks: DocumentChunk[]): Promise<WorkspaceDocument> {
    const now = new Date().toISOString();
    const docId = doc.id || uuid();

    const txn = this.db.transaction(() => {
      // Upsert document — remove old chunks if re-indexing
      const existing = this.db
        .prepare(
          `SELECT id FROM workspace_documents WHERE path = ? AND COALESCE(project_id, '') = ?`
        )
        .get(doc.path, doc.projectId ?? '') as { id: string } | undefined;

      if (existing) {
        // Re-index: delete old chunks, update document
        this.db.prepare('DELETE FROM document_chunks WHERE document_id = ?').run(existing.id);
        this.db
          .prepare(
            `UPDATE workspace_documents
             SET content_hash = ?, metadata = ?, chunk_count = ?, last_indexed = ?, updated_at = ?
             WHERE id = ?`
          )
          .run(
            doc.contentHash,
            doc.metadata ? JSON.stringify(doc.metadata) : null,
            chunks.length,
            now,
            now,
            existing.id
          );

        // Insert new chunks
        const insertChunk = this.db.prepare(
          `INSERT INTO document_chunks (id, document_id, chunk_index, content, token_count, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        );
        for (const chunk of chunks) {
          insertChunk.run(
            chunk.id || uuid(),
            existing.id,
            chunk.chunkIndex,
            chunk.content,
            chunk.tokenCount ?? null,
            now
          );
        }

        return existing.id;
      }

      // New document
      this.db
        .prepare(
          `INSERT INTO workspace_documents
            (id, path, content_hash, project_id, metadata, chunk_count, last_indexed, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          docId,
          doc.path,
          doc.contentHash,
          doc.projectId ?? null,
          doc.metadata ? JSON.stringify(doc.metadata) : null,
          chunks.length,
          now,
          now,
          now
        );

      const insertChunk = this.db.prepare(
        `INSERT INTO document_chunks (id, document_id, chunk_index, content, token_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const chunk of chunks) {
        insertChunk.run(
          chunk.id || uuid(),
          docId,
          chunk.chunkIndex,
          chunk.content,
          chunk.tokenCount ?? null,
          now
        );
      }

      return docId;
    });

    const finalId = txn();

    const result = this.db
      .prepare('SELECT * FROM workspace_documents WHERE id = ?')
      .get(finalId) as DocumentRow;
    return this.rowToDocument(result);
  }

  async getDocument(id: string): Promise<WorkspaceDocument | null> {
    const row = this.db.prepare('SELECT * FROM workspace_documents WHERE id = ?').get(id) as
      | DocumentRow
      | undefined;
    return row ? this.rowToDocument(row) : null;
  }

  async getDocumentByPath(path: string, projectId?: string): Promise<WorkspaceDocument | null> {
    const row = this.db
      .prepare(`SELECT * FROM workspace_documents WHERE path = ? AND COALESCE(project_id, '') = ?`)
      .get(path, projectId ?? '') as DocumentRow | undefined;
    return row ? this.rowToDocument(row) : null;
  }

  async getChunks(documentId: string): Promise<DocumentChunk[]> {
    const rows = this.db
      .prepare('SELECT * FROM document_chunks WHERE document_id = ? ORDER BY chunk_index ASC')
      .all(documentId) as ChunkRow[];
    return rows.map((row) => this.rowToChunk(row));
  }

  async removeDocument(id: string): Promise<boolean> {
    const txn = this.db.transaction(() => {
      // Chunks deleted by CASCADE
      const result = this.db.prepare('DELETE FROM workspace_documents WHERE id = ?').run(id);
      return result.changes > 0;
    });
    return txn();
  }

  async listDocuments(query?: WorkspaceDocumentQuery): Promise<WorkspaceDocument[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (query?.projectId) {
      conditions.push('project_id = ?');
      values.push(query.projectId);
    }
    if (query?.path) {
      conditions.push('path LIKE ?');
      values.push(`%${query.path}%`);
    }

    let sql = 'SELECT * FROM workspace_documents';
    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }
    sql += ' ORDER BY last_indexed DESC';

    if (query && query.limit !== undefined) {
      sql += ' LIMIT ?';
      values.push(query.limit);
    }
    if (query && query.offset !== undefined) {
      sql += ' OFFSET ?';
      values.push(query.offset);
    }

    const rows = this.db.prepare(sql).all(...values) as DocumentRow[];
    return rows.map((row) => this.rowToDocument(row));
  }

  async close(): Promise<void> {
    try {
      this.db.close();
    } catch {
      // Ignore close errors to avoid impacting callers
    }
  }
}
