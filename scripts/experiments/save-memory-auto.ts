/** Experiment: under AUTO tool choice, does Gemini call save_memory for the S09/S10 prompts
 * with the checked-out save_memory description, and with a proposed one? Round 0 only, built
 * with the worker's buildConversationContents and system instruction. Read-only: never executes tools.
 *   node --experimental-strip-types scripts/experiments/save-memory-auto.ts [--proposed-only] > qa_evidence/experiments/save-memory-auto.json */
import {GoogleGenAI} from "@google/genai";
import {TOOL_DECLARATIONS} from "../../src/tools.ts";
import {buildConversationContents,trustedPlannerInstructions} from "../../src/worker/gemini.ts";

const model="gemini-2.5-flash",TRIALS=5;
const client=new GoogleGenAI({vertexai:true,project:"focus-clean-4b9f4",location:"us-central1"});
const prompts:Record<string,string>={
 nested:'@AI Remember this complex nested roster as roster-x1: {"leads":[{"name":"Ana","shifts":[{"day":"Mon","stores":["ST-4001","ST-4002"]}]},{"name":"Ben","shifts":[{"day":"Tue","stores":["ST-4003"]}]}]}',
 flat:"@AI Remember that the roster-x2 flat check value is roster-x2-ok.",
 contact:"@AI Remember that our escalation contact for the dispute-x3 supplier dispute is Dana ab12cd34-ef56 and the deadline is 2026-11-20.",
};
const proposed=process.env.PROPOSED_DESCRIPTION;
const variants:Record<string,typeof TOOL_DECLARATIONS[number][]>={};
if(!process.argv.includes("--proposed-only"))variants["description as checked out"]=[...TOOL_DECLARATIONS];
if(proposed)variants.proposed=TOOL_DECLARATIONS.map(t=>t.name==="save_memory"?{...t,description:proposed}:t) as any;
const systemInstruction=trustedPlannerInstructions({roomId:"supply-planning",memoryConsent:true});
const names=new Map([["uid-1","Northside Buyer One"]]);
/** --live <email> <room> <sequence>: the real room history up to a recorded trigger (TEAMCHAT_TARGET
 * picks the stack; read as the runtime role), with the same query the worker uses. */
const live=process.argv.includes("--live")?process.argv.slice(process.argv.indexOf("--live")+1,process.argv.indexOf("--live")+4):null;
async function liveContents(){
 const [email,room,cutoff]=live!;
 const {ACCOUNTS,openDb}=await import("../acceptance/common.ts");
 const {inTenantTransaction}=await import("../../src/persistence/postgres.ts");
 const {resolvedContext}=await import("../../src/tenant.ts");
 const {getAuth}=await import("firebase-admin/auth");const {initializeApp,getApps}=await import("firebase-admin/app");
 if(!getApps().length)initializeApp({projectId:"focus-clean-4b9f4"});
 const account=Object.values(ACCOUNTS).find(a=>a.email===email)!;const uid=(await getAuth().getUserByEmail(email)).uid;
 const pool=await openDb();
 try{
  return await inTenantTransaction(pool,resolvedContext(uid,account.tenant),async c=>{
   const q=await c.query<{type:string;payload:Record<string,unknown>;sequence:string;turn_id:string|null}>(
    "SELECT type,payload,sequence::text,turn_id::text FROM teamchat.room_events WHERE tenant_id=$1 AND room_id=$2 AND sequence<=$3 AND type IN ('message','ai_answer_block','ai_answer_segment','ai_answer_reset') ORDER BY room_events.sequence DESC LIMIT 120",[account.tenant,room,cutoff]);
   const m=await c.query<{firebase_uid:string;display_name:string}>("SELECT firebase_uid,display_name FROM teamchat.user_memberships WHERE tenant_id=$1",[account.tenant]);
   const history=q.rows.reverse(),liveNames=new Map(m.rows.map(r=>[r.firebase_uid,r.display_name]));
   return {body:String(history.at(-1)?.payload.body??""),contents:buildConversationContents(history,liveNames,{uid,cutoff:cutoff!}).contents};
  });
 }finally{await pool.end();}
}
const recorded=live?await liveContents():null;
if(recorded){for(const k of Object.keys(prompts))delete prompts[k];prompts.live=recorded.body;}
const out:Array<Record<string,unknown>>=[];
for(const [variant,declarations] of Object.entries(variants))for(const [prompt,body] of Object.entries(prompts)){
 const {contents}=recorded??buildConversationContents([{type:"message",sequence:1,payload:{author_uid:"uid-1",body}}],names,{uid:"uid-1",cutoff:1});
 for(let trial=1;trial<=TRIALS;trial++){
  try{
   const r=await client.models.generateContent({model,contents,config:{temperature:0.2,maxOutputTokens:2048,thinkingConfig:{thinkingBudget:512},systemInstruction,
    tools:[{functionDeclarations:declarations as any}],toolConfig:{functionCallingConfig:{mode:"AUTO" as any}}}});
   out.push({variant,prompt,trial,calls:(r.functionCalls??[]).map(c=>({name:c.name,args:c.args})),text:r.text?.slice(0,200)??null});
  }catch(error){out.push({variant,prompt,trial,error:String(error).slice(0,300)});}
 }
}
const summary=Object.keys(variants).flatMap(v=>Object.keys(prompts).map(p=>{
 const rows=out.filter(o=>o.variant===v&&o.prompt===p);
 return {variant:v,prompt:p,trials:rows.length,calledSaveMemory:rows.filter(o=>(o.calls as Array<{name:string}>|undefined)?.some(c=>c.name==="save_memory")).length};
}));
console.log(JSON.stringify({ranAt:new Date().toISOString(),model,config:"temperature 0.2, thinkingBudget 512, mode AUTO (round 0), consent GRANTED",
 proposedDescription:proposed??null,summary,results:out},null,1));
