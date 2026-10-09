import {createServer,type IncomingMessage,type ServerResponse} from "node:http";
import {randomUUID} from "node:crypto";
import {createPgPool,assertRuntimeDbRole,createFirebaseVerifier,resolveVerifiedIdentity,connectEventListener,type FirebaseIdentityVerifier} from "./database.ts";
import {sendDurableMessage,replayRoom,inTenantTransaction,type SqlPool} from "../persistence/postgres.ts";
import {NO_MATCH,type TenantContext} from "../tenant.ts";
import type {PersistedEvent} from "../persistence/postgres.ts";
import {dispatchJob,validateDispatchConfig} from "./task-dispatch.ts";

interface Socket {readyState:number;bufferedAmount:number;send(data:string):void;close(code?:number,reason?:string):void;ping():void;on(name:string,callback:(...args:any[])=>void):void;}
interface Subscription {roomId:string;token:string;ctx:TenantContext;socket:Socket;cursor:number;busy:boolean;pending:boolean;}
const send=(socket:Socket,frame:Record<string,unknown>)=>{
 if(socket.readyState!==1)return;
 if(socket.bufferedAmount>512_000){socket.close(1013,"Slow client");return;}
 socket.send(JSON.stringify({v:1,...frame}));
};
const id=(v:unknown)=>typeof v==="string"&&/^[-a-z0-9_]{1,128}$/i.test(v);

/** Single source of live data is committed PostgreSQL events, NOT in-process PubSub. */
export class RoomHub {
 private subscriptions=new Map<Socket,Map<string,Subscription>>();
 private byOpaque=new Map<string,Set<Subscription>>();
 private connectionIds=new WeakMap<Socket,string>();
 private closedSockets=new WeakSet<Socket>();
 private readonly pool:SqlPool;
 constructor(pool:SqlPool){this.pool=pool;}
 private detach(sub:Subscription){
  this.byOpaque.get(sub.token)?.delete(sub);
  if(this.byOpaque.get(sub.token)?.size===0)this.byOpaque.delete(sub.token);
 }
 private async hasAccess(sub:Subscription):Promise<boolean>{
  return inTenantTransaction(this.pool,sub.ctx,async c=>{
   const r=await c.query(`SELECT 1 FROM teamchat.room_memberships rm
    JOIN teamchat.user_memberships m USING(tenant_id,firebase_uid)
    WHERE rm.tenant_id=$1 AND rm.room_id=$2 AND rm.firebase_uid=$3 AND m.active=true`,
    [sub.ctx.tenantId,sub.roomId,sub.ctx.uid]);
   return r.rows.length===1;
  });
 }
 remove(socket:Socket){
  this.closedSockets.add(socket);
  for(const s of this.subscriptions.get(socket)?.values()??[]){
   this.detach(s);
   const connectionId=this.connectionIds.get(socket);
   if(connectionId)void inTenantTransaction(this.pool,s.ctx,async c=>{
    await c.query("DELETE FROM teamchat.presence_leases WHERE tenant_id=$1 AND room_id=$2 AND connection_id=$3::uuid",[s.ctx.tenantId,s.roomId,connectionId]);
    await c.query("DELETE FROM teamchat.typing_leases WHERE tenant_id=$1 AND room_id=$2 AND connection_id=$3::uuid",[s.ctx.tenantId,s.roomId,connectionId]);
   }).catch(()=>{});
  }
  this.subscriptions.delete(socket);
 }
 /** A room switch must stop presence renewals and fanout for the old room,
  * without closing the authenticated transport for the remaining rooms. */
 async unsubscribe(socket:Socket,roomId:string){
  const subs=this.subscriptions.get(socket);
  const sub=subs?.get(roomId);
  if(!sub)return;
  subs!.delete(roomId);
  this.detach(sub);
  const connectionId=this.connectionIds.get(socket);
  if(!connectionId)return;
  await inTenantTransaction(this.pool,sub.ctx,async c=>{
   await c.query("DELETE FROM teamchat.presence_leases WHERE tenant_id=$1 AND room_id=$2 AND connection_id=$3::uuid",[sub.ctx.tenantId,roomId,connectionId]);
   await c.query("DELETE FROM teamchat.typing_leases WHERE tenant_id=$1 AND room_id=$2 AND connection_id=$3::uuid",[sub.ctx.tenantId,roomId,connectionId]);
  });
 }
 async subscribe(socket:Socket,ctx:TenantContext,roomId:string,after:number){
  if(this.closedSockets.has(socket)||socket.readyState!==1)throw Error("Closed socket");
  if(!id(roomId)||!Number.isSafeInteger(after)||after<0)throw Error("Invalid subscription");
  const room=await inTenantTransaction(this.pool,ctx,async c=>{
   const r=await c.query<{notify_token:string}>("SELECT r.notify_token::text FROM teamchat.rooms r JOIN teamchat.room_memberships rm ON rm.tenant_id=r.tenant_id AND rm.room_id=r.room_id JOIN teamchat.user_memberships m ON m.tenant_id=rm.tenant_id AND m.firebase_uid=rm.firebase_uid WHERE r.tenant_id=$1 AND r.room_id=$2 AND rm.firebase_uid=$3 AND m.active=true",[ctx.tenantId,roomId,ctx.uid]);return r.rows[0];
  });
  if(!room)throw Error("Room unavailable");
  if(this.closedSockets.has(socket)||socket.readyState!==1)return;
  let subs=this.subscriptions.get(socket);if(!subs){subs=new Map();this.subscriptions.set(socket,subs);}
  if(subs.size>=20&&!subs.has(roomId))throw Error("Too many room subscriptions");
  const old=subs.get(roomId);if(old)this.detach(old);
  const s:Subscription={socket,ctx,roomId,token:room.notify_token,cursor:after,busy:false,pending:false};
  subs.set(roomId,s);
  let connectionId=this.connectionIds.get(socket);
  if(!connectionId){connectionId=randomUUID();this.connectionIds.set(socket,connectionId);}
  await inTenantTransaction(this.pool,ctx,async c=>{
   await c.query("INSERT INTO teamchat.presence_leases(tenant_id,room_id,firebase_uid,connection_id,expires_at) VALUES($1,$2,$3,$4::uuid,now()+interval '60 seconds') ON CONFLICT (tenant_id,room_id,connection_id) DO UPDATE SET expires_at=EXCLUDED.expires_at",[ctx.tenantId,roomId,ctx.uid,connectionId]);
  });
  // The close event may run while the DB lease insert is in flight.
  // Never re-register a dead socket after its cleanup has completed.
  if(this.closedSockets.has(socket)||socket.readyState!==1){
   this.subscriptions.get(socket)?.delete(roomId);
   await inTenantTransaction(this.pool,ctx,async c=>{await c.query(
    "DELETE FROM teamchat.presence_leases WHERE tenant_id=$1 AND room_id=$2 AND connection_id=$3::uuid",
    [ctx.tenantId,roomId,connectionId]);});
   return;
  }
  if(this.subscriptions.get(socket)?.get(roomId)!==s)return;
  if(!this.byOpaque.has(s.token))this.byOpaque.set(s.token,new Set());
  this.byOpaque.get(s.token)!.add(s);
  // Subscribe before replay to close the snapshot/live race.
  await this.pump(s);
  await this.publishPresence(s);
  await this.publishTyping(s);
 }
 async replay(socket:Socket,roomId:string,after:number){
  const sub=this.subscriptions.get(socket)?.get(roomId);
  if(!sub)throw Error("Not subscribed");
  if(!Number.isSafeInteger(after)||after<0)throw Error("Invalid cursor");
  sub.cursor=Math.min(sub.cursor,after);
  await this.pump(sub);
 }
 notify(opaque:string){for(const sub of this.byOpaque.get(opaque)??[])void this.pump(sub).catch(()=>{sub.socket.close(1011,"Subscription unavailable");});}
 async heartbeat(socket:Socket){
  const connectionId=this.connectionIds.get(socket);if(!connectionId)return;
  for(const sub of this.subscriptions.get(socket)?.values()??[]){
   await inTenantTransaction(this.pool,sub.ctx,async c=>{
    const r=await c.query("UPDATE teamchat.presence_leases l SET expires_at=now()+interval '60 seconds' WHERE l.tenant_id=$1 AND l.room_id=$2 AND l.connection_id=$3::uuid AND EXISTS(SELECT 1 FROM teamchat.user_memberships m WHERE m.tenant_id=l.tenant_id AND m.firebase_uid=l.firebase_uid AND m.active=true) RETURNING 1",[sub.ctx.tenantId,sub.roomId,connectionId]);
    if(r.rows.length!==1)throw Error("Presence access revoked");
   });
  }
 }
 async publishPresence(sub:Subscription){
  if(!await this.hasAccess(sub)){sub.socket.close(1008,"Membership revoked");return;}
  const users=await inTenantTransaction(this.pool,sub.ctx,async c=>{
   const r=await c.query(`SELECT l.firebase_uid,MAX(l.expires_at)::text AS expires_at
    FROM teamchat.presence_leases l JOIN teamchat.user_memberships m USING(tenant_id,firebase_uid)
    WHERE l.tenant_id=$1 AND l.room_id=$2 AND l.expires_at>now() AND m.active=true
    GROUP BY l.firebase_uid`,[sub.ctx.tenantId,sub.roomId]);return r.rows;
  });
  if(this.subscriptions.get(sub.socket)?.get(sub.roomId)===sub)send(sub.socket,{type:"presence",roomId:sub.roomId,users});
 }
 async publishTyping(sub:Subscription){
  if(!await this.hasAccess(sub)){sub.socket.close(1008,"Membership revoked");return;}
  const users=await inTenantTransaction(this.pool,sub.ctx,async c=>{
   const r=await c.query(`SELECT l.firebase_uid,MAX(l.expires_at)::text AS expires_at
    FROM teamchat.typing_leases l JOIN teamchat.user_memberships m USING(tenant_id,firebase_uid)
    WHERE l.tenant_id=$1 AND l.room_id=$2 AND l.expires_at>now() AND m.active=true
    GROUP BY l.firebase_uid`,[sub.ctx.tenantId,sub.roomId]);return r.rows;
  });
  if(this.subscriptions.get(sub.socket)?.get(sub.roomId)===sub)send(sub.socket,{type:"typing",roomId:sub.roomId,users});
 }
 notifyPresence(opaque:string,kind:"presence"|"typing"){
  for(const sub of this.byOpaque.get(opaque)??[])void (kind==="presence"?this.publishPresence(sub):this.publishTyping(sub)).catch(()=>sub.socket.close(1011,"Presence unavailable"));
 }
 async typing(socket:Socket,ctx:TenantContext,roomId:string){
  const sub=this.subscriptions.get(socket)?.get(roomId),connectionId=this.connectionIds.get(socket);
  if(!sub||!connectionId)throw Error("Not subscribed");
  await inTenantTransaction(this.pool,ctx,async c=>{
   const a=await c.query("SELECT 1 FROM teamchat.room_memberships r JOIN teamchat.user_memberships u USING(tenant_id,firebase_uid) WHERE r.tenant_id=$1 AND r.room_id=$2 AND r.firebase_uid=$3 AND u.active=true",[ctx.tenantId,roomId,ctx.uid]);
   if(a.rows.length!==1)throw Error("Unauthorized");
   await c.query("INSERT INTO teamchat.typing_leases(tenant_id,room_id,firebase_uid,connection_id,expires_at) VALUES($1,$2,$3,$4::uuid,now()+interval '5 seconds') ON CONFLICT (tenant_id,room_id,connection_id) DO UPDATE SET expires_at=EXCLUDED.expires_at",[ctx.tenantId,roomId,ctx.uid,connectionId]);
  });
 }

 async pump(s:Subscription){
  if(this.subscriptions.get(s.socket)?.get(s.roomId)!==s)return;
  if(s.busy){s.pending=true;return;}
  s.busy=true;
  try {
   do{
    s.pending=false;
    for(;;){
     if(this.subscriptions.get(s.socket)?.get(s.roomId)!==s)return;
     const rows=await replayRoom(this.pool,s.ctx,s.roomId,s.cursor,100);
     if(!Array.isArray(rows)){s.socket.close(1008,"Authorization changed");return;}
     for(const row of rows){
      if(this.subscriptions.get(s.socket)?.get(s.roomId)!==s)return;
      const sequence=Number(row.sequence);if(!Number.isSafeInteger(sequence))throw Error("Bad sequence");
      if(sequence<=s.cursor)continue;
      if(sequence!==s.cursor+1)throw Error("Event history gap");
      if(s.socket.readyState!==1)return;
      send(s.socket,{type:"event",event:{eventId:row.event_id,tenantId:s.ctx.tenantId,roomId:s.roomId,sequence,type:row.type,payload:row.payload}});
      s.cursor=sequence;
     }
     if(rows.length!==100)break;
    }
   }while(s.pending);
  }finally{s.busy=false;}
 }
 closeAll(){for(const socket of this.subscriptions.keys())socket.close(1012,"Listener disconnected");this.subscriptions.clear();this.byOpaque.clear();}
}

export async function createSocketServer(config:{pool:SqlPool;verifier:FirebaseIdentityVerifier;listener:{client:{on(event:string,listener:(msg:any)=>void):void}};origins:string[];port:number}){
 const {pool,verifier,listener,origins,port}=config;
 if(!origins.length||origins.some(origin=>!/^https:\/\/[^/]+$/.test(origin)))
  throw Error("ALLOWED_ORIGINS must contain explicit HTTPS origins");
 const moduleName="ws";const imported=await import(moduleName);
 const WebSocketServer=imported.WebSocketServer??imported.default?.WebSocketServer;
 if(!WebSocketServer)throw Error("WebSocketServer export unavailable");
 const hub=new RoomHub(pool);
 let healthy=true;
 const server=createServer((req:IncomingMessage,res:ServerResponse)=>{void (async()=>{
  if(req.url==="/healthz"){res.writeHead(healthy?200:503,{"content-type":"application/json"});res.end(JSON.stringify({up:healthy}));return;}
  if(req.method==="OPTIONS"&&["/api/me","/api/rooms"].includes(req.url??"")){
   if(!req.headers.origin||!origins.includes(req.headers.origin)){res.writeHead(403);res.end();return;}
   res.writeHead(204,{"Access-Control-Allow-Origin":req.headers.origin,"Access-Control-Allow-Headers":"Authorization,Content-Type","Access-Control-Allow-Methods":"GET,OPTIONS","Vary":"Origin"});res.end();return;
  }
  if(!["/api/me","/api/rooms"].includes(req.url??"")||req.method!=="GET"){res.writeHead(404);res.end();return;}
  if(req.headers.origin&&!origins.includes(req.headers.origin)){res.writeHead(403);res.end();return;}
  res.setHeader("Cache-Control","no-store");res.setHeader("Vary","Origin");
  if(req.headers.origin)res.setHeader("Access-Control-Allow-Origin",req.headers.origin);
  try{
   const raw=/^Bearer (\S+)$/.exec(req.headers.authorization??"");
   if(!raw)throw Error("Unauthorized");
   const uid=await verifier.verify(raw[1]!);const ctx=await resolveVerifiedIdentity(pool,uid);
   const data=req.url==="/api/me"?{uid,tenantId:ctx.tenantId}:
    await inTenantTransaction(pool,ctx,async c=>{
     const rows=await c.query("SELECT r.room_id,r.title FROM teamchat.rooms r JOIN teamchat.room_memberships rm ON rm.tenant_id=r.tenant_id AND rm.room_id=r.room_id WHERE rm.tenant_id=$1 AND rm.firebase_uid=$2 ORDER BY r.room_id",[ctx.tenantId,uid]);return {rooms:rows.rows};
    });
   res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify(data));
  }catch{res.writeHead(401);res.end(JSON.stringify({error:"Unauthorized"}));}
 })();});
 const wss=new WebSocketServer({noServer:true,maxPayload:16_384,perMessageDeflate:false});
 const maxSockets=Number(process.env.MAX_WS_CONNECTIONS??200);
 if(!Number.isSafeInteger(maxSockets)||maxSockets<1||maxSockets>5000)throw Error("MAX_WS_CONNECTIONS must be between 1 and 5000");
 server.on("upgrade",(req,socket,head)=>{
  if(!healthy||req.url!=="/ws"||!origins.includes(req.headers.origin??"")){socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");socket.destroy();return;}
  if(wss.clients.size>=maxSockets){socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");socket.destroy();return;}
  wss.handleUpgrade(req,socket,head,(ws:any)=>wss.emit("connection",ws,req));
 });
 listener.client.on("notification",(message:{channel:string;payload?:string})=>{
  try{const {opaque_room}=JSON.parse(message.payload??"{}");if(typeof opaque_room!=="string")return;
   if(message.channel==="teamchat_events")hub.notify(opaque_room);
   if(message.channel==="teamchat_presence")hub.notifyPresence(opaque_room,"presence");
   if(message.channel==="teamchat_typing")hub.notifyPresence(opaque_room,"typing");
  }catch{}
 });
 listener.client.on("error",()=>{healthy=false;hub.closeAll();});listener.client.on("end",()=>{healthy=false;hub.closeAll();});
 wss.on("connection",(socket:Socket)=>{
  let ctx:TenantContext|null=null;let alive=true;let authDeadline=setTimeout(()=>socket.close(1008,"Authentication required"),8000);
  let authenticating=false;let activeCommands=0;let lastTypingAt=0;
  const lifespan=setTimeout(()=>socket.close(1001,"Reauthenticate"),45*60_000);
  const heartbeat=setInterval(()=>{if(!alive){socket.close(1001,"Heartbeat timeout");return;}alive=false;socket.ping();},25_000);
  const leaseRenewal=setInterval(()=>{if(ctx)void hub.heartbeat(socket).catch(()=>socket.close(1008,"Membership revoked"));},20_000);
  socket.on("pong",()=>{alive=true;});
  socket.on("close",()=>{clearTimeout(authDeadline);clearTimeout(lifespan);clearInterval(heartbeat);clearInterval(leaseRenewal);hub.remove(socket);});
  socket.on("message",(data:unknown)=>{void (async()=>{
   try{
    if(++activeCommands>8)throw Error("Too many concurrent commands");
    const frame=JSON.parse(String(data));if(!frame||typeof frame!=="object"||frame.v!==1)throw Error("Unsupported frame");
    if(frame.type==="auth"){
     if(ctx||authenticating)throw Error("Already authenticating or authenticated");
     authenticating=true;
     const uid=await verifier.verify(frame.token);
     ctx=await resolveVerifiedIdentity(pool,uid);
     clearTimeout(authDeadline);send(socket,{type:"auth_ok"});return;
    }
    if(!ctx)throw Error("Unauthorized");
    if(frame.type==="subscribe")await hub.subscribe(socket,ctx,frame.roomId,frame.after??0);
    else if(frame.type==="unsubscribe"){
     if(!id(frame.roomId))throw Error("Invalid room");
     await hub.unsubscribe(socket,frame.roomId);
    }
    else if(frame.type==="replay")await hub.replay(socket,frame.roomId,frame.after);
    else if(frame.type==="send_message"){
     const result=await sendDurableMessage(pool,ctx,{roomId:frame.roomId,clientMessageId:frame.clientMessageId,body:frame.body,allowSharedMemorySave:frame.allowSharedMemorySave===true});
     if("found" in result)throw Error("Room unavailable");
     send(socket,{type:"message_ack",clientMessageId:frame.clientMessageId,sequence:result.sequence,aiTurnId:result.aiTurnId});
     if(result.aiTurnId&&!result.duplicate)void dispatchJob(pool,ctx,result.aiTurnId).catch(error=>{
      // Task outbox is durable; authenticated Cloud Scheduler dispatch endpoint retries later.
      console.error("AI task dispatch pending",result.aiTurnId,String(error));
      send(socket,{type:"error",message:"AI queued; dispatcher unavailable"});
     });
    }else if(frame.type==="typing"){
     // Typing is ephemeral; clients must not treat it as durable transcript history.
     if(!id(frame.roomId))throw Error("Invalid room");
     if(Date.now()-lastTypingAt<1500)return;
     lastTypingAt=Date.now();
     await hub.typing(socket,ctx,frame.roomId);
    }else throw Error("Unsupported command");
   }catch(error){console.error("Socket command rejected",error instanceof Error?error.name:"UnknownError");send(socket,{type:"error",message:"Unable to complete request"});}
   finally{activeCommands--;}
  })();});
 });
 await new Promise<void>((resolve,reject)=>server.listen(port,()=>resolve()).once("error",reject));
 return {server,wss,hub,async close(){
  healthy=false;
  hub.closeAll();
  // Include unauthenticated sockets: server.close() alone does not close
  // upgraded WebSockets and could hang indefinitely during a deployment.
  for(const client of wss.clients){try{client.terminate();}catch{}}
  await new Promise<void>(resolve=>wss.close(()=>resolve()));
  await new Promise<void>(resolve=>server.close(()=>resolve()));
 }};
}
export async function startApi(){
 validateDispatchConfig(); // fail before admitting chats whose AI tasks cannot be dispatched
 const pool=await createPgPool();
 let listener:Awaited<ReturnType<typeof connectEventListener>>|undefined;
 try{
  await assertRuntimeDbRole(pool);
  const verifier=await createFirebaseVerifier();listener=await connectEventListener();
  const origins=(process.env.ALLOWED_ORIGINS??"").split(",").map(x=>x.trim()).filter(Boolean);
  const running=await createSocketServer({pool,verifier,listener,origins,port:Number(process.env.PORT||8080)});
  const listenerHandle=listener;
  return {...running,async close(){await running.close();await listenerHandle.close();await pool.end();}};
 }catch(e){
  if(listener)try{await listener.close();}catch{}
  await pool.end();throw e;
 }
}
