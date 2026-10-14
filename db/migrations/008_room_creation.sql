-- Tenant-scoped chat creation. Execute as migration owner.
BEGIN;

CREATE OR REPLACE FUNCTION teamchat.create_room_for_current_user(
 p_tenant text,
 p_uid text,
 p_room_id text,
 p_title text
)
RETURNS TABLE(room_id text,title text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, teamchat
AS $fn$
BEGIN
 IF current_setting('app.tenant_id', true) IS DISTINCT FROM p_tenant THEN
  RAISE EXCEPTION 'Tenant context mismatch';
 END IF;
 IF p_room_id !~ '^[a-z0-9][a-z0-9-]{1,127}$' OR length(trim(p_title)) NOT BETWEEN 2 AND 80 THEN
  RAISE EXCEPTION 'Invalid room';
 END IF;
 IF NOT EXISTS (
  SELECT 1 FROM teamchat.user_memberships m
  WHERE m.tenant_id=p_tenant AND m.firebase_uid=p_uid AND m.active=true
 ) THEN
  RAISE EXCEPTION 'Inactive membership';
 END IF;

 INSERT INTO teamchat.rooms(tenant_id,room_id,title)
 VALUES(p_tenant,p_room_id,trim(p_title));
 INSERT INTO teamchat.room_memberships(tenant_id,room_id,firebase_uid)
 VALUES(p_tenant,p_room_id,p_uid);

 RETURN QUERY SELECT p_room_id,trim(p_title);
END
$fn$;

REVOKE ALL ON FUNCTION teamchat.create_room_for_current_user(text,text,text,text) FROM PUBLIC;
COMMIT;
