import test from "node:test";
import assert from "node:assert/strict";
import {RoomHub} from "../src/server/http-socket.ts";
import {resolvedContext} from "../src/tenant.ts";
import type {SqlPool,SqlClient,QueryResult} from "../src/persistence/postgres.ts";

test("disconnect during lease INSERT does not resurrect a socket subscription",async()=>{
 let insertStarted=()=>{};
 const started=new Promise<void>(resolve=>{insertStarted=resolve;});
 let finishInsert=()=>{};
 const allowInsert=new Promise<void>(resolve=>{finishInsert=resolve;});
 const commands:string[]=[];
 const c:SqlClient={release(){},async query<T=Record<string,unknown>>(sql:string,args:unknown[]=[]):Promise<QueryResult<T>>{
  commands.push(sql);
  if(sql.includes("SELECT r.notify_token"))return {rows:[{notify_token:"opaque-room"}] as T[],rowCount:1};
  if(sql.includes("INSERT INTO teamchat.presence_leases")){insertStarted();await allowInsert;}
  return {rows:[],rowCount:0};
 }};
 const pool:SqlPool={connect:async()=>c};
 const hub=new RoomHub(pool);
 const socket:any={readyState:1,bufferedAmount:0,send(){},close(){this.readyState=3;}};
 const work=hub.subscribe(socket,resolvedContext("p1","northside-outfitters"),"assortment-review",0);
 await started; socket.close();hub.remove(socket);finishInsert(); await work;
 assert.equal((hub as any).subscriptions.size,0);
 assert.equal((hub as any).byOpaque.size,0);
 assert.ok(commands.some(x=>x.includes("DELETE FROM teamchat.presence_leases")));
});
