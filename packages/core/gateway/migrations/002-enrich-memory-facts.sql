-- Migration 002: Enrich memory_facts with type, properties, source_context, timestamps
--
-- Adds richer knowledge representation to SPO triples without requiring
-- a full graph database. Supports fact categorization, arbitrary properties,
-- source tracking, and expiration.

-- Add new columns to memory_facts (Postgres migration — use JSONB for properties)
ALTER TABLE memory_facts ADD COLUMN type TEXT DEFAULT 'general';
ALTER TABLE memory_facts ADD COLUMN properties JSONB;
ALTER TABLE memory_facts ADD COLUMN source_context TEXT;
ALTER TABLE memory_facts ADD COLUMN updated_at TEXT;
ALTER TABLE memory_facts ADD COLUMN expires_at TEXT;

-- Add indexes for the new columns
CREATE INDEX IF NOT EXISTS memory_facts_agent_type_idx ON memory_facts(agent_id, type);
CREATE INDEX IF NOT EXISTS memory_facts_subject_idx ON memory_facts(agent_id, subject);

-- Backfill: set type to 'general' for existing rows (already handled by DEFAULT)
