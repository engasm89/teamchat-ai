/** Read-only reconstruction of one reviewer account's session.
 * Reads Firebase Auth (UID only), the runtime role inside a READ ONLY
 * tenant transaction (RLS active), and Cloud Logging by turn ID. Writes only to
 * the git-ignored audit/ directory. Never prints credentials or message text.
 *   node --experimental-strip-types scripts/forensics/reviewer-session.ts \
 *     <email> <tenant> <windowStartIso> <windowEndIso> <dayStartIso> <dayEndIso> <outDir>
 * Requires cloud-sql-proxy on DB_PROXY_PORT (default 6543). */
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {initializeApp} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {openDb} from "../acceptance/common.ts";
import {GCP} from "../evidence/lib.ts";
import {renderVerifiedBlock} from "../../apps/web/src/verified.ts";
import {hasAiMention} from "../../src/persistence/postgres.ts";

const [email,tenant,winStart,winEnd,dayStart,dayEnd,outDir]=process.argv.slice(2);
if(!email||!tenant||!winStart||!winEnd||!dayStart||!dayEnd||!outDir)throw Error("usage: <email> <tenant> <winStart> <winEnd> <dayStart> <dayEnd> <outDir>");
if(!path.resolve(outDir).startsWith(path.resolve("audit")+path.sep))throw Error("Output must stay under the git-ignored audit/ directory");

const user=await getAuth(initializeApp({projectId:GCP.project})).getUserByEmail(email);
const uid=user.uid;
console.log(`reviewer uid resolved (${uid.length} chars); lastSignIn=${user.metadata.lastSignInTime}`);

const pool=await openDb();
const c=await pool.connect();
type Row=Record<string,unknown>;
const q=async(sql:string,args:unknown[]=[])=>(await c.query<Row>(sql,args)).rows;
let data:Record<string,unknown>;
try{
 await c.query("BEGIN TRANSACTION READ ONLY");
 await c.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);
 const who=await q("SELECT current_user AS u,current_setting('transaction_read_only') AS ro,(SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user) AS bypass");
 if(who[0]?.u!=="teamchat_api"||who[0]?.ro!=="on"||who[0]?.bypass!==false)throw Error("Not a read-only, RLS-bound runtime session");
 const members=await q("SELECT firebase_uid,display_name,role,active FROM teamchat.user_memberships WHERE tenant_id=$1",[tenant]);
 const rooms=await q("SELECT r.room_id,r.title FROM teamchat.rooms r JOIN teamchat.room_memberships m USING(tenant_id,room_id) WHERE r.tenant_id=$1 AND m.firebase_uid=$2 ORDER BY r.room_id",[tenant,uid]);
 const messages=await q(`SELECT room_id,message_id::text,event_sequence::text AS sequence,body,created_at,
   (created_at>=$3::timestamptz AND created_at<$4::timestamptz) AS in_window
   FROM teamchat.messages WHERE tenant_id=$1 AND author_uid=$2 AND created_at>=$5::timestamptz AND created_at<$6::timestamptz
   ORDER BY created_at`,[tenant,uid,winStart,winEnd,dayStart,dayEnd]);
 const jobs=await q(`SELECT turn_id::text,room_id,state,transcript_cutoff::text,attempts,memory_consent,created_at,updated_at,fencing_token::text
   FROM teamchat.ai_jobs WHERE tenant_id=$1 AND user_uid=$2 AND created_at>=$3::timestamptz AND created_at<$4::timestamptz ORDER BY created_at`,[tenant,uid,dayStart,dayEnd]);
 const turnIds=jobs.map(j=>j.turn_id as string);
 const tools=turnIds.length?await q(`SELECT turn_id::text,operation_id,name,arguments,result,status,created_at FROM teamchat.tool_calls
   WHERE tenant_id=$1 AND turn_id=ANY($2::uuid[]) ORDER BY created_at,operation_id`,[tenant,turnIds]):[];
 const blocks=turnIds.length?await q(`SELECT turn_id::text,block_index,revision,verified_payload,created_at FROM teamchat.answer_blocks
   WHERE tenant_id=$1 AND turn_id=ANY($2::uuid[]) ORDER BY turn_id,block_index`,[tenant,turnIds]):[];
 const outbox=turnIds.length?await q(`SELECT turn_id::text,state,dispatch_attempts,next_retry_at FROM teamchat.task_outbox
   WHERE tenant_id=$1 AND turn_id=ANY($2::uuid[])`,[tenant,turnIds]):[];
 // Room context: every event of the day in the rooms this account wrote to.
 const touched=[...new Set(messages.map(m=>m.room_id as string))];
 const events=touched.length?await q(`SELECT room_id,sequence::text,event_id::text,type,turn_id::text,payload,created_at FROM teamchat.room_events
   WHERE tenant_id=$1 AND room_id=ANY($2::text[]) AND created_at>=$3::timestamptz AND created_at<$4::timestamptz ORDER BY room_id,sequence`,[tenant,touched,dayStart,dayEnd]):[];
 const priorContext=touched.length?await q(`SELECT room_id,count(*)::int AS events_before_day,max(sequence)::text AS last_sequence_before_day FROM teamchat.room_events
   WHERE tenant_id=$1 AND room_id=ANY($2::text[]) AND created_at<$3::timestamptz GROUP BY room_id`,[tenant,touched,dayStart]):[];
 await c.query("ROLLBACK");
 data={members,rooms,messages,jobs,tools,blocks,outbox,events,priorContext};
}finally{c.release();await pool.end();}

const nameOf=new Map((data.members as Row[]).map(m=>[m.firebase_uid as string,m.display_name as string]));
const alias=(u:unknown)=>u===uid?"REVIEWER_ACCOUNT":nameOf.get(String(u))??"unknown-member";

// Cloud Logging by turn ID (read-only).
const logs:Record<string,unknown[]>={};
for(const j of data.jobs as Row[]){
 const turn=String(j.turn_id);
 const filter=`resource.type="cloud_run_revision" AND (resource.labels.service_name="teamchat-worker" OR resource.labels.service_name="teamchat-api") AND ("${turn}") AND timestamp>="${dayStart}" AND timestamp<"${dayEnd}"`;
 try{
  const out=execFileSync("gcloud",["logging","read",filter,"--project",GCP.project,"--format=json","--limit=200","--order=asc"],{encoding:"utf8",maxBuffer:64*1024*1024});
  logs[turn]=(JSON.parse(out) as Row[]).map(e=>({timestamp:e.timestamp,service:(e.resource as any)?.labels?.service_name,revision:(e.resource as any)?.labels?.revision_name,
   severity:e.severity,json:e.jsonPayload??null,text:typeof e.textPayload==="string"?e.textPayload.slice(0,2000):null,httpRequest:e.httpRequest?{status:(e.httpRequest as any).status,latency:(e.httpRequest as any).latency,url:(e.httpRequest as any).requestUrl}:null}));
 }catch(err){logs[turn]=[{error:err instanceof Error?err.message.slice(0,300):"logging read failed"}];}
}
// Worker-wide warnings (429 back-offs carry no turn ID) during the window.
let workerWarnings:unknown[]=[];
try{
 const out=execFileSync("gcloud",["logging","read",`resource.type="cloud_run_revision" AND resource.labels.service_name="teamchat-worker" AND severity>=WARNING AND timestamp>="${dayStart}" AND timestamp<"${dayEnd}"`,
  "--project",GCP.project,"--format=json","--limit=500","--order=asc"],{encoding:"utf8",maxBuffer:64*1024*1024});
 workerWarnings=(JSON.parse(out) as Row[]).map(e=>({timestamp:e.timestamp,severity:e.severity,text:typeof e.textPayload==="string"?e.textPayload.slice(0,500):null,json:e.jsonPayload??null}));
}catch(err){workerWarnings=[{error:err instanceof Error?err.message.slice(0,300):"logging read failed"}];}

const jobs=data.jobs as Row[],tools=data.tools as Row[],blocks=data.blocks as Row[],events=data.events as Row[];
const perMessage=(data.messages as Row[]).map(m=>{
 const job=jobs.find(j=>j.room_id===m.room_id&&String(j.transcript_cutoff)===String(m.sequence));
 const turn=job?String(job.turn_id):null;
 const turnEvents=turn?events.filter(e=>e.turn_id===turn):[];
 return {
  RECORDED:{utc:m.created_at,room:m.room_id,author:"REVIEWER_ACCOUNT",messageId:m.message_id,sequence:Number(m.sequence),inWindow:m.in_window,body:m.body,
   aiMention:hasAiMention(String(m.body)),job:job?{turnId:turn,state:job.state,attempts:job.attempts,memoryConsent:job.memory_consent,createdAt:job.created_at,updatedAt:job.updated_at}:null,
   events:turnEvents.map(e=>({sequence:Number(e.sequence),type:e.type,createdAt:e.created_at,payload:e.payload})),
   tools:turn?tools.filter(t=>t.turn_id===turn).map(t=>({operationId:t.operation_id,name:t.name,arguments:t.arguments,status:t.status,result:t.result,createdAt:t.created_at})):[],
   answerBlocks:turn?blocks.filter(b=>b.turn_id===turn).map(b=>({index:b.block_index,payload:b.verified_payload})):[]},
  RECONSTRUCTED:{uiText:turn?turnEvents.map(e=>e.type==="ai_answer_block"?renderVerifiedBlock((e.payload as Row).verified):
   e.type==="ai_tool_start"?`Fetching verified data: ${String((e.payload as Row).name)}`:
   e.type==="ai_failed"?`AI could not finish: ${String((e.payload as Row).reason??"Processing failed")}`:
   e.type==="ai_complete"?"Answer completed":e.type==="ai_answer_reset"?"AI answer restarted after an interruption; prior partial blocks were superseded.":
   e.type==="ai_tool"?`Tool: ${String((e.payload as Row).name)} (raw JSON shown)`:"AI processing update"):[],
   noAiReason:job?null:hasAiMention(String(m.body))?"mention detected but no job row found":"no @AI mention, so the server never creates an AI job (hasAiMention gate)"},
  latency:turn&&turnEvents.length?{firstEventSeconds:(Date.parse(String(turnEvents[0]!.created_at))-Date.parse(String(m.created_at)))/1000,
   lastEventSeconds:(Date.parse(String(turnEvents.at(-1)!.created_at))-Date.parse(String(m.created_at)))/1000}:null,
 };
});
const contextTranscript=events.map(e=>({room:e.room_id,sequence:Number(e.sequence),type:e.type,createdAt:e.created_at,turnId:e.turn_id,
 author:e.type==="message"?alias((e.payload as Row).author_uid):"AI",
 text:e.type==="message"?(e.payload as Row).body:e.type==="ai_answer_block"?renderVerifiedBlock((e.payload as Row).verified):e.type}));

fs.mkdirSync(outDir,{recursive:true});
fs.writeFileSync(path.join(outDir,"SESSION_EVENTS_PRIVATE.json"),JSON.stringify({generatedAt:new Date().toISOString(),tenant,
 window:{start:winStart,end:winEnd},day:{start:dayStart,end:dayEnd},rooms:data.rooms,priorContext:data.priorContext,
 perMessage,contextTranscript,outbox:data.outbox},null,1));
fs.writeFileSync(path.join(outDir,"SESSION_TOOL_TRACES_PRIVATE.json"),JSON.stringify({tools,blocks,logs,workerWarnings},null,1));
console.log(JSON.stringify({messagesDay:(data.messages as Row[]).length,messagesWindow:(data.messages as Row[]).filter(m=>m.in_window).length,
 jobs:jobs.length,toolCalls:tools.length,answerBlocks:blocks.length,roomsTouched:[...new Set((data.messages as Row[]).map(m=>m.room_id))],
 logEntries:Object.values(logs).reduce((n,l)=>n+l.length,0),workerWarnings:workerWarnings.length}));
