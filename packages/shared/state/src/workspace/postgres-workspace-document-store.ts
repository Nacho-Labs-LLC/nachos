/**
 * PostgreSQL WorkspaceDocumentStore implementation.
 *
 * Stores workspace document metadata and chunks in PostgreSQL.
 * Vectors are handled externally by nachos-embeddings (not stored here).
 */

import type { Pool } from 'pg';
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
  metadata: Record<string, unknown> | null;
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

export class PostgresWorkspaceDocumentStore implements WorkspaceDocumentStore {
  private initialized = false;
  private schemaPromise: Promise<void> | null = null;
  private schema: string;

  constructor(
    private pool: Pool,
    schema?: string
  ) {
    this.schema = schema ?? 'public';
  }

  private rowToDocument(row: DocumentRow): WorkspaceDocument {
    return {
      id: row.id,
      path: row.path,
      contentHash: row.content_hash,
      projectId: row.project_id ?? undefined,
      metadata: row.metadata ?? undefined,
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

  async indexDocument(
    doc: WorkspaceDocument,
    chunks: DocumentChunk[]
  ): Promise<WorkspaceDocument> {
    await this.ensureSchema();
    const now = new Date().toISOString();
    const docId = doc.id || uuid();
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Upsert document
      const upsertResult = await client.query(
        `INSERT INTO ${this.qualified('workspace_documents')}
          (id, path, content_hash, project_id, metadata, chunk_count, last_indexed, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (path, COALESCE(project_id, ''))
         DO UPDATE SET
           content_hash = EXCLUDED.content_hash,
           metadata = EXCLUDED.metadata,
           chunk_count = EXCLUDED.chunk_count,
           last_indexed = EXCLUDED.last_indexed,
           updated_at = EXCLUDED.updated_at
         RETURNING id`,
        [
          docId,
          doc.path,
          doc.contentHash,
          doc.projectId ?? null,
          doc.metadata ? JSON.stringify(doc.metadata) : null,
          chunks.length,
          now,
          now,
          now,
        ]
      );

      const finalId = upsertResult.rows[0].id;

      // Delete old chunks and insert new ones
      await client.query(
        `DELETE FROM ${this.qualified('document_chunks')} WHERE document_id = $1`,
        [finalId]
      );

      if (chunks.length > 0) {
        const values: unknown[] = [];
        const colCount = 6;
        const rowPlaceholders = chunks
          .map((chunk, i) => {
            const base = i * colCount;
            values.push(
              chunk.id || uuid(),
              finalId,
              chunk.chunkIndex,
              chunk.content,
              chunk.tokenCount ?? null,
              now
            );
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
          })
          .join(', ');

        await client.query(
          `INSERT INTO ${this.qualified('document_chunks')}
            (id, document_id, chunk_index, content, token_count, created_at)
           VALUES ${rowPlaceholders}`,
          values
        );
      }

      await client.query('COMMIT');

      // Fetch the final document
      const result = await this.pool.query(
        `SELECT * FROM ${this.qualified('workspace_documents')} WHERE id = $1`,
        [finalId]
      );
      return this.rowToDocument(result.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async getDocument(id: string): Promise<WorkspaceDocument | null> {
    await this.ensureSchema();
    const result = await this.pool.query(
      `SELECT * FROM ${this.qualified('workspace_documents')} WHERE id = $1`,
      [id]
    );
    return result.rows[0] ? this.rowToDocument(result.rows[0]) : null;
  }

  async getDocumentByPath(
    path: string,
    projectId?: string
  ): Promise<WorkspaceDocument | null> {
    await this.ensureSchema();
    const result = await this.pool.query(
      `SELECT * FROM ${this.qualified('workspace_documents')}
       WHERE path = $1 AND COALESCE(project_id, '') = $2`,
      [path, projectId ?? '']
    );
    return result.rows[0] ? this.rowToDocument(result.rows[0]) : null;
  }

  async getChunks(documentId: string): Promise<DocumentChunk[]> {
    await this.ensureSchema();
    const result = await this.pool.query(
      `SELECT * FROM ${this.qualified('document_chunks')}
       WHERE document_id = $1 ORDER BY chunk_index ASC`,
      [documentId]
    );
    return result.rows.map((row: ChunkRow) => this.rowToChunk(row));
  }

  async removeDocument(id: string): Promise<boolean> {
    await this.ensureSchema();
    // Chunks deleted by CASCADE
    const result = await this.pool.query(
      `DELETE FROM ${this.qualified('workspace_documents')} WHERE id = $1`,
      [id]
    );
    return (result.rowCount ?? 0) > 0;
  }

  async listDocuments(query?: WorkspaceDocumentQuery): Promise<WorkspaceDocument[]> {
    await this.ensureSchema();
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (query?.projectId) {
      values.push(query.projectId);
      conditions.push(`project_id = $${values.length}`);
    }
    if (query?.path) {
      values.push(`%${query.path}%`);
      conditions.push(`path ILIKE $${values.length}`);
    }

    let sql = `SELECT * FROM ${this.qualified('workspace_documents')}`;
    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }
    sql += ' ORDER BY last_indexed DESC';

    if (query?.limit) {
      values.push(query.limit);
      sql += ` LIMIT $${values.length}`;
    }
    if (query?.offset) {
      values.push(query.offset);
      sql += ` OFFSET $${values.length}`;
    }

    const result = await this.pool.query(sql, values);
    return result.rows.map((row: DocumentRow) => this.rowToDocument(row));
  }

  async close(): Promise<void> {
    // Pool lifecycle managed by StateLayer
  }

  private qualified(table: string): string {
    return `"${this.schema}".${table}`;
  }

  private ensureSchema(): Promise<void> {
    if (this.initialized) return Promise.resolve();
    if (!this.schemaPromise) {
      this.schemaPromise = this.runSchema()
        .then(() => {
          this.initialized = true;
          this.schemaPromise = null;
        })
        .catch((err) => {
          this.schemaPromise = null;
          throw err;
        });
    }
    return this.schemaPromise;
  }

  private async runSchema(): Promise<void> {
    await this.pool.query(`CREATE SCHEMA IF NOT EXISTS "${this.schema}"`);

    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS ${this.qualified('workspace_documents')} (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        project_id TEXT,
        metadata JSONB,
        chunk_count INTEGER NOT NULL DEFAULT 0,
        last_indexed TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`
    );

    await this.pool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS workspace_documents_path_project_idx
       ON ${this.qualified('workspace_documents')}(path, COALESCE(project_id, ''))`
    );

    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS workspace_documents_project_idx
       ON ${this.qualified('workspace_documents')}(project_id)`
    );

    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS ${this.qualified('document_chunks')} (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES ${this.qualified('workspace_documents')}(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        token_count INTEGER,
        created_at TEXT NOT NULL
      )`
    );

    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS document_chunks_document_idx
       ON ${this.qualified('document_chunks')}(document_id, chunk_index)`
    );
  }
}
