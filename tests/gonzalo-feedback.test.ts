import test from "node:test";
import assert from "node:assert/strict";
import {collectGeminiFunctionCalls,trustedPlannerInstructions} from "../src/worker/gemini.ts";
import {normalizeRoomTitle} from "../src/server/http-socket.ts";
import {renderVerifiedBlock} from "../apps/web/src/verified.ts";

async function* stream(...responses:any[]){for(const response of responses)yield response;}

test("natural assistant text survives streaming without a forced tool call",async()=>{
 const response=await collectGeminiFunctionCalls(stream(
  {candidates:[{content:{role:"model",parts:[{text:"Hi — "}]}}]},
  {candidates:[{content:{role:"model",parts:[{text:"how can I help?"}]}}]}
 ));
 assert.deepEqual(response.functionCalls,[]);
 assert.equal((response.candidates?.[0]?.content?.parts?.[0] as any).text,"Hi — how can I help?");
 assert.match(trustedPlannerInstructions({roomId:"general",memoryConsent:false}),/Respond naturally/);
});

test("assistant conversation block renders only with its explicit source",()=>{
 assert.equal(renderVerifiedBlock({template:"assistant_text",source:"model_conversation",values:{message:"Hello"}}),"Hello");
 assert.notEqual(renderVerifiedBlock({template:"assistant_text",values:{message:"unsafe"}}),"unsafe");
});

test("room names are normalized and bounded",()=>{
 assert.equal(normalizeRoomTitle("  Buyer   planning  "),"Buyer planning");
 assert.equal(normalizeRoomTitle("x"),null);
 assert.equal(normalizeRoomTitle("x".repeat(81)),null);
});
