-- TeamChat AI — v1 PostgreSQL schema. Must be executed by a dedicated migration owner,
-- NOT by the application runtime role. No credentials or privileged connection strings in repo.
BEGIN;
CREATE SCHEMA IF NOT EXISTS teamchat;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS teamchat.tenants (
  tenant_id text PRIMARY KEY CHECK (tenant_id ~ '^[a-z][a-z0-9-]+$'),
  display_name text NOT NULL
);
CREATE TABLE IF NOT EXISTS teamchat.user_memberships (
  tenant_id text NOT NULL REFERENCES teamchat.tenants(tenant_id),
  firebase_uid text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL DEFAULT 'member',
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, firebase_uid)
);
CREATE TABLE IF NOT EXISTS teamchat.rooms (
  tenant_id text NOT NULL REFERENCES teamchat.tenants(tenant_id),
  room_id text NOT NULL,
  title text NOT NULL,
  notify_token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  next_sequence bigint NOT NULL DEFAULT 1 CHECK (next_sequence > 0),
  PRIMARY KEY (tenant_id, room_id)
);
CREATE TABLE IF NOT EXISTS teamchat.room_memberships (
  tenant_id text NOT NULL,
  room_id text NOT NULL,
  firebase_uid text NOT NULL,
  PRIMARY KEY (tenant_id, room_id, firebase_uid),
  FOREIGN KEY (tenant_id, room_id) REFERENCES teamchat.rooms(tenant_id, room_id),
  FOREIGN KEY (tenant_id, firebase_uid) REFERENCES teamchat.user_memberships(tenant_id, firebase_uid)
);
CREATE TABLE IF NOT EXISTS teamchat.catalog (
  tenant_id text NOT NULL REFERENCES teamchat.tenants(tenant_id),
  catalog_code text NOT NULL,
  description text NOT NULL,
  product_family text NOT NULL,
  department text NOT NULL,
  seasonality text NOT NULL,
  specificity text NOT NULL,
  margin_class text,
  margin_class_label text,
  dataset_hash text NOT NULL,
  PRIMARY KEY (tenant_id, catalog_code)
);
CREATE TABLE IF NOT EXISTS teamchat.margin_classes (
  tenant_id text NOT NULL REFERENCES teamchat.tenants(tenant_id),
  margin_class text NOT NULL,
  label text NOT NULL,
  coefficient_loyalty numeric(16,6) NOT NULL,
  coefficient_standard numeric(16,6) NOT NULL,
  PRIMARY KEY (tenant_id, margin_class)
);
ALTER TABLE teamchat.catalog DROP CONSTRAINT IF EXISTS catalog_margin_class_fk;
ALTER TABLE teamchat.catalog ADD CONSTRAINT catalog_margin_class_fk
  FOREIGN KEY (tenant_id, margin_class) REFERENCES teamchat.margin_classes(tenant_id, margin_class);
CREATE TABLE IF NOT EXISTS teamchat.supersession_edges (
  tenant_id text NOT NULL,
  source_class text NOT NULL,
  target_class text NOT NULL,
  PRIMARY KEY (tenant_id, source_class, target_class),
  FOREIGN KEY (tenant_id, source_class) REFERENCES teamchat.margin_classes(tenant_id, margin_class),
  FOREIGN KEY (tenant_id, target_class) REFERENCES teamchat.margin_classes(tenant_id, margin_class),
  CHECK (source_class <> target_class)
);
CREATE TABLE IF NOT EXISTS teamchat.segment_coefficients (
  tenant_id text NOT NULL REFERENCES teamchat.tenants(tenant_id),
  channel text NOT NULL, store_format text NOT NULL, segment text NOT NULL,
  coefficient numeric(16,6) NOT NULL,
  PRIMARY KEY (tenant_id, channel, store_format, segment)
);
CREATE TABLE IF NOT EXISTS teamchat.stores (
  tenant_id text NOT NULL REFERENCES teamchat.tenants(tenant_id),
  store_id text NOT NULL,
  store_name text NOT NULL,
  channel text NOT NULL, store_format text NOT NULL, segment text NOT NULL,
  opened integer NOT NULL, buyer text NOT NULL, last_review date,
  PRIMARY KEY (tenant_id, store_id),
  FOREIGN KEY (tenant_id, channel, store_format, segment)
    REFERENCES teamchat.segment_coefficients(tenant_id, channel, store_format, segment)
);
CREATE TABLE IF NOT EXISTS teamchat.store_carried_codes (
  tenant_id text NOT NULL, store_id text NOT NULL, catalog_code text NOT NULL,
  PRIMARY KEY (tenant_id, store_id, catalog_code),
  FOREIGN KEY (tenant_id, store_id) REFERENCES teamchat.stores(tenant_id, store_id),
  FOREIGN KEY (tenant_id, catalog_code) REFERENCES teamchat.catalog(tenant_id, catalog_code)
);
CREATE TABLE IF NOT EXISTS teamchat.store_gaps (
  tenant_id text NOT NULL, store_id text NOT NULL, catalog_code text NOT NULL,
  description text NOT NULL, last_carried text NOT NULL, evidence text NOT NULL,
  PRIMARY KEY (tenant_id, store_id, catalog_code),
  FOREIGN KEY (tenant_id, store_id) REFERENCES teamchat.stores(tenant_id, store_id),
  FOREIGN KEY (tenant_id, catalog_code) REFERENCES teamchat.catalog(tenant_id, catalog_code)
);
CREATE TABLE IF NOT EXISTS teamchat.memories (
  tenant_id text NOT NULL REFERENCES teamchat.tenants(tenant_id),
  memory_id text NOT NULL, key text NOT NULL,
  value jsonb NOT NULL CHECK (jsonb_typeof(value) = 'object'),
  created_by text NOT NULL, created_at timestamptz NOT NULL,
  source_room_id text NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  -- Embedding column added after Vertex model/dimension is verified.
  PRIMARY KEY (tenant_id, memory_id), UNIQUE (tenant_id, key),
  FOREIGN KEY (tenant_id, source_room_id) REFERENCES teamchat.rooms(tenant_id, room_id)
);
CREATE TABLE IF NOT EXISTS teamchat.memory_versions (
  tenant_id text NOT NULL, memory_id text NOT NULL, version bigint NOT NULL,
  value jsonb NOT NULL, changed_by text NOT NULL, changed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, memory_id, version),
  FOREIGN KEY (tenant_id, memory_id) REFERENCES teamchat.memories(tenant_id, memory_id)
);
CREATE TABLE IF NOT EXISTS teamchat.messages (
  tenant_id text NOT NULL, room_id text NOT NULL, message_id uuid NOT NULL DEFAULT gen_random_uuid(),
  author_uid text NOT NULL, client_message_id text NOT NULL, body text NOT NULL,
  event_sequence bigint NOT NULL CHECK (event_sequence > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, room_id, message_id),
  UNIQUE (tenant_id, author_uid, client_message_id),
  FOREIGN KEY (tenant_id, room_id) REFERENCES teamchat.rooms(tenant_id, room_id),
  FOREIGN KEY (tenant_id, author_uid) REFERENCES teamchat.user_memberships(tenant_id, firebase_uid)
);
CREATE TABLE IF NOT EXISTS teamchat.ai_jobs (
  tenant_id text NOT NULL, room_id text NOT NULL,
  turn_id uuid NOT NULL, user_uid text NOT NULL,
  state text NOT NULL CHECK(state IN ('queued','running','completed','failed')),
  transcript_cutoff bigint NOT NULL, lease_owner text, fencing_token bigint NOT NULL DEFAULT 0,
  lease_expires_at timestamptz, attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, turn_id),
  FOREIGN KEY (tenant_id, room_id) REFERENCES teamchat.rooms(tenant_id, room_id),
  FOREIGN KEY (tenant_id, user_uid) REFERENCES teamchat.user_memberships(tenant_id, firebase_uid)
);
CREATE TABLE IF NOT EXISTS teamchat.room_events (
  tenant_id text NOT NULL, room_id text NOT NULL,
  sequence bigint NOT NULL CHECK(sequence > 0),
  event_id uuid NOT NULL DEFAULT gen_random_uuid(),
  type text NOT NULL, turn_id uuid,
  payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, room_id, sequence),
  UNIQUE (tenant_id, event_id),
  FOREIGN KEY (tenant_id, room_id) REFERENCES teamchat.rooms(tenant_id, room_id),
  FOREIGN KEY (tenant_id, turn_id) REFERENCES teamchat.ai_jobs(tenant_id, turn_id)
);
CREATE TABLE IF NOT EXISTS teamchat.task_outbox (
  tenant_id text NOT NULL, turn_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'pending', dispatch_attempts integer NOT NULL DEFAULT 0,
  next_retry_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, turn_id),
  FOREIGN KEY (tenant_id, turn_id) REFERENCES teamchat.ai_jobs(tenant_id, turn_id)
);
CREATE TABLE IF NOT EXISTS teamchat.tool_calls (
  tenant_id text NOT NULL, turn_id uuid NOT NULL, operation_id text NOT NULL,
  name text NOT NULL, arguments jsonb NOT NULL, result jsonb,
  status text NOT NULL CHECK (status IN ('planned','running','completed','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, turn_id, operation_id),
  FOREIGN KEY (tenant_id, turn_id) REFERENCES teamchat.ai_jobs(tenant_id, turn_id)
);
CREATE TABLE IF NOT EXISTS teamchat.answer_blocks (
  tenant_id text NOT NULL, turn_id uuid NOT NULL, block_index integer NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  verified_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, turn_id, block_index),
  FOREIGN KEY (tenant_id, turn_id) REFERENCES teamchat.ai_jobs(tenant_id, turn_id)
);
CREATE TABLE IF NOT EXISTS teamchat.presence_leases (
  tenant_id text NOT NULL, room_id text NOT NULL, firebase_uid text NOT NULL,
  connection_id uuid NOT NULL, expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, room_id, connection_id),
  FOREIGN KEY (tenant_id, room_id, firebase_uid)
    REFERENCES teamchat.room_memberships(tenant_id, room_id, firebase_uid)
);
CREATE TABLE IF NOT EXISTS teamchat.dataset_versions (
  tenant_id text NOT NULL REFERENCES teamchat.tenants(tenant_id),
  filename text NOT NULL, sha256 text NOT NULL,
  loaded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, filename)
);

-- Fail closed for every tenant-owned table, even when context is absent.
DO $policy$
DECLARE t record;
BEGIN
 FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='teamchat' LOOP
   EXECUTE format('ALTER TABLE teamchat.%I ENABLE ROW LEVEL SECURITY', t.tablename);
   EXECUTE format('ALTER TABLE teamchat.%I FORCE ROW LEVEL SECURITY', t.tablename);
   IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='teamchat' AND tablename=t.tablename AND policyname='tenant_guard') THEN
     EXECUTE format('CREATE POLICY tenant_guard ON teamchat.%I USING (tenant_id = nullif(current_setting(''app.tenant_id'',true),'''')) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'',true),''''))',t.tablename);
   END IF;
 END LOOP;
END
$policy$;

CREATE INDEX IF NOT EXISTS messages_room_idx ON teamchat.messages(tenant_id,room_id,created_at);
CREATE INDEX IF NOT EXISTS events_replay_idx ON teamchat.room_events(tenant_id,room_id,sequence);
CREATE INDEX IF NOT EXISTS memories_lookup_idx ON teamchat.memories(tenant_id,key);
CREATE INDEX IF NOT EXISTS gaps_lookup_idx ON teamchat.store_gaps(tenant_id,store_id);
-- Privileged migration role owns these tables; runtime is granted only application CRUD privileges.
-- Bootstrap membership must be resolved via a restricted verified-Firebase-UID endpoint before SET LOCAL app.tenant_id.
-- Separate IAM/service account and connection pool configuration are required for real deployment.
COMMIT;
