import test from "node:test";
import assert from "node:assert/strict";
import {resolveVerifiedIdentity,assertRuntimeDbRole} from "../src/server/database.ts";
import {resolvedContext} from "../src/tenant.ts";
import {RoomHub} from "../src/server/http-socket.ts";
import type {SqlPool,SqlClient,QueryResult} from "../src/persistence/postgres.ts";

class Mock implements SqlClient{
 public operations:Array<{sql:string,args:unknown[]}>=[];
 private responder:(sql:string,args:unknown[])=>unknown[];
 constructor(responder:(sql:string,args:unknown[])=>unknown[]){this.responder=responder;}
 async query<T=Record<string,unknown>>(sql:string,args:unknown[]=[]):Promise<QueryResult<T>>{
  this.operations.push({sql,args});const rows=this.responder(sql,args) as T[];return {rows,rowCount:rows.length};
 }
 release(){}
}
const pool=(m:Mock):SqlPool=>({connect:async()=>m});
test("verified UID maps through restricted function and checks active membership",async()=>{
 const m=new Mock((sql)=>sql.includes("resolve_tenant_for_uid")?[{tenant_id:"northside-outfitters"}]:sql.includes("user_memberships")?[{ok:1}]:[]);
 const ctx=await resolveVerifiedIdentity(pool(m),"signed-user");
 assert.equal(ctx.tenantId,"northside-outfitters");assert.equal(ctx.uid,"signed-user");
 assert.ok(m.operations.some(x=>x.sql.includes("set_config")&&x.args[0]==="northside-outfitters"));
 assert.ok(!m.operations.some(x=>x.sql.includes("FROM teamchat.auth_directory")));
});
test("unknown and deactivated identities never obtain context",async()=>{
 const missing=new Mock(()=>[]);
 await assert.rejects(resolveVerifiedIdentity(pool(missing),"nope"),/Unauthorized/);
 const inactive=new Mock(sql=>sql.includes("resolve_tenant_for_uid")?[{tenant_id:"valley-home-goods"}]:[]);
 await assert.rejects(resolveVerifiedIdentity(pool(inactive),"disabled"),/Unauthorized/);
 assert.ok(inactive.operations.some(x=>x.sql==="ROLLBACK"));
});
test("API/worker startup fails closed on owner, superuser and bypassrls roles",async()=>{
 for(const role of [
  {role_name:"schema_owner",rolsuper:false,rolbypassrls:false,table_owner:"schema_owner"},
  {role_name:"teamchat_api",rolsuper:true,rolbypassrls:false,table_owner:"migration_owner"},
  {role_name:"teamchat_api",rolsuper:false,rolbypassrls:true,table_owner:"migration_owner"},
 ]){
  await assert.rejects(assertRuntimeDbRole(pool(new Mock(()=>[role]))),/Refusing privileged/);
 }
 await assert.doesNotReject(assertRuntimeDbRole(pool(new Mock(()=>[{role_name:"teamchat_api",rolsuper:false,rolbypassrls:false,table_owner:"migration_owner"}]))));
});
test("websocket fanout requires authorized subscription; different opaque room never receives data",async()=>{
 const m=new Mock((sql,args)=>{
  if(sql.includes("SELECT r.notify_token"))return [{notify_token:"opaque-north"}];
  if(sql.includes("FROM teamchat.room_memberships"))return [{ok:1}];
  if(sql.includes("FROM teamchat.room_events"))return args[2]===0?[{room_id:"assortment-review",sequence:"1",event_id:"ev-1",type:"message",payload:{body:"verified"}}]:[];
  return [];
 });
 const hub=new RoomHub(pool(m));
 const sent:any[]=[];const sock:any={readyState:1,bufferedAmount:0,send:(s:string)=>sent.push(JSON.parse(s)),close:()=>{}};
 await hub.subscribe(sock,resolvedContext("signed-user","northside-outfitters"),"assortment-review",0);
 assert.equal(sent.filter(f=>f.type==="event").length,1);assert.equal(sent.find(f=>f.type==="event").event.tenantId,"northside-outfitters");
 hub.notify("opaque-valley");
 await new Promise(r=>setImmediate(r));
 assert.equal(sent.filter(f=>f.type==="event").length,1);
 hub.remove(sock);
 assert.equal((hub as any).subscriptions.size,0);
});
test("socket replay denied room never leaks message data",async()=>{
 const m=new Mock(sql=>sql.includes("SELECT r.notify_token")?[]:[]);
 const hub=new RoomHub(pool(m));
 await assert.rejects(hub.subscribe({readyState:1} as any,resolvedContext("signed-user","northside-outfitters"),"foreign-room",0),/Room unavailable/);
 assert.equal(m.operations.some(x=>x.sql.includes("FROM teamchat.room_events")),false);
});
