/** Experiment: C03 follow-up ("which one of those is the low-noise model?") sometimes gets a text-only
 * round 0. The worker then sends ESCALATION_NOTE once; on staging e1fdb8a the model replied in text again
 * and the user got the fallback. Measures, with the worker's own provider: how often round 0 is text-only,
 * how often the escalation note leads to a tool call, and whether the completeness review plus
 * continuation note (today only used after tool rounds) would recover the remaining cases.
 * NOTE=specific replaces the escalation note with one naming the catalog codes in the draft that no tool fetched.
 * Env: TEAMCHAT_TARGET, GCP_PROJECT_ID, GOOGLE_CLOUD_REGION, TRIALS (default 40), PARALLEL (default 8), NOTE. Read-only.
 *   node --experimental-strip-types scripts/experiments/c03-escalation.ts <turn id> <requester uid> */
import {createGeminiProvider,buildConversationContents,ESCALATION_NOTE,completenessReviewContents,parseReview,
 continuationNote,REVIEW_INSTRUCTIONS} from "../../src/worker/gemini.ts";
import {resolveVerifiedIdentity} from "../../src/server/database.ts";
import {inTenantTransaction} from "../../src/persistence/postgres.ts";
import {openDb} from "../acceptance/common.ts";

const [turnId,uid]=process.argv.slice(2) as [string,string];
const TRIALS=Number(process.env.TRIALS??40),PARALLEL=Number(process.env.PARALLEL??8);
const pool=await openDb();
const ctx=await resolveVerifiedIdentity(pool as any,uid);
const loaded=await inTenantTransaction(pool as any,ctx,async(c:any)=>{
 const job=(await c.query("SELECT room_id,transcript_cutoff::text AS cutoff,memory_consent FROM teamchat.ai_jobs WHERE tenant_id=$1 AND turn_id=$2::uuid",[ctx.tenantId,turnId])).rows[0];
 const q=await c.query("SELECT type,payload,sequence::text,turn_id::text FROM teamchat.room_events WHERE tenant_id=$1 AND room_id=$2 AND sequence<=$3 AND type IN ('message','ai_answer_block','ai_answer_segment','ai_answer_reset') ORDER BY room_events.sequence DESC LIMIT 120",[ctx.tenantId,job.room_id,job.cutoff]);
 const m=await c.query("SELECT firebase_uid,display_name FROM teamchat.user_memberships WHERE tenant_id=$1",[ctx.tenantId]);
 return {job,history:q.rows.reverse(),names:new Map<string,string>(m.rows.map((r:any)=>[r.firebase_uid,r.display_name]))};
});
await pool.end();
const conversation=buildConversationContents(loaded.history,loaded.names,{uid,cutoff:loaded.job.cutoff});
const request=String(loaded.history.at(-1)?.payload.body??"");
const provider=await createGeminiProvider();
const trusted={roomId:loaded.job.room_id,memoryConsent:loaded.job.memory_consent};

async function trial(n:number){
 try{
  const contents:any[]=[...conversation.contents];
  const r0=await provider.round(contents,{trusted});
  if(r0.functionCalls.length)return {trial:n,round0:"tool",calls:r0.functionCalls.map(c=>c.name)};
  const codes=[...new Set(r0.text.match(/\b[A-Z]{3}-\d{3}\.\d{1,2}\b/g)??[])];
  const note=process.env.NOTE==="specific"&&codes.length?`Server note (trusted): your draft names ${codes.join(", ")}, which no tool fetched in this turn. Earlier answers in the room are not evidence. Fetch ${codes.length>1?"them":"it"} with a tool now, then answer.`:ESCALATION_NOTE;
  contents.push(r0.content,{role:"user",parts:[{text:note}]});
  const r1=await provider.round(contents,{trusted});
  if(r1.functionCalls.length)return {trial:n,round0:"text",draft:r0.text.slice(0,120),escalation:"tool",calls:r1.functionCalls.map(c=>c.name)};
  const missing=parseReview(await provider.review!(completenessReviewContents({requesterName:conversation.requesterName,text:request},[]),{systemInstruction:REVIEW_INSTRUCTIONS}));
  if(!missing)return {trial:n,round0:"text",draft:r0.text.slice(0,120),escalation:"text",review:""};
  contents.push(r1.content,{role:"user",parts:[{text:continuationNote(conversation.requesterName,missing)}]});
  const r2=await provider.round(contents,{trusted});
  return {trial:n,round0:"text",draft:r0.text.slice(0,120),escalation:"text",review:missing,afterNote:r2.functionCalls.length?"tool":"text",calls:r2.functionCalls.map(c=>c.name)};
 }catch(e){return {trial:n,error:String(e).slice(0,200)};}
}
const results:any[]=[];
for(let i=0;i<TRIALS;i+=PARALLEL)results.push(...await Promise.all(Array.from({length:Math.min(PARALLEL,TRIALS-i)},(_,k)=>trial(i+k+1))));
const text0=results.filter(r=>r.round0==="text");
console.log(JSON.stringify({ranAt:new Date().toISOString(),turnId,request,model:"gemini-2.5-flash",note:process.env.NOTE==="specific"?"specific":"ESCALATION_NOTE",
 summary:{trials:TRIALS,errors:results.filter(r=>r.error).length,round0Text:text0.length,escalationRecovered:text0.filter(r=>r.escalation==="tool").length,
  stillTextAfterEscalation:text0.filter(r=>r.escalation==="text").length,reviewFlagged:text0.filter(r=>r.review).length,
  recoveredByReviewNote:text0.filter(r=>r.afterNote==="tool").length},results},null,1));
