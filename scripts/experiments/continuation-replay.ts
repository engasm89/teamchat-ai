/** Experiment: replay a recorded live turn through the worker's tool loop (same history query, names,
 * planner config, real read-only tool results from the target) up to and after the one-time
 * continuation note, and record which tools ran before and after it. Built for S14 (does the note make
 * Gemini take up a colleague's simultaneous question?) and S06 (does it still reach calculate_uplift?).
 * The note shipped in 9b4f9f7 and was withdrawn after this replay: in S14 it made Gemini answer the
 * colleague's question in 11 of 12 trials, while S06 already reached the calculation without it.
 * Env: TEAMCHAT_TARGET, TRIALS, NOTE (replaces the withdrawn note), PROVIDER=worker (plan with the worker's own
 * streaming provider instead of a non-streaming call). Read-only: save_memory is refused.
 *   node --experimental-strip-types scripts/experiments/continuation-replay.ts <turn id> <requester uid> */
import {GoogleGenAI} from "@google/genai";
import {TOOL_DECLARATIONS} from "../../src/tools.ts";
import {trustedPlannerInstructions,buildConversationContents,createGeminiProvider} from "../../src/worker/gemini.ts";
import {SqlToolExecutor} from "../../src/server/sql-tools.ts";
import {SourceLedger} from "../../src/grounding.ts";
import {resolveVerifiedIdentity} from "../../src/server/database.ts";
import {inTenantTransaction} from "../../src/persistence/postgres.ts";
import {openDb} from "../acceptance/common.ts";

const [turnId,uid]=process.argv.slice(2) as [string,string];
const WITHDRAWN_NOTE=`Server note (trusted): you ended your turn. If any part of the request still needs a tool, call it now. If nothing is missing, reply with only the word DONE.`;
const isDoneReply=(text:string)=>/^\s*\**DONE\**[.!]?\s*$/i.test(text);
const TRIALS=Number(process.env.TRIALS??8),NOTE=process.env.NOTE??WITHDRAWN_NOTE;
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
const client=new GoogleGenAI({vertexai:true,project:"focus-clean-4b9f4",location:"us-central1"});
const config={temperature:0.2,tools:[{functionDeclarations:TOOL_DECLARATIONS as any}],maxOutputTokens:2048,thinkingConfig:{thinkingBudget:512},
 systemInstruction:trustedPlannerInstructions({roomId:loaded.job.room_id,memoryConsent:false}),toolConfig:{functionCallingConfig:{mode:"AUTO" as any}}};
const executor=new SqlToolExecutor(pool as any);
const worker=process.env.PROVIDER==="worker"?await createGeminiProvider():null;
const plan=async(contents:any[])=>{
 if(worker){const r=await worker.round(contents,{trusted:{roomId:loaded.job.room_id,memoryConsent:false}});return {content:r.content as any,calls:r.functionCalls as any[],text:r.text};}
 const response=await client.models.generateContent({model:"gemini-2.5-flash",contents,config});
 return {content:response.candidates?.[0]?.content??{role:"model",parts:[]},calls:response.functionCalls??[],text:response.text??""};
};

const results:unknown[]=[];
for(let trial=1;trial<=TRIALS;trial++){
 const contents:any[]=[...conversation.contents];const before:unknown[]=[],after:unknown[]=[];
 let continued=false,toolsRun=0,ending="";
 try{
  for(let round=0;round<6;round++){
   const {content,calls,text}=await plan(contents);
   if(!calls.length){
    if(continued){ending=isDoneReply(text)?"DONE":`text: ${text.slice(0,300)}`;break;}
    if(toolsRun>0){continued=true;if(content.parts?.length)contents.push(content);contents.push({role:"user",parts:[{text:NOTE}]});continue;}
    ending=`no tools: ${text.slice(0,300)}`;break;
   }
   contents.push(content);
   const parts=[];
   for(const call of calls){
    (continued?after:before).push({name:call.name,args:call.args});
    let result:unknown;
    try{result=await executor.execute(ctx,loaded.job.room_id,call.name as any,call.args,new SourceLedger(ctx,turnId),false);}
    catch(error){result={error:String(error).slice(0,200)};}
    parts.push({functionResponse:{name:call.name,...(call.id?{id:call.id}:{}),response:{data:result}}});
   }
   toolsRun+=calls.length;contents.push({role:"user",parts});
  }
  results.push({trial,before,after,ending});
 }catch(error){results.push({trial,error:String(error).slice(0,300)});}
}
await pool.end();
console.log(JSON.stringify({ranAt:new Date().toISOString(),turnId,requester:conversation.requesterName,
 provider:worker?"worker streaming":"non-streaming",note:NOTE===WITHDRAWN_NOTE?"withdrawn 9b4f9f7 note":NOTE,results},null,1));
