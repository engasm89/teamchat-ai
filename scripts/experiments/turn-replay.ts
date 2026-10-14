/** Experiment: replay the planner rounds of a recorded live turn, as the worker runs them, before any
 * tool executes. Same history query, names, planner config and say check; when the first reply has no
 * tool call and fails the say check, the escalation note is sent and the second reply is recorded.
 * Env: TEAMCHAT_TARGET, TRIALS, EXTRA_INSTRUCTION (appended to the planner instructions),
 * ESCALATION (replaces the escalation note). Read-only.
 *   node --experimental-strip-types scripts/experiments/turn-replay.ts <turn id> <requester uid> */
import {GoogleGenAI} from "@google/genai";
import {TOOL_DECLARATIONS} from "../../src/tools.ts";
import {trustedPlannerInstructions,buildConversationContents,sayCandidates,loadVocabulary,ESCALATION_NOTE} from "../../src/worker/gemini.ts";
import {resolveVerifiedIdentity} from "../../src/server/database.ts";
import {inTenantTransaction} from "../../src/persistence/postgres.ts";
import {openDb} from "../acceptance/common.ts";

const [turnId,uid]=process.argv.slice(2) as [string,string];
const TRIALS=Number(process.env.TRIALS??8),EXTRA=process.env.EXTRA_INSTRUCTION??"",ESCALATION=process.env.ESCALATION??ESCALATION_NOTE;
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
const vocabulary=await loadVocabulary(pool as any,ctx,conversation.requesterName,conversation.messages.map(m=>m.body).join("\n"));
await pool.end();
const client=new GoogleGenAI({vertexai:true,project:"focus-clean-4b9f4",location:"us-central1"});
const tools=[{functionDeclarations:TOOL_DECLARATIONS as any}];
const config={temperature:0.2,tools,maxOutputTokens:2048,thinkingConfig:{thinkingBudget:512},
 systemInstruction:trustedPlannerInstructions({roomId:loaded.job.room_id,memoryConsent:loaded.job.memory_consent})+(EXTRA?`\n${EXTRA}`:""),
 toolConfig:{functionCallingConfig:{mode:"AUTO" as any}}};
const round=async(contents:unknown[])=>{
 const stream=await client.models.generateContentStream({model:"gemini-2.5-flash",contents:contents as any,config});
 const calls:Array<{name?:string;args?:unknown}>=[];let text="";
 for await(const chunk of stream){calls.push(...(chunk.functionCalls??[]));text+=chunk.text??"";}
 return {calls:calls.map(c=>({name:c.name,args:c.args})),text};
};
const results:unknown[]=[];
for(let trial=1;trial<=TRIALS;trial++){
 try{
  const first=await round(conversation.contents);
  const sayOk=!first.calls.length&&sayCandidates(first.text).length>0&&sayCandidates(first.text).every(t=>vocabulary.checkSay(t).ok);
  let second=null;
  if(!first.calls.length&&!sayOk)second=await round([...conversation.contents,{role:"model",parts:[{text:first.text}]},{role:"user",parts:[{text:ESCALATION}]}]);
  results.push({trial,first:{...first,text:first.text.slice(0,500)},directPathShown:sayOk,second:second&&{...second,text:second.text.slice(0,500)}});
 }catch(error){results.push({trial,error:String(error).slice(0,300)});}
}
console.log(JSON.stringify({ranAt:new Date().toISOString(),turnId,requester:conversation.requesterName,extraInstruction:EXTRA||null,
 escalation:ESCALATION===ESCALATION_NOTE?"current":ESCALATION,results},null,1));
