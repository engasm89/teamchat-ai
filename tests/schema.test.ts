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
