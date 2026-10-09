BEGIN;
-- Internal routing directory stores only opaque job ownership, not business data.
CREATE TABLE IF NOT EXISTS teamchat.ai_job_directory(
 turn_id uuid PRIMARY KEY,tenant_id text NOT NULL REFERENCES teamchat.tenants(tenant_id)
);
REVOKE ALL ON teamchat.ai_job_directory FROM PUBLIC;
CREATE OR REPLACE FUNCTION teamchat.register_job_directory() RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path=pg_catalog,teamchat AS $body$
BEGIN
 INSERT INTO teamchat.ai_job_directory(turn_id,tenant_id) VALUES(NEW.turn_id,NEW.tenant_id);
 RETURN NEW;
END $body$;
DROP TRIGGER IF EXISTS ai_job_directory_insert ON teamchat.ai_jobs;
CREATE TRIGGER ai_job_directory_insert AFTER INSERT ON teamchat.ai_jobs
FOR EACH ROW EXECUTE FUNCTION teamchat.register_job_directory();
CREATE OR REPLACE FUNCTION teamchat.resolve_tenant_for_turn(p_turn uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,teamchat AS $fn$
 SELECT tenant_id FROM teamchat.ai_job_directory WHERE turn_id=p_turn
$fn$;
REVOKE ALL ON FUNCTION teamchat.resolve_tenant_for_turn(uuid) FROM PUBLIC;
COMMIT;
