BEGIN;
CREATE TABLE IF NOT EXISTS teamchat.typing_leases (
 tenant_id text NOT NULL,room_id text NOT NULL,firebase_uid text NOT NULL,
 connection_id uuid NOT NULL,expires_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,room_id,connection_id),
 FOREIGN KEY(tenant_id,room_id,firebase_uid)
  REFERENCES teamchat.room_memberships(tenant_id,room_id,firebase_uid)
);
ALTER TABLE teamchat.typing_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE teamchat.typing_leases FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_guard ON teamchat.typing_leases;
CREATE POLICY tenant_guard ON teamchat.typing_leases
 USING (tenant_id=nullif(current_setting('app.tenant_id',true),''))
 WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),''));
CREATE OR REPLACE FUNCTION teamchat.publish_ephemeral_wakeup() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER AS $fn$
DECLARE room_token uuid; t_id text; r_id text;
BEGIN
 t_id:=COALESCE(NEW.tenant_id,OLD.tenant_id);r_id:=COALESCE(NEW.room_id,OLD.room_id);
 SELECT notify_token INTO room_token FROM teamchat.rooms WHERE tenant_id=t_id AND room_id=r_id;
 IF room_token IS NOT NULL THEN
  PERFORM pg_notify('teamchat_'||TG_ARGV[0],json_build_object('opaque_room',room_token)::text);
 END IF;
 RETURN COALESCE(NEW,OLD);
END;
$fn$;
DROP TRIGGER IF EXISTS presence_changed ON teamchat.presence_leases;
CREATE TRIGGER presence_changed AFTER INSERT OR UPDATE OR DELETE ON teamchat.presence_leases
 FOR EACH ROW EXECUTE FUNCTION teamchat.publish_ephemeral_wakeup('presence');
DROP TRIGGER IF EXISTS typing_changed ON teamchat.typing_leases;
CREATE TRIGGER typing_changed AFTER INSERT OR UPDATE OR DELETE ON teamchat.typing_leases
 FOR EACH ROW EXECUTE FUNCTION teamchat.publish_ephemeral_wakeup('typing');
COMMIT;
