-- Migration: Add session management fields for web chat
-- Date: 2026-02-26
-- Description: Adds is_pinned, is_archived, and last_activity columns to sessions table

-- Add new columns to sessions table
ALTER TABLE sessions 
ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS last_activity TEXT;

-- Backfill last_activity with updated_at for existing sessions
UPDATE sessions 
SET last_activity = updated_at 
WHERE last_activity IS NULL;

-- Make last_activity NOT NULL after backfilling
ALTER TABLE sessions 
ALTER COLUMN last_activity SET NOT NULL;

-- Create index for active sessions query (optimized for listActive)
CREATE INDEX IF NOT EXISTS sessions_active_idx 
ON sessions(channel, is_archived, last_activity) 
WHERE is_archived = false;

-- Create index for archived sessions query
CREATE INDEX IF NOT EXISTS sessions_archived_idx 
ON sessions(channel, is_archived, updated_at) 
WHERE is_archived = true;
