import {assertContext, NO_MATCH, type TenantContext} from "../tenant.ts";
/** Driver-independent interface implemented by pg Pool and pg PoolClient when dependencies are available. */
export interface QueryResult<T=Record<string,unknown>>{rows:T[];rowCount:number|null;}
export interface SqlClient {query<T=Record<string,unknown>>(sql:string,args?:unknown[]):Promise<QueryResult<T>>;release(error?:Error):void;}
export interface SqlPool {connect():Promise<SqlClient>;}

export async function inTenantTransaction<T>(pool:SqlPool,ctx:TenantContext,fn:(client:SqlClient)=>Promise<T>):Promise<T>{
 assertContext(ctx);const client=await pool.connect();let open=false;let broken:Error|undefined;
 try{
  await client.query("BEGIN");open=true;
  // `true` means transaction local; pooled connections must never retain tenant after COMMIT.
  await client.query("SELECT set_config('app.tenant_id', $1, true)",[ctx.tenantId]);
  const value=await fn(client);
  await client.query("COMMIT");open=false;return value;
 }catch(err){if(open)try{await client.query("ROLLBACK");}catch(rollbackError){broken=rollbackError instanceof Error?rollbackError:Error("Transaction rollback failed");}throw err;}
 finally{client.release(broken);}
}
export interface DurableMessage {roomId:string;messageId:string;sequence:number;authorUid:string;body:string;duplicate:boolean; aiTurnId?:string;}
export interface PersistedEvent {room_id:string;sequence:number;event_id:string;type:string;turn_id?:string|null;payload:Record<string,unknown>;created_at:string;}
async function authorizeRoom(client:SqlClient,ctx:TenantContext,room:string):Promise<boolean>{
 const auth=await client.query("SELECT 1 FROM teamchat.room_memberships WHERE tenant_id=$1 AND room_id=$2 AND firebase_uid=$3 AND EXISTS (SELECT 1 FROM teamchat.user_memberships WHERE tenant_id=$1 AND firebase_uid=$3 AND active=true)",[ctx.tenantId,room,ctx.uid]);
 return auth.rows.length===1;
}
/** Recognize an explicit @AI mention in ordinary prose and punctuation, but
 * never wake the agent for the domain-like substring in name@ai.example. */
export function hasAiMention(body:string):boolean {
 return /(?:^|[^\p{L}\p{N}_])@AI(?![\p{L}\p{N}_])/iu.test(body);
}
/** Every send is durable and idempotent. The event must commit before anyone publishes it. */
export async function sendDurableMessage(pool:SqlPool,ctx:TenantContext,input:{roomId:string;clientMessageId:string;body:string;allowSharedMemorySave?:boolean}):Promise<DurableMessage | typeof NO_MATCH>{
 const {roomId,clientMessageId,body}=input;
 if(typeof roomId!=="string"||typeof clientMessageId!=="string"||typeof body!=="string"||
    !/^[-a-z0-9_]{1,128}$/i.test(roomId)||!/^[-a-z0-9_]{1,128}$/i.test(clientMessageId)||
    !body.trim()||body.length>8000)throw new Error("Invalid message command");
 return inTenantTransaction(pool,ctx,async client=>{
  if(!await authorizeRoom(client,ctx,roomId))return NO_MATCH;
  // Global per-author dedupe lock BEFORE room lock (also protects simultaneous sends in different rooms).
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",[`${ctx.tenantId}:${ctx.uid}:${clientMessageId}`]);
  const existing=await client.query<{room_id:string;body:string;message_id:string;event_sequence:string;turn_id:string|null;memory_consent:boolean|null}>(
   `SELECT m.room_id,m.body,m.message_id::text,m.event_sequence::text,
           j.turn_id::text,j.memory_consent
      FROM teamchat.messages m LEFT JOIN teamchat.ai_jobs j
        ON j.tenant_id=m.tenant_id AND j.room_id=m.room_id
       AND j.user_uid=m.author_uid AND j.transcript_cutoff=m.event_sequence
     WHERE m.tenant_id=$1 AND m.author_uid=$2 AND m.client_message_id=$3`,
   [ctx.tenantId,ctx.uid,clientMessageId]);
  if(existing.rows.length){const old=existing.rows[0]!;
   if(old.room_id!==roomId||old.body!==body||
      (old.turn_id!=null && old.memory_consent!==(input.allowSharedMemorySave===true)))
     throw new Error("Conflicting duplicate client message ID");
   return {roomId,messageId:old.message_id,sequence:Number(old.event_sequence),authorUid:ctx.uid,body,duplicate:true,
    ...(old.turn_id?{aiTurnId:old.turn_id}:{})};
  }
  const room=await client.query<{next_sequence:string}>("SELECT next_sequence::text FROM teamchat.rooms WHERE tenant_id=$1 AND room_id=$2 FOR UPDATE",[ctx.tenantId,roomId]);
  if(!room.rows.length)return NO_MATCH;
  const seq=Number(room.rows[0]!.next_sequence);
  if(!Number.isSafeInteger(seq)||seq<1)throw new Error("Invalid room sequence");
  await client.query("UPDATE teamchat.rooms SET next_sequence=next_sequence+1 WHERE tenant_id=$1 AND room_id=$2",[ctx.tenantId,roomId]);
  const msg=await client.query<{message_id:string}>(
    "INSERT INTO teamchat.messages(tenant_id,room_id,author_uid,client_message_id,body,event_sequence) VALUES ($1,$2,$3,$4,$5,$6) RETURNING message_id::text",
    [ctx.tenantId,roomId,ctx.uid,clientMessageId,body,seq]);
  const messageId=msg.rows[0]?.message_id;if(!messageId)throw new Error("Message insert returned no ID");
  await client.query(
   "INSERT INTO teamchat.room_events(tenant_id,room_id,sequence,type,payload) VALUES ($1,$2,$3,'message',jsonb_build_object('message_id',$4::text,'author_uid',$5::text,'body',$6::text,'client_message_id',$7::text))",
   [ctx.tenantId,roomId,seq,messageId,ctx.uid,body,clientMessageId]);
  // Native tool selection is independent from explicit @AI wakeup detection.
  let aiTurnId:string|undefined;
  if(hasAiMention(body)){
    const job=await client.query<{turn_id:string}>(
      "INSERT INTO teamchat.ai_jobs(tenant_id,room_id,turn_id,user_uid,state,transcript_cutoff,memory_consent) VALUES ($1,$2,gen_random_uuid(),$3,'queued',$4,$5) RETURNING turn_id::text",
      [ctx.tenantId,roomId,ctx.uid,seq,input.allowSharedMemorySave===true]);
    aiTurnId=job.rows[0]?.turn_id;
    if(!aiTurnId)throw new Error("AI job insert failed");
    await client.query("INSERT INTO teamchat.task_outbox(tenant_id,turn_id) VALUES($1,$2)",[ctx.tenantId,aiTurnId]);
  }
  // Trigger NOTIFY fires on commit; listener fetches event from authoritative event table.
  return {roomId,messageId,sequence:seq,authorUid:ctx.uid,body,duplicate:false,...(aiTurnId?{aiTurnId}:{})};
 });
}
/** Same access check on initial history, reconnect replay and manual history requests. */
export async function replayRoom(pool:SqlPool,ctx:TenantContext,roomId:string,after:number,limit=100):Promise<PersistedEvent[] | typeof NO_MATCH>{
 if(!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(limit)||limit<1||limit>500)throw new Error("Invalid replay cursor");
 return inTenantTransaction(pool,ctx,async client=>{
  if(!await authorizeRoom(client,ctx,roomId))return NO_MATCH;
  const result=await client.query<PersistedEvent>(
    "SELECT room_id,sequence,event_id::text,type,turn_id::text,payload,created_at::text FROM teamchat.room_events WHERE tenant_id=$1 AND room_id=$2 AND sequence>$3 ORDER BY sequence ASC LIMIT $4",
    [ctx.tenantId,roomId,after,limit]);
  return result.rows;
 });
}
