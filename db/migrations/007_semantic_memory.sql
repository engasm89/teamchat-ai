-- Run as the migration owner. Google Cloud SQL must have pgvector available.
-- This must be applied BEFORE configuring the worker to use semantic memory.
BEGIN;
CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE teamchat.memories ADD COLUMN IF NOT EXISTS embedding vector(768);
ALTER TABLE teamchat.memories ADD COLUMN IF NOT EXISTS embedding_model text;
-- The RLS policy in 001_schema.sql already covers this table and its new fields.
CREATE INDEX IF NOT EXISTS memories_semantic_partial_idx
  ON teamchat.memories(tenant_id) WHERE embedding IS NOT NULL;
COMMIT;
