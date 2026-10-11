import test from "node:test";
import assert from "node:assert/strict";
import {SqlToolExecutor} from "../src/server/sql-tools.ts";
import {SourceLedger} from "../src/grounding.ts";
import {resolvedContext} from "../src/tenant.ts";
import type {SqlClient,SqlPool,QueryResult} from "../src/persistence/postgres.ts";

const ctx=resolvedContext("buyer-a","northside-outfitters");
const vector=new Array(768).fill(0).map((_,i)=>i===0?1:0);

test("shared memory commits a version-one history row in the same tenant transaction",async()=>{
 const trace:string[]=[];
 const client:SqlClient={release(){},async query<T=Record<string,unknown>>(sql:string):Promise<QueryResult<T>>{
  trace.push(sql);
  const rows=sql.includes("SELECT 1 FROM teamchat.room_memberships")?[{ok:1}]:
   sql.includes("SELECT 1 FROM teamchat.ai_jobs")?[{ok:1}]:
   sql.includes("INSERT INTO teamchat.memories")?[{memory_id:"memory-1",key:"buyer-decision",value:{choice:"retain"},created_by:ctx.uid,created_at:"2026-10-09",source_room_id:"assortment-review"}]:[];
  return {rows:rows as T[],rowCount:rows.length};
 }};
 const pool:SqlPool={connect:async()=>client};
 const result=await new SqlToolExecutor(pool,{modelId:"embed-mock",embed:async()=>vector}).execute(
  ctx,"assortment-review","save_memory",{key:"buyer-decision",room:"assortment-review",value_json:JSON.stringify({choice:"retain"})},new SourceLedger(ctx,"turn-1"),true,
  {turnId:"00000000-0000-4000-a000-000000000001",fence:4});
 assert.equal((result as {saved:boolean}).saved,true);
 const main=trace.findIndex(s=>s.includes("INSERT INTO teamchat.memories"));
 const history=trace.findIndex(s=>s.includes("INSERT INTO teamchat.memory_versions"));
 assert.ok(main>=0&&history>main);
 assert.equal(trace.at(-1),"COMMIT");
});

test("memory history write failure rolls back the memory creation",async()=>{
 const trace:string[]=[];
 const client:SqlClient={release(){},async query<T=Record<string,unknown>>(sql:string):Promise<QueryResult<T>>{
  trace.push(sql);
  if(sql.includes("INSERT INTO teamchat.memory_versions"))throw Error("history unavailable");
  const rows=sql.includes("SELECT 1 FROM teamchat.room_memberships")?[{ok:1}]:
   sql.includes("SELECT 1 FROM teamchat.ai_jobs")?[{ok:1}]:
   sql.includes("INSERT INTO teamchat.memories")?[{memory_id:"memory-1",key:"buyer-decision",value:{choice:"retain"},created_by:ctx.uid}]:[];
  return {rows:rows as T[],rowCount:rows.length};
 }};
 await assert.rejects(new SqlToolExecutor({connect:async()=>client},{modelId:"embed-mock",embed:async()=>vector}).execute(
  ctx,"assortment-review","save_memory",{key:"buyer-decision",room:"assortment-review",value_json:JSON.stringify({choice:"retain"})},new SourceLedger(ctx,"turn-2"),true,
  {turnId:"00000000-0000-4000-a000-000000000002",fence:5}),/history unavailable/);
 assert.equal(trace.at(-1),"ROLLBACK");
});
