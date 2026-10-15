/** Experiment: the completeness review with the worker's own provider (Vertex, gemini-2.5-flash).
 * 1. False positives: every recorded request in the given run directories, with its full recorded tool
 *    trace, should come back with nothing missing (those turns completed and passed).
 * 2. The S06 early stop: the S06 request with only get_store_assortment run should name a missing part.
 * 3. After a forced early stop of the recorded S06 turn (round 1 answered with tools disabled), the
 *    continuation note should lead the planner (AUTO) to calculate_uplift.
 * Env: TEAMCHAT_TARGET, GCP_PROJECT_ID, GOOGLE_CLOUD_REGION, TRIALS (default 10). Read-only.
 *   node --experimental-strip-types scripts/experiments/completeness-review.ts <s06 turn id> <requester uid> <run dir>... */
import fs from "node:fs";
import path from "node:path";
import {GoogleGenAI} from "@google/genai";
import {TOOL_DECLARATIONS} from "../../src/tools.ts";
import {createGeminiProvider,completenessReviewContents,parseReview,continuationNote,REVIEW_INSTRUCTIONS,
 trustedPlannerInstructions,buildConversationContents} from "../../src/worker/gemini.ts";
import {SqlToolExecutor} from "../../src/server/sql-tools.ts";
import {SourceLedger} from "../../src/grounding.ts";
import {resolveVerifiedIdentity} from "../../src/server/database.ts";
import {inTenantTransaction} from "../../src/persistence/postgres.ts";
import {openDb} from "../acceptance/common.ts";

const [turnId,uid,...runDirs]=process.argv.slice(2) as [string,string,...string[]];
const TRIALS=Number(process.env.TRIALS??10);
const provider=await createGeminiProvider();
const review=async(name:string,text:string,calls:Array<{name:string;args:Record<string,unknown>;result?:unknown}>)=>
 parseReview(await provider.review!(completenessReviewContents({requesterName:name,text},calls),{systemInstruction:REVIEW_INSTRUCTIONS}));

// 1. False positives on recorded, completed turns.
const records:Array<{file:string;prompt:string;calls:Array<{name:string;args:Record<string,unknown>;result?:unknown}>}>=[];
for(const dir of runDirs)for(const sub of fs.readdirSync(dir,{withFileTypes:true}).filter(d=>d.isDirectory()))
 for(const f of fs.readdirSync(path.join(dir,sub.name)).filter(f=>f.endsWith(".json"))){
  const r=JSON.parse(fs.readFileSync(path.join(dir,sub.name,f),"utf8"));
  if(typeof r?.prompt==="string"&&Array.isArray(r?.toolTrace)&&r.toolTrace.length&&r.terminal==="ai_complete")
   records.push({file:`${path.basename(dir)}/${sub.name}/${f}`,prompt:r.prompt,calls:r.toolTrace.map((t:any)=>({name:t.name,args:t.arguments??{},result:t.result}))});
 }
const falsePositives:unknown[]=[];
for(const r of records){const missing=await review("Requester",r.prompt,r.calls);if(missing)falsePositives.push({file:r.file,prompt:r.prompt.slice(0,120),calls:r.calls.map(c=>c.name),missing});}

// 2 and 3. The recorded S06 turn.
const pool=await openDb();
const ctx=await resolveVerifiedIdentity(pool as any,uid);
const loaded=await inTenantTransaction(pool as any,ctx,async(c:any)=>{
 const job=(await c.query("SELECT room_id,transcript_cutoff::text AS cutoff,memory_consent FROM teamchat.ai_jobs WHERE tenant_id=$1 AND turn_id=$2::uuid",[ctx.tenantId,turnId])).rows[0];
 const q=await c.query("SELECT type,payload,sequence::text,turn_id::text FROM teamchat.room_events WHERE tenant_id=$1 AND room_id=$2 AND sequence<=$3 AND type IN ('message','ai_answer_block','ai_answer_segment','ai_answer_reset') ORDER BY room_events.sequence DESC LIMIT 120",[ctx.tenantId,job.room_id,job.cutoff]);
 const m=await c.query("SELECT firebase_uid,display_name FROM teamchat.user_memberships WHERE tenant_id=$1",[ctx.tenantId]);
 return {job,history:q.rows.reverse(),names:new Map<string,string>(m.rows.map((r:any)=>[r.firebase_uid,r.display_name]))};
});
const conversation=buildConversationContents(loaded.history,loaded.names,{uid,cutoff:loaded.job.cutoff});
const request=String(loaded.history.at(-1)?.payload.body??"");
const executor=new SqlToolExecutor(pool as any);
const client=new GoogleGenAI({vertexai:true,project:process.env.GCP_PROJECT_ID??"focus-clean-4b9f4",location:process.env.GOOGLE_CLOUD_REGION??"us-central1"});
const config=(mode:"AUTO"|"NONE")=>({temperature:0.2,tools:[{functionDeclarations:TOOL_DECLARATIONS as any}],maxOutputTokens:2048,thinkingConfig:{thinkingBudget:512},
 systemInstruction:trustedPlannerInstructions({roomId:loaded.job.room_id,memoryConsent:loaded.job.memory_consent}),toolConfig:{functionCallingConfig:{mode:mode as any}}});
const trusted={roomId:loaded.job.room_id,memoryConsent:loaded.job.memory_consent};
const stopTrials:unknown[]=[];
for(let n=1;n<=TRIALS;n++){
 try{
  const contents:any[]=[...conversation.contents];
  const r0=await provider.round(contents,{trusted});
  if(!r0.functionCalls.some(c=>c.name==="get_store_assortment")){stopTrials.push({trial:n,skipped:`round 0 called ${r0.functionCalls.map(c=>c.name).join(",")||"nothing"}`});continue;}
  contents.push(r0.content);
  const parts=[],ran:Array<{name:string;args:Record<string,unknown>;result:unknown}>=[];
  for(const call of r0.functionCalls){
   let result:unknown;try{result=await executor.execute(ctx,loaded.job.room_id,call.name as any,call.args,new SourceLedger(ctx,turnId),false);}catch(e){result={error:String(e).slice(0,200)};}
   ran.push({name:call.name!,args:call.args??{},result});
   parts.push({functionResponse:{name:call.name,...(call.id?{id:call.id}:{}),response:{data:result}}});
  }
  contents.push({role:"user",parts});
  // Force the live failure: round 1 answers in text with tools disabled.
  const stopped=await client.models.generateContent({model:"gemini-2.5-flash",contents,config:config("NONE")});
  const stopText=stopped.text??"";
  const missing=await review(conversation.requesterName,request,ran);
  if(!missing){stopTrials.push({trial:n,missing:"",reachedCalculation:false});continue;}
  contents.push({role:"model",parts:[{text:stopText}]});
  contents.push({role:"user",parts:[{text:continuationNote(conversation.requesterName,missing)}]});
  const next=await provider.round(contents,{trusted});
  stopTrials.push({trial:n,missing,nextCalls:next.functionCalls.map(c=>c.name),reachedCalculation:next.functionCalls.some(c=>c.name==="calculate_uplift"),
   otherQuestionTaken:next.functionCalls.some(c=>c.name==="search_catalog")});
 }catch(e){stopTrials.push({trial:n,error:String(e).slice(0,200)});}
}
await pool.end();
const ran=stopTrials.filter((t:any)=>"reachedCalculation" in t);
console.log(JSON.stringify({ranAt:new Date().toISOString(),model:"gemini-2.5-flash",turnId,
 summary:{recordedTurns:records.length,falsePositives:falsePositives.length,
  s06StopTrials:ran.length,s06Flagged:ran.filter((t:any)=>t.missing).length,s06ReachedCalculation:ran.filter((t:any)=>t.reachedCalculation).length,
  skipped:stopTrials.length-ran.length},
 falsePositives,stopTrials},null,1));
