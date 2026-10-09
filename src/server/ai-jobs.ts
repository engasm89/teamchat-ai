import {inTenantTransaction,type SqlPool,type SqlClient} from "../persistence/postgres.ts";
import {resolvedContext,type TenantContext} from "../tenant.ts";
import type {SqlNotification} from "./database.ts";

export interface JobRecord{turn_id:string;tenant_id:string;room_id:string;user_uid:string;transcript_cutoff:string;memory_consent:boolean;state:string;fencing_token:string; attempts:number;}
export async function resolveJob(pool:SqlPool,turnId:string):Promise<{ctx:TenantContext,job:JobRecord}>{
 if(!/^[a-f\d-]{36}$/i.test(turnId))throw Error("Invalid job ID");
 const client=await pool.connect();let tenant:string|undefined;
 try{const r=await client.query<{tenant_id:string}>("SELECT teamchat.resolve_tenant_for_turn($1::uuid) AS tenant_id",[turnId]);tenant=r.rows[0]?.tenant_id;}finally{client.release();}
 if(!tenant)throw Error("Job unavailable");
 // Internal lookup supplies tenant ID from privileged directory, not request body.
 const systemCtx=resolvedContext("internal-job-reader",tenant);
 const job=await inTenantTransaction(pool,systemCtx,async c=>{
  const r=await c.query<JobRecord>("SELECT turn_id::text,tenant_id,room_id,user_uid,transcript_cutoff::text,memory_consent,state,fencing_token::text,attempts FROM teamchat.ai_jobs WHERE tenant_id=$1 AND turn_id=$2::uuid",[tenant,turnId]);
  return r.rows[0];
 });
 if(!job)throw Error("Job unavailable");
 return {ctx:resolvedContext(job.user_uid,tenant),job};
}
export async function appendRoomEvent(pool:SqlPool,ctx:TenantContext,room:string,type:string,payload:Record<string,unknown>,turnId?:string){
 return inTenantTransaction(pool,ctx,async c=>{
  const r=await c.query<{next_sequence:string}>("SELECT next_sequence::text FROM teamchat.rooms WHERE tenant_id=$1 AND room_id=$2 FOR UPDATE",[ctx.tenantId,room]);
  if(!r.rows.length)throw Error("Room unavailable");
  const sequence=Number(r.rows[0]!.next_sequence);if(!Number.isSafeInteger(sequence))throw Error("Invalid sequence");
  await c.query("UPDATE teamchat.rooms SET next_sequence=next_sequence+1 WHERE tenant_id=$1 AND room_id=$2",[ctx.tenantId,room]);
  await c.query("INSERT INTO teamchat.room_events(tenant_id,room_id,sequence,type,payload,turn_id) VALUES($1,$2,$3,$4,$5::jsonb,$6::uuid)",[ctx.tenantId,room,sequence,type,JSON.stringify(payload),turnId??null]);
  return sequence;
 });
}
export async function claimJob(pool:SqlPool,ctx:TenantContext,jobId:string,workerId:string):Promise<{fence:number;job:JobRecord}|null>{
 return inTenantTransaction(pool,ctx,async c=>{
  const rows=await c.query<JobRecord>(`UPDATE teamchat.ai_jobs SET state='running',attempts=attempts+1,
   fencing_token=fencing_token+1,lease_owner=$3,lease_expires_at=now()+interval '4 minutes',updated_at=now()
   WHERE tenant_id=$1 AND turn_id=$2::uuid AND (state='queued' OR (state='running' AND lease_expires_at<now()))
   AND attempts<5 RETURNING turn_id::text,tenant_id,room_id,user_uid,transcript_cutoff::text,memory_consent,state,fencing_token::text,attempts`,[ctx.tenantId,jobId,workerId]);
  const job=rows.rows[0];return job?{fence:Number(job.fencing_token),job}:null;
 });
}
export async function fencedUpdate(pool:SqlPool,ctx:TenantContext,jobId:string,fence:number,
 fn:(c:SqlClient)=>Promise<void>,state:"running"|"completed"|"failed"="running"){
 return inTenantTransaction(pool,ctx,async c=>{
  const check=await c.query("SELECT 1 FROM teamchat.ai_jobs WHERE tenant_id=$1 AND turn_id=$2::uuid AND fencing_token=$3 AND state='running' AND lease_expires_at>now() FOR UPDATE",[ctx.tenantId,jobId,fence]);
  if(check.rows.length!==1)throw Error("AI job lease lost");
  // Extend the lease with each committed progress event. A busy worker must not
  // have its fenced writes stolen after four minutes while it is still active.
  await c.query("UPDATE teamchat.ai_jobs SET lease_expires_at=now()+interval '4 minutes',updated_at=now() WHERE tenant_id=$1 AND turn_id=$2::uuid AND fencing_token=$3",[ctx.tenantId,jobId,fence]);
  await fn(c);
  if(state!=="running")await c.query("UPDATE teamchat.ai_jobs SET state=$4,lease_expires_at=NULL,updated_at=now() WHERE tenant_id=$1 AND turn_id=$2::uuid AND fencing_token=$3",[ctx.tenantId,jobId,fence,state]);
 });
}
/** Persist a tool result and its visible trace as one committed room event.
 * A model retry cannot duplicate the same operation ID. */
export async function persistTool(pool:SqlPool,ctx:TenantContext,room:string,turnId:string,fence:number,operationId:string,name:string,args:unknown,result:unknown){
 await fencedUpdate(pool,ctx,turnId,fence,async c=>{
  const created=await c.query("INSERT INTO teamchat.tool_calls(tenant_id,turn_id,operation_id,name,arguments,result,status) VALUES($1,$2::uuid,$3,$4,$5::jsonb,$6::jsonb,'completed') ON CONFLICT (tenant_id,turn_id,operation_id) DO NOTHING RETURNING operation_id",[ctx.tenantId,turnId,operationId,name,JSON.stringify(args),JSON.stringify(result)]);
  if(created.rows.length)await appendWithinTransaction(c,ctx,room,"ai_tool",{operationId,name,arguments:args,result},turnId);
 });
}
export async function getPersistedTool(pool:SqlPool,ctx:TenantContext,turnId:string,operationId:string){
 return inTenantTransaction(pool,ctx,async c=>{
  const r=await c.query<{name:string;arguments:unknown;result:unknown}>("SELECT name,arguments,result FROM teamchat.tool_calls WHERE tenant_id=$1 AND turn_id=$2::uuid AND operation_id=$3 AND status='completed'",[ctx.tenantId,turnId,operationId]);
  return r.rows.length?{found:true as const,...r.rows[0]!}:null;
 });
}
async function appendWithinTransaction(c:SqlClient,ctx:TenantContext,room:string,type:string,payload:unknown,turnId:string){
 const roomRows=await c.query<{next_sequence:string}>("SELECT next_sequence::text FROM teamchat.rooms WHERE tenant_id=$1 AND room_id=$2 FOR UPDATE",[ctx.tenantId,room]);
 if(roomRows.rows.length!==1)throw Error("Room unavailable");
 const sequence=Number(roomRows.rows[0]!.next_sequence);
 if(!Number.isSafeInteger(sequence))throw Error("Sequence overflow");
 await c.query("UPDATE teamchat.rooms SET next_sequence=next_sequence+1 WHERE tenant_id=$1 AND room_id=$2",[ctx.tenantId,room]);
 await c.query("INSERT INTO teamchat.room_events(tenant_id,room_id,sequence,type,payload,turn_id) VALUES($1,$2,$3,$4,$5::jsonb,$6::uuid)",[ctx.tenantId,room,sequence,type,JSON.stringify(payload),turnId]);
}
/** Store source-verified answer block + event atomically, before any WebSocket fanout. */
export async function persistAnswer(pool:SqlPool,ctx:TenantContext,room:string,turnId:string,fence:number,index:number,verified:unknown){
 await fencedUpdate(pool,ctx,turnId,fence,async c=>{
  const inserted=await c.query("INSERT INTO teamchat.answer_blocks(tenant_id,turn_id,block_index,verified_payload) VALUES($1,$2::uuid,$3,$4::jsonb) ON CONFLICT (tenant_id,turn_id,block_index) DO NOTHING RETURNING block_index",[ctx.tenantId,turnId,index,JSON.stringify(verified)]);
  if(inserted.rows.length)await appendWithinTransaction(c,ctx,room,"ai_answer_block",{blockIndex:index,verified},turnId);
 });
}
export async function finishJob(pool:SqlPool,ctx:TenantContext,room:string,turnId:string,fence:number,status:"completed"|"failed",reason?:string){
 await fencedUpdate(pool,ctx,turnId,fence,async c=>{
  await appendWithinTransaction(c,ctx,room,status==="completed"?"ai_complete":"ai_failed",{status,...(reason?{reason}:{} )},turnId);
 },status);
}

/** A dead worker that exhausted its permitted attempts must not leave an
 * invisible, permanently running turn. Preserve one durable terminal event. */
export async function failExhaustedJob(pool:SqlPool,ctx:TenantContext,turnId:string):Promise<boolean>{
 return inTenantTransaction(pool,ctx,async c=>{
  const row=await c.query<{room_id:string}>(`SELECT room_id FROM teamchat.ai_jobs
   WHERE tenant_id=$1 AND turn_id=$2::uuid AND attempts>=5 AND state='running'
   AND lease_expires_at<now() FOR UPDATE`,[ctx.tenantId,turnId]);
  if(row.rows.length!==1)return false;
  await appendWithinTransaction(c,ctx,row.rows[0]!.room_id,"ai_failed",{status:"failed",reason:"AI processing retry limit reached"},turnId);
  await c.query("UPDATE teamchat.ai_jobs SET state='failed',lease_expires_at=NULL,updated_at=now() WHERE tenant_id=$1 AND turn_id=$2::uuid",[ctx.tenantId,turnId]);
  return true;
 });
}
