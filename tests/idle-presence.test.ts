import {test} from "node:test";
import assert from "node:assert/strict";
import {RoomHub} from "../src/server/http-socket.ts";
import {resolvedContext} from "../src/tenant.ts";
import type {SqlPool,SqlClient,QueryResult} from "../src/persistence/postgres.ts";

test("idle lease renewals do not repeatedly resend unchanged presence",async()=>{
 let online=["member-1"];
 const c:SqlClient={release(){},async query<T>(sql:string):Promise<QueryResult<T>>{
  if(sql.includes("SELECT r.notify_token"))return {rows:[{notify_token:"opaque"}] as T[],rowCount:1};
  if(sql.includes("SELECT 1 FROM teamchat.room_memberships"))return {rows:[{ok:true}] as T[],rowCount:1};
  if(sql.includes("SELECT l.firebase_uid,MAX(l.expires_at)"))return {rows:online.map(firebase_uid=>({firebase_uid,expires_at:"2099-01-01"})) as T[],rowCount:online.length};
  return {rows:[],rowCount:0};
 }};
 const pool:SqlPool={connect:async()=>c};
 const frames:any[]=[];
 const sock:any={readyState:1,bufferedAmount:0,send(data:string){frames.push(JSON.parse(data));},close(){}};
 const hub=new RoomHub(pool);
 await hub.subscribe(sock,resolvedContext("member-1","northside-outfitters"),"assortment-review",0);
 assert.equal(frames.filter(x=>x.type==="presence").length,1);
 await hub.publishPresence((hub as any).subscriptions.get(sock).get("assortment-review"));
 await hub.publishPresence((hub as any).subscriptions.get(sock).get("assortment-review"));
 assert.equal(frames.filter(x=>x.type==="presence").length,1);
 online=["member-1","member-2"];
 await hub.publishPresence((hub as any).subscriptions.get(sock).get("assortment-review"));
 assert.equal(frames.filter(x=>x.type==="presence").length,2);
 hub.remove(sock);
});
