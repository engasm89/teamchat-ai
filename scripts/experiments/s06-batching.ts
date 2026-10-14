/** Experiment: after get_store_assortment, does Gemini go on to price "closing the gaps" with
 * calculate_uplift, or announce the calculation and stop? Replays round 2 of a recorded live S06 turn
 * with the history the worker itself loads (same query, up to 120 events including earlier AI answers,
 * real display names; NAIVE=1 uses the older 15-message approximation, which under-reproduced the
 * failure), the recorded tool result and the worker's planner config. Read-only.
 * Env: TRIALS, TEMPERATURE, THINKING, EXTRA_INSTRUCTION (appended for the "clarified" variant), and
 * CONTINUATION (a server note sent after a reply that skipped calculate_uplift, recording what follows).
 *   node --experimental-strip-types scripts/experiments/s06-batching.ts <s06 evidence json> <requester uid> [description] [add_codes description] */
import fs from "node:fs";
import {GoogleGenAI} from "@google/genai";
import {TOOL_DECLARATIONS} from "../../src/tools.ts";
import {trustedPlannerInstructions,buildConversationContents} from "../../src/worker/gemini.ts";
import {openDb,authoritativeEvents} from "../acceptance/common.ts";
import * as oracle from "../acceptance/oracle.ts";

const [evidencePath,uid,description,addCodesDescription]=process.argv.slice(2) as [string,string,string?,string?];
const project="focus-clean-4b9f4",location="us-central1",model="gemini-2.5-flash",TRIALS=Number(process.env.TRIALS??8);
const EXTRA=process.env.EXTRA_INSTRUCTION??"";
const turn=JSON.parse(fs.readFileSync(evidencePath,"utf8"));
const lookup=turn.toolTrace.find((t:any)=>t.name==="get_store_assortment");
const gaps=oracle.store("northside-outfitters","ST-4007")!.suspected_gaps.map(g=>g.catalog_code).sort();

import {resolveVerifiedIdentity} from "../../src/server/database.ts";
import {inTenantTransaction} from "../../src/persistence/postgres.ts";
const pool=await openDb();
let history:any[],names:Map<string,string>;
try{
 const ctx=await resolveVerifiedIdentity(pool as any,uid);
 ({history,names}=await inTenantTransaction(pool as any,ctx,async (c:any)=>{
  const q=await c.query("SELECT type,payload,sequence::text,turn_id::text FROM teamchat.room_events WHERE tenant_id=$1 AND room_id=$2 AND sequence<=$3 AND type IN ('message','ai_answer_block','ai_answer_segment','ai_answer_reset') ORDER BY room_events.sequence DESC LIMIT 120",[ctx.tenantId,turn.room,turn.messageSequence]);
  const m=await c.query("SELECT firebase_uid,display_name FROM teamchat.user_memberships WHERE tenant_id=$1",[ctx.tenantId]);
  return {history:q.rows.reverse(),names:new Map(m.rows.map((r:any)=>[r.firebase_uid,r.display_name]))};
 }));
}finally{await pool.end();}
const conversation=process.env.NAIVE?buildConversationContents(history.filter((e:any)=>e.type==="message"||e.type==="ai_answer_block").slice(-15),new Map(),{uid,cutoff:turn.messageSequence}):buildConversationContents(history,names,{uid,cutoff:turn.messageSequence});
console.error("model turns in history:",conversation.contents.filter((c:any)=>c.role==="model").length,"entries:",conversation.contents.length);
const contents=[
 ...conversation.contents,
 {role:"model",parts:[{functionCall:{name:"get_store_assortment",args:lookup.arguments}}]},
 {role:"user",parts:[{functionResponse:{name:"get_store_assortment",response:{data:lookup.result}}}]},
];
const production=TOOL_DECLARATIONS.find(t=>t.name==="calculate_uplift")!;
const clarified={...production,description:description??production.description,parameters:{...production.parameters,properties:{...production.parameters.properties,
 add_codes:{...production.parameters.properties.add_codes,...(addCodesDescription?{description:addCodesDescription}:{})}}}};
const variants={"production":production,...(description||addCodesDescription?{"clarified":clarified}:{})};
const client=new GoogleGenAI({vertexai:true,project,location});
const results:Array<Record<string,unknown>>=[];
for(const [variant,decl] of Object.entries(variants))for(let trial=1;trial<=TRIALS;trial++){
 const tools=[{functionDeclarations:TOOL_DECLARATIONS.map(t=>t.name==="calculate_uplift"?decl:t) as any}];
 try{
  const stream=await client.models.generateContentStream({model,contents:contents as any,config:{temperature:Number(process.env.TEMPERATURE??0.2),tools,maxOutputTokens:2048,thinkingConfig:{thinkingBudget:Number(process.env.THINKING??512)},
   systemInstruction:trustedPlannerInstructions({roomId:turn.room,memoryConsent:false})+(variant==="clarified"&&EXTRA?` ${EXTRA}`:""),toolConfig:{functionCallingConfig:{mode:"AUTO" as any}}}});
  const calls:Array<{name?:string;args?:Record<string,unknown>}>=[];
  let text="";for await(const chunk of stream){calls.push(...(chunk.functionCalls??[]));text+=chunk.text??"";}
  const calcs=calls.filter(c=>c.name==="calculate_uplift");
  const allInOne=calcs.length===1&&JSON.stringify([...(calcs[0]!.args?.add_codes as string[]??[])].sort())===JSON.stringify(gaps);
  let continuation:unknown=null;
  if(process.env.CONTINUATION&&!calcs.length){
   const more=[...contents,{role:"model",parts:[{text}]},{role:"user",parts:[{text:process.env.CONTINUATION}]}];
   const s2=await client.models.generateContentStream({model,contents:more as any,config:{temperature:Number(process.env.TEMPERATURE??0.2),tools,maxOutputTokens:2048,thinkingConfig:{thinkingBudget:512},
    systemInstruction:trustedPlannerInstructions({roomId:turn.room,memoryConsent:false})+(variant==="clarified"&&EXTRA?` ${EXTRA}`:""),toolConfig:{functionCallingConfig:{mode:"AUTO" as any}}}});
   const c2:Array<{name?:string;args?:Record<string,unknown>}>=[];let t2="";for await(const ch of s2){c2.push(...(ch.functionCalls??[]));t2+=ch.text??"";}
   const k2=c2.filter(c=>c.name==="calculate_uplift");
   continuation={calls:c2.map(c=>({name:c.name,args:c.args})),text:t2.slice(0,400),allGapsInOneCall:k2.length===1&&JSON.stringify([...(k2[0]!.args?.add_codes as string[]??[])].sort())===JSON.stringify(gaps)};
  }
  results.push({variant,trial,allGapsInOneCall:allInOne,calls:calls.map(c=>({name:c.name,args:c.args})),text,continuation});
 }catch(error){results.push({variant,trial,error:String(error).slice(0,300)});}
}
const summary=Object.fromEntries(Object.keys(variants).map(v=>{const r=results.filter(x=>x.variant===v);
 return [v,`${r.filter(x=>x.allGapsInOneCall).length}/${r.length} priced every gap in one call; ${r.filter(x=>(x.calls as Array<{name?:string}>|undefined)?.some(c=>c.name==="calculate_uplift")).length}/${r.length} called calculate_uplift`];}));
console.log(JSON.stringify({ranAt:new Date().toISOString(),model,location,replayedTurn:turn.turnId,gaps,
 config:"round 2 replay; streaming, temperature 0.2, thinkingBudget 512, mode AUTO, maxOutputTokens 2048 (the worker's planner config), consent DENIED; history = the worker's own query (NAIVE=1: 15 messages)",
 clarified:variants.clarified?{description,addCodesDescription,extraInstruction:EXTRA}:null,summary,results},null,1));
