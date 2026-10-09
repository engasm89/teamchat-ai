-- Execute as the migration owner. Application role must be created separately
-- by the database administrator as a NONOWNER, NOBYPASSRLS login.
BEGIN;
-- Auth directory intentionally has no tenant-scoped RLS: only a SECURITY DEFINER
-- function can read it. An arbitrary requested tenant is never accepted.
CREATE TABLE IF NOT EXISTS teamchat.auth_directory (
  firebase_uid text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES teamchat.tenants(tenant_id)
);
REVOKE ALL ON teamchat.auth_directory FROM PUBLIC;
CREATE OR REPLACE FUNCTION teamchat.resolve_tenant_for_uid(p_uid text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, teamchat AS $fn$
  SELECT d.tenant_id FROM teamchat.auth_directory d WHERE d.firebase_uid=p_uid
$fn$;
REVOKE ALL ON FUNCTION teamchat.resolve_tenant_for_uid(text) FROM PUBLIC;
-- Grants are applied by db/provision_runtime_role.sql after creating teamchat_api.
COMMIT;
