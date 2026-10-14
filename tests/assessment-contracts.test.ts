import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
const webSources=readdirSync("apps/web/src").filter(name=>/\.(tsx?|jsx?)$/.test(name))
 .map(name=>readFileSync(`apps/web/src/${name}`,"utf8")).join("\n");
const worker=readFileSync("src/worker/gemini.ts","utf8");
test("browser uses Firebase only for authentication and does not poll or use managed realtime",()=>{
 assert.doesNotMatch(webSources,/\bonSnapshot\s*\(|\bonValue\s*\(|\bEventSource\s*\(|\brealtimeDatabase\b|supabase|pusher|ably|pubnub|firestore\//i);
 assert.doesNotMatch(webSources,/\bsetInterval\s*\(/);
 assert.match(webSources,/new WebSocket\(/);
});
test("Gemini owns tool selection and the server never broadcasts raw candidate text",()=>{
 assert.match(worker,/functionDeclarations:TOOL_DECLARATIONS/);
 // AUTO on every round: forcing ANY made Gemini call a tool for "hi" and
 // threw away its reply (reviewer session, 14 Oct 2026).
 assert.match(worker,/functionCallingConfig:\{mode:"AUTO"\}/);
 assert.doesNotMatch(worker,/"ANY"/);
 assert.doesNotMatch(worker,/persistAnswer\([^;]*response\.text/);
 assert.doesNotMatch(worker,/persistSegment\([^;]*response\.text/);
 assert.match(worker,/verifiedToolBlock\(/);
 assert.match(worker,/checkSay\(/);
 assert.match(worker,/checkSegment\(/);
});
test("the repeatable live history bootstrap uses a real Gemini call and verifies persisted fetch",()=>{
 const script=readFileSync("scripts/bootstrap-live-demo-history.ts","utf8");
 assert.match(script,/createGeminiProvider\(/);
 assert.match(script,/executeAiJob\(/);
 assert.match(script,/replayRoom\(/);
 assert.match(script,/ai_tool/);
});
