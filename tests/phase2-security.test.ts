import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const migration=readFileSync("db/migrations/003_auth_grants.sql","utf8");
const job=readFileSync("db/migrations/005_job_lookup.sql","utf8");
const grants=readFileSync("db/provision_runtime_role.sql","utf8");
const ai=readFileSync("src/worker/gemini.ts","utf8");
const socket=readFileSync("src/server/http-socket.ts","utf8");
test("auth directory cannot be SELECTed directly by runtime role",()=>{
 assert.match(migration,/REVOKE ALL ON teamchat.auth_directory FROM PUBLIC/);
 assert.match(grants,/REVOKE ALL ON teamchat.auth_directory FROM teamchat_api/);
 assert.match(grants,/rolbypassrls/);
 assert.match(migration,/SECURITY DEFINER/);
});
test("job directory is private and contains no model inputs or business text",()=>{
 assert.match(job,/REVOKE ALL ON teamchat.ai_job_directory FROM PUBLIC/);
 assert.doesNotMatch(job,/body text|payload jsonb|arguments jsonb/);
});
test("native Gemini function declarations and tool executor not keyword router",()=>{
 assert.match(ai,/response.functionCalls/);
 assert.match(ai,/TOOL_DECLARATIONS/);
 assert.match(ai,/new SqlToolExecutor\(pool,embeddings\)/);
 assert.doesNotMatch(ai,/if.*includes\("AC"\)/);
});
test("websocket origin, payload and idle safeguards installed",()=>{
 assert.match(socket,/maxPayload:16_384/);
 assert.match(socket,/req.headers.origin/);
 assert.match(socket,/setInterval/);
 assert.match(socket,/hub.notify/);
 assert.doesNotMatch(socket,/setInterval.*fetch/);
});
