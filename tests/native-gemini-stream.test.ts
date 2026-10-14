import test from "node:test";
import assert from "node:assert/strict";
import {collectGeminiResponse} from "../src/worker/gemini.ts";

async function* nativeChunks(){
 yield {candidates:[{content:{parts:[{text:"unchecked claim about retail sales"}]}}]};
 yield {functionCalls:[{id:"call-1",name:"search_catalog",args:{query:"AC"}}]};
 yield {functionCalls:[{id:"call-1",name:"search_catalog",args:{query:"AC"}}]};
 yield {functionCalls:[{id:"call-2",name:"search_memory",args:{query:"q1 target"}}]};
}
test("streaming Gemini round keeps the model's text as an unverified draft and extracts complete native tool calls",async()=>{
 const result=await collectGeminiResponse(nativeChunks());
 assert.deepEqual(result.functionCalls.map(c=>c.id),["call-1","call-2"]);
 // The text is returned separately as a draft for the answer contract; it is
 // never part of a function call and is never broadcast by this function.
 assert.equal(result.text,"unchecked claim about retail sales");
 assert.equal(JSON.stringify(result.functionCalls).includes("unchecked claim"),false);
});
test("a plain reply with no tool calls is returned as text, not discarded",async()=>{
 async function* reply(){
  yield {candidates:[{content:{parts:[{text:"Hi Maya! "}]}}]};
  yield {candidates:[{content:{parts:[{text:"Thinking about it",thought:true}]}}]};
  yield {candidates:[{content:{parts:[{text:"How can I help?",thoughtSignature:"sig-1"}]}}]};
 }
 const result=await collectGeminiResponse(reply());
 assert.equal(result.text,"Hi Maya! How can I help?");
 assert.deepEqual(result.functionCalls,[]);
 assert.deepEqual(result.content,{role:"model",parts:[{text:"Hi Maya! How can I help?",thoughtSignature:"sig-1"}]});
});
test("thought signatures stay attached to the calls sent back to Gemini",async()=>{
 async function* signed(){yield {candidates:[{content:{parts:[{functionCall:{id:"c1",name:"search_catalog",args:{query:"AC"}},thoughtSignature:"sig-2"}]}}]};}
 const result=await collectGeminiResponse(signed());
 assert.deepEqual(result.content.parts,[{functionCall:{name:"search_catalog",args:{query:"AC"},id:"c1"},thoughtSignature:"sig-2"}]);
});
test("streaming incomplete or conflicting calls fail before a tool can execute",async()=>{
 async function* partial(){yield {functionCalls:[{name:"search_catalog",partialArgs:[{jsonPath:"$.query",value:"A"}],willContinue:true,args:{query:"A"}}]};}
 await assert.rejects(collectGeminiResponse(partial() as any),/Incomplete/);
 async function* conflict(){yield {functionCalls:[{id:"same",name:"search_catalog",args:{query:"A"}}]};yield {functionCalls:[{id:"same",name:"search_catalog",args:{query:"B"}}]};}
 await assert.rejects(collectGeminiResponse(conflict()),/Conflicting/);
});
test("cancelled native stream never produces executable operations",async()=>{
 const controller=new AbortController();controller.abort();
 async function* stream(){yield {functionCalls:[{name:"search_catalog",args:{query:"AC"}}]};}
 await assert.rejects(collectGeminiResponse(stream(),controller.signal),/cancelled/);
});
