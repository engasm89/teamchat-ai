import test from "node:test";
import assert from "node:assert/strict";
import {renewJobLease,requeueJob} from "../src/server/ai-jobs.ts";
import {resolvedContext} from "../src/tenant.ts";
import type {SqlPool,SqlClient,QueryResult} from "../src/persistence/postgres.ts";
const ctx=resolvedContext("worker-owner","northside-outfitters");
test("job renewal and retry are bounded by tenant, turn ID and fencing token",async()=>{
 const calls:Array<{sql:string;args:unknown[]}>=[];
 const client:SqlClient={release(){},async query<T=Record<string,unknown>>(sql:string,args:unknown[]=[]):Promise<QueryResult<T>>{
  calls.push({sql,args});return {rows:sql.includes("RETURNING 1")?[{ok:1}] as T[]:[],rowCount:1};
 }};
 const pool:SqlPool={connect:async()=>client};
 assert.equal(await renewJobLease(pool,ctx,"00000000-0000-0000-0000-000000000001",7),true);
 await requeueJob(pool,ctx,"00000000-0000-0000-0000-000000000001",7);
 assert.equal(calls.filter(c=>c.sql.includes("AND fencing_token=$3")).length,2);
 assert.ok(calls.every(c=>c.sql.includes("UPDATE teamchat.ai_jobs")?c.args[0]===ctx.tenantId:true));
});
import {failExhaustedDispatch} from "../src/server/ai-jobs.ts";
test("dispatch exhaustion emits a durable failure event and fails job and outbox",async()=>{
 const actions:string[]=[];
 const client:SqlClient={release(){},async query<T=Record<string,unknown>>(sql:string,args:unknown[]=[]):Promise<QueryResult<T>>{
  actions.push(sql);
  const rows=sql.includes("AND o.dispatch_attempts>=12")?[{room_id:"assortment-review"}]:
   sql.includes("SELECT next_sequence::text")?[{next_sequence:"12"}]:[];
  return {rows:rows as T[],rowCount:rows.length};
 }};
 const didFail=await failExhaustedDispatch({connect:async()=>client},ctx,"00000000-0000-0000-0000-000000000002");
 assert.equal(didFail,true);
 assert.ok(actions.some(x=>x.includes("'ai_failed'")||x.includes("room_events")));
 assert.ok(actions.some(x=>x.includes("UPDATE teamchat.ai_jobs SET state='failed'")));
 assert.ok(actions.some(x=>x.includes("UPDATE teamchat.task_outbox SET state='failed'")));
});
