BEGIN;
ALTER TABLE teamchat.ai_jobs ADD COLUMN IF NOT EXISTS memory_consent boolean NOT NULL DEFAULT false;
COMMIT;
