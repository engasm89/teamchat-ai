import test from "node:test";
import assert from "node:assert/strict";
import {resolvedContext,NO_MATCH} from "../src/tenant.ts";
import {inTenantTransaction,sendDurableMessage,replayRoom,type SqlClient,type SqlPool,type QueryResult} from "../src/persistence/postgres.ts";
const ctx=resolvedContext("firebase-confirmed-user","northside-outfitters");
class FakeClient implements SqlClient{
 public trace:{sql:string,args:unknown[]}[]=[];public released=false;
 private readonly respond:(sql:string,args:unknown[])=>unknown[];
 constructor(respond:(sql:string,args:unknown[])=>unknown[]){this.respond=respond;}
 async query<T=Record<string,unknown>>(sql:string,args:unknown[]=[]):Promise<QueryResult<T>> {
  this.trace.push({sql,args});const rows=this.respond(sql,args) as T[];return {rows,rowCount:rows.length};
 }
 release(){this.released=true;}
}
const poolFor=(c:SqlClient):SqlPool=>({connect:async()=>c});
test("transaction sets local verified tenant and always releases client",async()=>{
 const client=new FakeClient(()=>[]);await inTenantTransaction(poolFor(client),ctx,async()=>"ok");
 assert.equal(client.trace[0]!.sql,"BEGIN");
 assert.deepEqual(client.trace[1]!.args,["northside-outfitters"]);
 assert.match(client.trace[1]!.sql,/set_config/);
 assert.equal(client.trace.at(-1)!.sql,"COMMIT");assert.equal(client.released,true);
});
test("transaction rolls back and releases on error",async()=>{
 const client=new FakeClient(()=>[]);
 await assert.rejects(inTenantTransaction(poolFor(client),ctx,async()=>{throw new Error("boom")}),/boom/);
 assert.equal(client.trace.at(-1)!.sql,"ROLLBACK");assert.equal(client.released,true);
});
test("foreign-room request fails before querying event history",async()=>{
 const client=new FakeClient(()=>[]);
 const result=await replayRoom(poolFor(client),ctx,"foreign-room",0);
 assert.deepEqual(result,NO_MATCH);
 assert.ok(!client.trace.some(e=>e.sql.includes("FROM teamchat.room_events")));
});
test("durable send uses authorization, dedupe, room lock, durable insert then commit",async()=>{
 const client=new FakeClient(sql=>{
  if(sql.includes("FROM teamchat.room_memberships"))return [{one:1}];
  if(sql.includes("FROM teamchat.messages"))return [];
  if(sql.includes("SELECT next_sequence"))return [{next_sequence:"1"}];
  if(sql.includes("RETURNING message_id"))return [{message_id:"uuid-1"}];
  return [];
 });
 const result=await sendDurableMessage(poolFor(client),ctx,{roomId:"assortment-review",clientMessageId:"client-1",body:"Hello"});
 assert.deepEqual(result,{roomId:"assortment-review",messageId:"uuid-1",sequence:1,authorUid:ctx.uid,body:"Hello",duplicate:false});
 const statements=client.trace.map(x=>x.sql);
 assert.ok(statements.findIndex(x=>x.includes("pg_advisory_xact_lock"))<statements.findIndex(x=>x.includes("FOR UPDATE")));
 assert.ok(statements.findIndex(x=>x.includes("INSERT INTO teamchat.messages"))<statements.findIndex(x=>x.includes("INSERT INTO teamchat.room_events")));
 assert.equal(statements.at(-1),"COMMIT");
});
test("retries same clientMessageId do not allocate new sequence",async()=>{
 const client=new FakeClient(sql=>{
  if(sql.includes("FROM teamchat.room_memberships"))return [{one:1}];
  if(sql.includes("FROM teamchat.messages"))return [{room_id:"room-1",body:"Hi",message_id:"msg-1",event_sequence:"7"}];
  return [];
 });
 const result=await sendDurableMessage(poolFor(client),ctx,{roomId:"room-1",clientMessageId:"same-1",body:"Hi"});
 assert.ok("duplicate" in result&&result.duplicate);
 assert.ok(!client.trace.some(x=>x.sql.includes("UPDATE teamchat.rooms")));
});
test("replaying an AI message cannot silently change shared-memory consent",async()=>{
 const turnId="00000000-0000-4000-a000-000000000001";
 const client=new FakeClient(sql=>{
  if(sql.includes("FROM teamchat.room_memberships"))return [{one:1}];
  if(sql.includes("FROM teamchat.messages m LEFT JOIN"))return [{room_id:"room-1",body:"@AI remember this",message_id:"msg-1",event_sequence:"7",turn_id:turnId,memory_consent:true}];
  return [];
 });
 const same=await sendDurableMessage(poolFor(client),ctx,{roomId:"room-1",clientMessageId:"same-1",body:"@AI remember this",allowSharedMemorySave:true});
 assert.ok("aiTurnId" in same&&same.aiTurnId===turnId);
 await assert.rejects(sendDurableMessage(poolFor(client),ctx,{roomId:"room-1",clientMessageId:"same-1",body:"@AI remember this",allowSharedMemorySave:false}),/Conflicting duplicate/);
 assert.equal(client.trace.filter(x=>x.sql.includes("INSERT INTO teamchat.ai_jobs")).length,0);
});
test("@AI message commits durable AI job and outbox atomically before acknowledgement",async()=>{
 const client=new FakeClient(sql=>{
  if(sql.includes("FROM teamchat.room_memberships"))return [{one:1}];
  if(sql.includes("FROM teamchat.messages"))return [];
  if(sql.includes("SELECT next_sequence"))return [{next_sequence:"42"}];
  if(sql.includes("RETURNING message_id"))return [{message_id:"uuid-message"}];
  if(sql.includes("RETURNING turn_id"))return [{turn_id:"00000000-0000-4000-a000-000000000001"}];
  return [];
 });
 const result=await sendDurableMessage(poolFor(client),ctx,{roomId:"assortment-review",clientMessageId:"ai-1",body:"@AI show catalog codes",allowSharedMemorySave:false});
 assert.ok("aiTurnId" in result&&result.aiTurnId);
 const statements=client.trace.map(x=>x.sql);
 assert.ok(statements.some(x=>x.includes("INSERT INTO teamchat.ai_jobs")));
 assert.ok(statements.findIndex(x=>x.includes("INSERT INTO teamchat.ai_jobs"))<statements.findIndex(x=>x.includes("INSERT INTO teamchat.task_outbox")));
 assert.equal(statements.at(-1),"COMMIT");
});
