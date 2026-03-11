-- Migration 003: Workspace document indexing for RAG
--
-- Stores document metadata and text chunks. Vectors are handled externally
-- by nachos-embeddings (not stored in the database).

CREATE TABLE IF NOT EXISTS workspace_documents (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  project_id TEXT,
  metadata JSONB,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  last_indexed TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS workspace_documents_path_project_idx
  ON workspace_documents(path, COALESCE(project_id, ''));

CREATE INDEX IF NOT EXISTS workspace_documents_project_idx
  ON workspace_documents(project_id);

CREATE TABLE IF NOT EXISTS document_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  token_count INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES workspace_documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS document_chunks_document_idx
  ON document_chunks(document_id, chunk_index);
