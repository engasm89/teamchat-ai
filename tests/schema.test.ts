import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const migration=readFileSync("db/migrations/001_schema.sql","utf8");
const notify=readFileSync("db/migrations/002_notifications.sql","utf8");
const seed=readFileSync("db/generated/seed.sql","utf8");
test("migration defines transaction-local fail-closed forced RLS on all tenant tables",()=>{
 assert.match(migration,/FORCE ROW LEVEL SECURITY/);
 assert.match(migration,/current_setting\(''app.tenant_id'',true\)/);
 assert.match(migration,/WITH CHECK \(tenant_id/);
 assert.match(migration,/FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='teamchat' LOOP/);
});
test("room notification is opaque and has no business text",()=>{
 assert.match(notify,/opaque_room/);assert.doesNotMatch(notify,/json_build_object\('tenant'/);
 assert.doesNotMatch(notify,/NEW\.payload/);
});
test("SQL seed has both isolated tenant partitions and no raw secret env",()=>{
 assert.match(seed,/northside-outfitters/);assert.match(seed,/valley-home-goods/);
 assert.ok(seed.split("INSERT INTO teamchat.catalog").length-1===2000);
 assert.ok(seed.split("INSERT INTO teamchat.stores").length-1===24);
 assert.ok(seed.split("INSERT INTO teamchat.memories").length-1===8);
 assert.doesNotMatch(seed,/sk-proj-|BEGIN PRIVATE KEY/);
});


test("restricted runtime role supports AI reclaim without expanding tenant powers",()=>{
 const grants=readFileSync("db/provision_runtime_role.sql","utf8");
 // The production retry path deletes answer_blocks after lease reclamation.
 const retry=readFileSync("src/server/ai-jobs.ts","utf8");
 assert.match(retry,/DELETE FROM teamchat\.answer_blocks/);
 assert.match(grants,/GRANT DELETE ON teamchat\.answer_blocks,teamchat\.presence_leases TO teamchat_api/);
 // No application INSERT/DELETE on the privileged auth/job directories.
 assert.match(grants,/REVOKE ALL ON teamchat\.auth_directory FROM teamchat_api/);
 assert.match(grants,/REVOKE ALL ON teamchat\.ai_job_directory FROM teamchat_api/);
 const liveTest=readFileSync("scripts/integration/live-postgres.test.ts","utf8");
 assert.match(liveTest,/DELETE FROM teamchat\.answer_blocks WHERE tenant_id=\$1/);
});
