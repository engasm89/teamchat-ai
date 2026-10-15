import {randomUUID} from "node:crypto";
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
  const room=await client.query<{next_sequence:string;ai_chat:boolean}>("SELECT next_sequence::text,ai_chat FROM teamchat.rooms WHERE tenant_id=$1 AND room_id=$2 FOR UPDATE",[ctx.tenantId,roomId]);
  if(!room.rows.length)return NO_MATCH;
  const aiChat=room.rows[0]!.ai_chat===true;
  const seq=Number(room.rows[0]!.next_sequence);
  if(!Number.isSafeInteger(seq)||seq<1)throw new Error("Invalid room sequence");
  await client.query("UPDATE teamchat.rooms SET next_sequence=next_sequence+1 WHERE tenant_id=$1 AND room_id=$2",[ctx.tenantId,roomId]);
  const msg=await client.query<{message_id:string}>(
    "INSERT INTO teamchat.messages(tenant_id,room_id,author_uid,client_message_id,body,event_sequence) VALUES ($1,$2,$3,$4,$5,$6) RETURNING message_id::text",
    [ctx.tenantId,roomId,ctx.uid,clientMessageId,body,seq]);
  const messageId=msg.rows[0]?.message_id;if(!messageId)throw new Error("Message insert returned no ID");
  // Native tool selection is independent from wakeup: an explicit @AI in any
  // room, or any message in an AI chat. One insert, so never two jobs. The
  // message event names its turn so every client can show the pending reply.
  const wakeTurn=aiChat||hasAiMention(body)?randomUUID():null;
  await client.query(
   "INSERT INTO teamchat.room_events(tenant_id,room_id,sequence,type,payload) VALUES ($1,$2,$3,'message',jsonb_strip_nulls(jsonb_build_object('message_id',$4::text,'author_uid',$5::text,'body',$6::text,'client_message_id',$7::text,'ai_turn_id',$8::text)))",
   [ctx.tenantId,roomId,seq,messageId,ctx.uid,body,clientMessageId,wakeTurn]);
  let aiTurnId:string|undefined;
  if(wakeTurn){
    const job=await client.query<{turn_id:string}>(
      "INSERT INTO teamchat.ai_jobs(tenant_id,room_id,turn_id,user_uid,state,transcript_cutoff,memory_consent) VALUES ($1,$2,$3::uuid,$4,'queued',$5,$6) RETURNING turn_id::text",
      [ctx.tenantId,roomId,wakeTurn,ctx.uid,seq,input.allowSharedMemorySave===true]);
    aiTurnId=job.rows[0]?.turn_id;
    if(!aiTurnId)throw new Error("AI job insert failed");
    await client.query("INSERT INTO teamchat.task_outbox(tenant_id,turn_id) VALUES($1,$2)",[ctx.tenantId,aiTurnId]);
  }
  // Trigger NOTIFY fires on commit; listener fetches event from authoritative event table.
  return {roomId,messageId,sequence:seq,authorUid:ctx.uid,body,duplicate:false,...(aiTurnId?{aiTurnId}:{})};
 });
}
export interface RoomSummary {room_id:string;title:string;ai_chat:boolean;visibility:string}
export interface RoomDirectory {tenantId:string;rooms:RoomSummary[];members:Array<{firebase_uid:string;display_name:string}>;me:{display_name:string}}
/** Rooms the caller can open, and the active members of the caller's own
 * tenant (for display names). Rechecks active membership in the same transaction. */
export async function listRoomDirectory(pool:SqlPool,ctx:TenantContext):Promise<RoomDirectory|typeof NO_MATCH>{
 return inTenantTransaction(pool,ctx,async c=>{
  const me=await c.query<{display_name:string}>("SELECT display_name FROM teamchat.user_memberships WHERE tenant_id=$1 AND firebase_uid=$2 AND active=true",[ctx.tenantId,ctx.uid]);
  if(me.rows.length!==1)return NO_MATCH;
  const rooms=await c.query<RoomSummary>(`SELECT r.room_id,r.title,r.ai_chat,r.visibility FROM teamchat.rooms r
    JOIN teamchat.room_memberships rm ON rm.tenant_id=r.tenant_id AND rm.room_id=r.room_id
    WHERE rm.tenant_id=$1 AND rm.firebase_uid=$2 ORDER BY r.visibility='tenant',r.created_at NULLS FIRST,r.room_id`,[ctx.tenantId,ctx.uid]);
  const members=await c.query<{firebase_uid:string;display_name:string}>("SELECT firebase_uid,display_name FROM teamchat.user_memberships WHERE tenant_id=$1 AND active=true ORDER BY display_name",[ctx.tenantId]);
  return {tenantId:ctx.tenantId,rooms:rooms.rows,members:members.rows,me:me.rows[0]!};
 });
}
export class RoomCreationError extends Error{readonly status:400|409|429;constructor(message:string,status:400|409|429){super(message);this.status=status;}}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validateRoomRequest(input:unknown):{title:string;aiChat:boolean;clientRequestId:string}{
 if(!input||typeof input!=="object"||Array.isArray(input))throw new RoomCreationError("Invalid request",400);
 const x=input as Record<string,unknown>;
 if(Object.keys(x).some(k=>!["title","aiChat","clientRequestId"].includes(k)))throw new RoomCreationError("Invalid request",400);
 const title=typeof x.title==="string"?x.title.replace(/\s+/g," ").trim():"";
 if(!title||title.length>80||/[\u0000-\u001f\u007f]/.test(title))throw new RoomCreationError("Chat name must be 1–80 characters",400);
 if(typeof x.aiChat!=="boolean")throw new RoomCreationError("Invalid request",400);
 if(typeof x.clientRequestId!=="string"||!UUID.test(x.clientRequestId))throw new RoomCreationError("Invalid request",400);
 return {title,aiChat:x.aiChat,clientRequestId:x.clientRequestId.toLowerCase()};
}
/** A tenant-wide chat: every active member of the caller's tenant joins it now,
 * and members added or reactivated later join through the 008 trigger. The
 * room ID is server-generated; a repeated clientRequestId returns the same room.
 * RLS (tenant_guard plus 008's restrictive insert policies) enforces the same
 * rules in PostgreSQL for the runtime role. */
export async function createTenantChat(pool:SqlPool,ctx:TenantContext,input:unknown,newRoomId:()=>string):Promise<{room:RoomSummary;created:boolean}|typeof NO_MATCH>{
 const req=validateRoomRequest(input);
 return inTenantTransaction(pool,ctx,async c=>{
  await c.query("SELECT set_config('app.uid',$1,true)",[ctx.uid]);
  const me=await c.query("SELECT 1 FROM teamchat.user_memberships WHERE tenant_id=$1 AND firebase_uid=$2 AND active=true",[ctx.tenantId,ctx.uid]);
  if(me.rows.length!==1)return NO_MATCH;
  const existing=async()=>{
   const r=await c.query<RoomSummary>("SELECT room_id,title,ai_chat,visibility FROM teamchat.rooms WHERE tenant_id=$1 AND created_by=$2 AND client_request_id=$3::uuid",[ctx.tenantId,ctx.uid,req.clientRequestId]);
   const room=r.rows[0];
   if(room&&(room.title!==req.title||room.ai_chat!==req.aiChat))throw new RoomCreationError("Conflicting duplicate request",409);
   return room;
  };
  const prior=await existing();if(prior)return {room:prior,created:false};
  const recent=await c.query<{n:string}>("SELECT count(*)::text AS n FROM teamchat.rooms WHERE tenant_id=$1 AND created_by=$2 AND created_at>now()-interval '1 hour'",[ctx.tenantId,ctx.uid]);
  if(Number(recent.rows[0]?.n??0)>=20)throw new RoomCreationError("Too many new chats; try again later",429);
  await c.query("SELECT pg_advisory_xact_lock(teamchat.tenant_rooms_lock_key($1))",[ctx.tenantId]);
  const roomId=newRoomId();
  if(!/^[-a-z0-9_]{1,128}$/.test(roomId))throw Error("Invalid generated room ID");
  const inserted=await c.query<RoomSummary>(`INSERT INTO teamchat.rooms(tenant_id,room_id,title,ai_chat,visibility,created_by,client_request_id,created_at)
    VALUES($1,$2,$3,$4,'tenant',$5,$6::uuid,now()) ON CONFLICT (tenant_id,created_by,client_request_id) DO NOTHING
    RETURNING room_id,title,ai_chat,visibility`,[ctx.tenantId,roomId,req.title,req.aiChat,ctx.uid,req.clientRequestId]);
  if(!inserted.rows.length){const again=await existing();if(again)return {room:again,created:false};throw Error("Room creation conflict");}
  await c.query(`INSERT INTO teamchat.room_memberships(tenant_id,room_id,firebase_uid)
    SELECT tenant_id,$2,firebase_uid FROM teamchat.user_memberships WHERE tenant_id=$1 AND active=true`,[ctx.tenantId,roomId]);
  return {room:inserted.rows[0]!,created:true};
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
