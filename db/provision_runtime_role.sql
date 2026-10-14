-- Execute separately as DBA AFTER migrations 001 through 007: the grants
-- below reference tables created by 006_ephemeral.sql.
-- FIRST: CREATE ROLE teamchat_api LOGIN PASSWORD '<use secret manager>'; never commit passwords.
-- Use a dedicated runtime role. Fail if the role is missing / has BYPASSRLS.
DO $guard$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='teamchat_api' AND rolcanlogin AND NOT rolbypassrls AND NOT rolsuper) THEN
   RAISE EXCEPTION 'Require a LOGIN non-superuser non-BYPASSRLS role named teamchat_api';
 END IF;
END $guard$;
GRANT USAGE ON SCHEMA teamchat TO teamchat_api;
GRANT SELECT ON teamchat.tenants,teamchat.user_memberships,teamchat.rooms,teamchat.room_memberships,
 teamchat.catalog,teamchat.margin_classes,teamchat.supersession_edges,
 teamchat.segment_coefficients,teamchat.stores,teamchat.store_carried_codes,teamchat.store_gaps,
 teamchat.memories,teamchat.memory_versions,teamchat.messages,teamchat.room_events,
 teamchat.ai_jobs,teamchat.task_outbox,teamchat.tool_calls,teamchat.answer_blocks,
 teamchat.presence_leases,teamchat.dataset_versions TO teamchat_api;
GRANT INSERT,UPDATE ON teamchat.messages,teamchat.room_events,teamchat.rooms,
 teamchat.ai_jobs,teamchat.task_outbox,teamchat.tool_calls,teamchat.answer_blocks,
 teamchat.memories,teamchat.memory_versions,teamchat.presence_leases TO teamchat_api;
-- Reclaimed AI turns discard superseded verified blocks before emitting the
-- durable reset event. This DELETE is invoked by claimJob() through the normal
-- (nonowner, RLS-restricted) teamchat_api login; omitting it breaks retry recovery.
GRANT DELETE ON teamchat.answer_blocks,teamchat.presence_leases TO teamchat_api;
REVOKE ALL ON teamchat.auth_directory FROM teamchat_api;
GRANT EXECUTE ON FUNCTION teamchat.resolve_tenant_for_uid(text) TO teamchat_api;
REVOKE ALL ON teamchat.ai_job_directory FROM teamchat_api;
GRANT EXECUTE ON FUNCTION teamchat.resolve_tenant_for_turn(uuid) TO teamchat_api;
GRANT SELECT,INSERT,UPDATE,DELETE ON teamchat.typing_leases TO teamchat_api;
GRANT EXECUTE ON FUNCTION teamchat.create_room_for_current_user(text,text,text,text) TO teamchat_api;
