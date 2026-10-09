-- Execute as migration owner after 001_schema.sql.
BEGIN;
CREATE OR REPLACE FUNCTION teamchat.publish_event_wakeup() RETURNS trigger AS $function$
BEGIN
  -- Trusted API listeners only; never include message text or sensitive business values.
  PERFORM pg_notify('teamchat_events', json_build_object(
    'opaque_room',(SELECT r.notify_token FROM teamchat.rooms r WHERE r.tenant_id=NEW.tenant_id AND r.room_id=NEW.room_id),
    'highwater',NEW.sequence)::text);
  RETURN NEW;
END;
$function$ LANGUAGE plpgsql SECURITY INVOKER;
DROP TRIGGER IF EXISTS room_event_wakeup ON teamchat.room_events;
CREATE TRIGGER room_event_wakeup AFTER INSERT ON teamchat.room_events
 FOR EACH ROW EXECUTE FUNCTION teamchat.publish_event_wakeup();
COMMIT;
