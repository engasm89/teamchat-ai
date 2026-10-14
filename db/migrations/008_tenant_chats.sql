-- Run as the migration owner through scripts/db/migrate.ts, which records this
-- file's hash. Additive only: the previous application revision keeps working
-- (it never reads the new columns and never inserts rooms or memberships).
BEGIN;

CREATE TABLE IF NOT EXISTS teamchat.schema_migrations (
  version text PRIMARY KEY,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON teamchat.schema_migrations FROM PUBLIC;

ALTER TABLE teamchat.rooms ADD COLUMN IF NOT EXISTS ai_chat boolean NOT NULL DEFAULT false;
ALTER TABLE teamchat.rooms ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'members';
ALTER TABLE teamchat.rooms ADD COLUMN IF NOT EXISTS created_by text;
ALTER TABLE teamchat.rooms ADD COLUMN IF NOT EXISTS client_request_id uuid;
ALTER TABLE teamchat.rooms ADD COLUMN IF NOT EXISTS created_at timestamptz;
ALTER TABLE teamchat.rooms DROP CONSTRAINT IF EXISTS rooms_visibility_check;
ALTER TABLE teamchat.rooms ADD CONSTRAINT rooms_visibility_check CHECK (visibility IN ('members','tenant'));
ALTER TABLE teamchat.rooms DROP CONSTRAINT IF EXISTS rooms_creator_fk;
ALTER TABLE teamchat.rooms ADD CONSTRAINT rooms_creator_fk
  FOREIGN KEY (tenant_id, created_by) REFERENCES teamchat.user_memberships(tenant_id, firebase_uid);
ALTER TABLE teamchat.rooms DROP CONSTRAINT IF EXISTS rooms_client_request_unique;
ALTER TABLE teamchat.rooms ADD CONSTRAINT rooms_client_request_unique UNIQUE (tenant_id, created_by, client_request_id);
ALTER TABLE teamchat.rooms DROP CONSTRAINT IF EXISTS rooms_tenant_chat_shape;
ALTER TABLE teamchat.rooms ADD CONSTRAINT rooms_tenant_chat_shape CHECK (
  visibility = 'members' OR (created_by IS NOT NULL AND client_request_id IS NOT NULL AND created_at IS NOT NULL));

-- Least privilege inside a tenant. tenant_guard (permissive) already confines
-- every row to app.tenant_id. These RESTRICTIVE policies additionally bind any
-- role other than the table owner (that is, the application runtime role):
--  * a room it inserts must be a tenant-wide chat created now by app.uid, an
--    active member of the tenant;
--  * a membership it inserts must be for an active member of the tenant, into
--    a tenant-wide room that this same transaction created.
-- The runtime role has no UPDATE on these columns and no UPDATE or DELETE on
-- room_memberships, so it cannot add members to existing rooms or rewrite who
-- created a room. The table owner (migrations, user provisioning and the
-- enrolment trigger below) is not bound by them.
CREATE OR REPLACE FUNCTION teamchat.is_table_owner(p_table regclass) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog AS $fn$
  SELECT pg_has_role(current_user, (SELECT relowner FROM pg_class WHERE oid = p_table), 'USAGE')
$fn$;

DROP POLICY IF EXISTS rooms_runtime_insert ON teamchat.rooms;
CREATE POLICY rooms_runtime_insert ON teamchat.rooms AS RESTRICTIVE FOR INSERT
  WITH CHECK (
    teamchat.is_table_owner('teamchat.rooms')
    OR (visibility = 'tenant'
        AND created_by = nullif(current_setting('app.uid', true), '')
        AND created_at = now()
        AND EXISTS (SELECT 1 FROM teamchat.user_memberships u
                    WHERE u.tenant_id = rooms.tenant_id AND u.firebase_uid = rooms.created_by AND u.active)));

DROP POLICY IF EXISTS room_memberships_runtime_insert ON teamchat.room_memberships;
CREATE POLICY room_memberships_runtime_insert ON teamchat.room_memberships AS RESTRICTIVE FOR INSERT
  WITH CHECK (
    teamchat.is_table_owner('teamchat.room_memberships')
    OR (EXISTS (SELECT 1 FROM teamchat.rooms r
                WHERE r.tenant_id = room_memberships.tenant_id AND r.room_id = room_memberships.room_id
                  AND r.visibility = 'tenant' AND r.created_at = now()
                  AND r.created_by = nullif(current_setting('app.uid', true), ''))
        AND EXISTS (SELECT 1 FROM teamchat.user_memberships u
                    WHERE u.tenant_id = room_memberships.tenant_id AND u.firebase_uid = room_memberships.firebase_uid AND u.active)));

-- One lock per tenant serialises tenant-chat creation with member enrolment, so a
-- member added (or reactivated) while a chat is being created still joins it.
CREATE OR REPLACE FUNCTION teamchat.tenant_rooms_lock_key(p_tenant text) RETURNS bigint
LANGUAGE sql IMMUTABLE SECURITY INVOKER AS $fn$ SELECT hashtextextended('teamchat-tenant-rooms:' || p_tenant, 0) $fn$;

CREATE OR REPLACE FUNCTION teamchat.enrol_member_in_tenant_chats() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, teamchat AS $fn$
BEGIN
  IF NEW.active AND (TG_OP = 'INSERT' OR OLD.active IS DISTINCT FROM NEW.active) THEN
    PERFORM pg_advisory_xact_lock(teamchat.tenant_rooms_lock_key(NEW.tenant_id));
    INSERT INTO teamchat.room_memberships(tenant_id, room_id, firebase_uid)
      SELECT r.tenant_id, r.room_id, NEW.firebase_uid FROM teamchat.rooms r
       WHERE r.tenant_id = NEW.tenant_id AND r.visibility = 'tenant'
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS enrol_member_in_tenant_chats ON teamchat.user_memberships;
CREATE TRIGGER enrol_member_in_tenant_chats AFTER INSERT OR UPDATE OF active ON teamchat.user_memberships
  FOR EACH ROW EXECUTE FUNCTION teamchat.enrol_member_in_tenant_chats();

-- Room-list changes wake connected clients of that tenant. The payload names
-- only the tenant; clients refetch their own list through the authenticated API.
CREATE OR REPLACE FUNCTION teamchat.publish_rooms_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER AS $fn$
BEGIN
  PERFORM pg_notify('teamchat_rooms', json_build_object('tenant', NEW.tenant_id)::text);
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS rooms_changed ON teamchat.rooms;
CREATE TRIGGER rooms_changed AFTER INSERT ON teamchat.rooms
  FOR EACH ROW EXECUTE FUNCTION teamchat.publish_rooms_changed();
DROP TRIGGER IF EXISTS room_memberships_changed ON teamchat.room_memberships;
CREATE TRIGGER room_memberships_changed AFTER INSERT ON teamchat.room_memberships
  FOR EACH ROW EXECUTE FUNCTION teamchat.publish_rooms_changed();

COMMIT;
