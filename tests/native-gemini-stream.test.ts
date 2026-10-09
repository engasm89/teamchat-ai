import test from "node:test";
import assert from "node:assert/strict";
import {collectGeminiFunctionCalls} from "../src/worker/gemini.ts";

async function* nativeChunks(){
 yield {candidates:[{content:{parts:[{text:"unchecked claim about retail sales"}]}}]};
 yield {functionCalls:[{id:"call-1",name:"search_catalog",args:{query:"AC"}}]};
 yield {functionCalls:[{id:"call-1",name:"search_catalog",args:{query:"AC"}}]};
 yield {functionCalls:[{id:"call-2",name:"search_memory",args:{query:"q1 target"}}]};
}
test("streaming Gemini planner buffers untrusted text and extracts complete native tool calls",async()=>{
 const result=await collectGeminiFunctionCalls(nativeChunks());
 assert.deepEqual(result.functionCalls?.map(c=>c.id),["call-1","call-2"]);
 const parts=result.candidates?.[0]?.content?.parts??[];
 assert.equal(parts.length,2);
 assert.equal(JSON.stringify(parts).includes("unchecked claim"),false);
});
test("streaming incomplete or conflicting calls fail before a tool can execute",async()=>{
 async function* partial(){yield {functionCalls:[{name:"search_catalog",partialArgs:[{jsonPath:"$.query",value:"A"}],willContinue:true,args:{query:"A"}}]};}
 await assert.rejects(collectGeminiFunctionCalls(partial() as any),/Incomplete/);
 async function* conflict(){yield {functionCalls:[{id:"same",name:"search_catalog",args:{query:"A"}}]};yield {functionCalls:[{id:"same",name:"search_catalog",args:{query:"B"}}]};}
 await assert.rejects(collectGeminiFunctionCalls(conflict()),/Conflicting/);
});
test("cancelled native stream never produces executable operations",async()=>{
 const controller=new AbortController();controller.abort();
 async function* stream(){yield {functionCalls:[{name:"search_catalog",args:{query:"AC"}}]};}
 await assert.rejects(collectGeminiFunctionCalls(stream(),controller.signal),/cancelled/);
});
