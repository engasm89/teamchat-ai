/** Experiment: replay a recorded live turn through the planner rounds with the worker's exact streaming
 * config and real read-only tool results, recording each round's finishReason and token usage (which the
 * worker discarded). Question: when S06 "stops after get_store_assortment", did Gemini choose to reply, or
 * did the round end abnormally (MALFORMED_FUNCTION_CALL, MAX_TOKENS, empty) and get treated as final?
 * Env: TEAMCHAT_TARGET, TRIALS (default 20), PARALLEL (default 5), MAX_OUTPUT (default 2048).
 * Read-only: save_memory is refused.
 *   node --experimental-strip-types scripts/experiments/round-finish.ts <turn id> <requester uid> */
import {GoogleGenAI} from "@google/genai";
import {TOOL_DECLARATIONS} from "../../src/tools.ts";
import {trustedPlannerInstructions,buildConversationContents} from "../../src/worker/gemini.ts";
import {SqlToolExecutor} from "../../src/server/sql-tools.ts";
import {SourceLedger} from "../../src/grounding.ts";
import {resolveVerifiedIdentity} from "../../src/server/database.ts";
import {inTenantTransaction} from "../../src/persistence/postgres.ts";
import {openDb} from "../acceptance/common.ts";

const [turnId,uid]=process.argv.slice(2) as [string,string];
const TRIALS=Number(process.env.TRIALS??20),PARALLEL=Number(process.env.PARALLEL??5),MAX_OUTPUT=Number(process.env.MAX_OUTPUT??2048);
const pool=await openDb();
const ctx=await resolveVerifiedIdentity(pool as any,uid);
const loaded=await inTenantTransaction(pool as any,ctx,async(c:any)=>{
 const job=(await c.query("SELECT room_id,transcript_cutoff::text AS cutoff,memory_consent FROM teamchat.ai_jobs WHERE tenant_id=$1 AND turn_id=$2::uuid",[ctx.tenantId,turnId])).rows[0];
 if(!job)throw Error("turn not found for this requester's tenant");
 const q=await c.query("SELECT type,payload,sequence::text,turn_id::text FROM teamchat.room_events WHERE tenant_id=$1 AND room_id=$2 AND sequence<=$3 AND type IN ('message','ai_answer_block','ai_answer_segment','ai_answer_reset') ORDER BY room_events.sequence DESC LIMIT 120",[ctx.tenantId,job.room_id,job.cutoff]);
 const m=await c.query("SELECT firebase_uid,display_name FROM teamchat.user_memberships WHERE tenant_id=$1",[ctx.tenantId]);
 return {job,history:q.rows.reverse(),names:new Map<string,string>(m.rows.map((r:any)=>[r.firebase_uid,r.display_name]))};
});
const conversation=buildConversationContents(loaded.history,loaded.names,{uid,cutoff:loaded.job.cutoff});
const client=new GoogleGenAI({vertexai:true,project:process.env.GCP_PROJECT_ID??"focus-clean-4b9f4",location:process.env.GOOGLE_CLOUD_REGION??"us-central1"});
const config={temperature:0.2,tools:[{functionDeclarations:TOOL_DECLARATIONS as any}],maxOutputTokens:MAX_OUTPUT,thinkingConfig:{thinkingBudget:512},
 systemInstruction:trustedPlannerInstructions({roomId:loaded.job.room_id,memoryConsent:loaded.job.memory_consent}),toolConfig:{functionCallingConfig:{mode:"AUTO" as any}}};
const executor=new SqlToolExecutor(pool as any);

async function round(contents:any[]){
 const stream=await client.models.generateContentStream({model:"gemini-2.5-flash",contents,config});
 const parts:any[]=[];let finishReason:string|undefined,usage:any,finishMessage:string|undefined;
 for await(const r of stream as any){
  for(const p of r.candidates?.[0]?.content?.parts??[])parts.push(p);
  finishReason=r.candidates?.[0]?.finishReason??finishReason;finishMessage=r.candidates?.[0]?.finishMessage??finishMessage;usage=r.usageMetadata??usage;
 }
 const calls=parts.filter(p=>p.functionCall).map(p=>p.functionCall);
 const text=parts.filter(p=>typeof p.text==="string"&&p.thought!==true).map(p=>p.text).join("");
 return {content:{role:"model",parts},calls,text,finishReason,finishMessage:finishMessage?.slice(0,200),
  tokens:{thoughts:usage?.thoughtsTokenCount,output:usage?.candidatesTokenCount,total:usage?.totalTokenCount}};
}

async function trial(n:number){
 const contents:any[]=[...conversation.contents];const rounds:unknown[]=[];
 try{
  for(let i=0;i<6;i++){
   const r=await round(contents);
   rounds.push({round:i,calls:r.calls.map((c:any)=>c.name),finishReason:r.finishReason,finishMessage:r.finishMessage,textChars:r.text.length,tokens:r.tokens});
   if(!r.calls.length)break;
   contents.push(r.content);
   const parts=[];
   for(const call of r.calls){
    let result:unknown;
    try{result=await executor.execute(ctx,loaded.job.room_id,call.name,call.args,new SourceLedger(ctx,turnId),false);}
    catch(error){result={error:String(error).slice(0,200)};}
    parts.push({functionResponse:{name:call.name,...(call.id?{id:call.id}:{}),response:{data:result}}});
   }
   contents.push({role:"user",parts});
  }
 }catch(error){rounds.push({error:String(error).slice(0,300)});}
 const names=rounds.flatMap((r:any)=>r.calls??[]);
 return {trial:n,reachedCalculation:names.includes("calculate_uplift"),rounds};
}

const results:any[]=[];
for(let i=0;i<TRIALS;i+=PARALLEL)results.push(...await Promise.all(Array.from({length:Math.min(PARALLEL,TRIALS-i)},(_,k)=>trial(i+k+1))));
await pool.end();
const stoppedEarly=results.filter(r=>!r.reachedCalculation);
const finishes=results.flatMap(r=>r.rounds).reduce<Record<string,number>>((a,r:any)=>{const k=`${r.finishReason??"none"}${r.calls?.length?"+call":""}`;a[k]=(a[k]??0)+1;return a;},{});
console.log(JSON.stringify({ranAt:new Date().toISOString(),turnId,requester:conversation.requesterName,maxOutputTokens:MAX_OUTPUT,
 summary:{trials:TRIALS,reachedCalculation:TRIALS-stoppedEarly.length,stoppedEarly:stoppedEarly.length,
  stoppedEarlyEndings:stoppedEarly.map(r=>{const last:any=r.rounds.at(-1);return `${last.finishReason} text=${last.textChars} thoughts=${last.tokens?.thoughts} output=${last.tokens?.output}`;}),finishes},
 results},null,1));
