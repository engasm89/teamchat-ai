import test from "node:test";
import assert from "node:assert/strict";
import {fencedUpdate,failExhaustedJob} from "../src/server/ai-jobs.ts";
import {resolvedContext} from "../src/tenant.ts";
import type {SqlClient,SqlPool,QueryResult} from "../src/persistence/postgres.ts";
const ctx=resolvedContext("worker-author","northside-outfitters");
const turn="00000000-0000-4000-a000-000000000001";
class Mock implements SqlClient {
 trace:string[]=[];
 private readonly respond:(sql:string)=>unknown[];
 constructor(respond:(sql:string)=>unknown[]){this.respond=respond;}
 async query<T=Record<string,unknown>>(sql:string):Promise<QueryResult<T>>{
  this.trace.push(sql);const rows=this.respond(sql) as T[];return {rows,rowCount:rows.length};
 }
 release(){}
}
const pool=(m:Mock):SqlPool=>({connect:async()=>m});
test("fenced write extends live lease before data mutation",async()=>{
 const m=new Mock(sql=>sql.includes("state='running' AND lease_expires_at>now() FOR UPDATE")?[{ok:1}]:[]);
 await fencedUpdate(pool(m),ctx,turn,2,async c=>{await c.query("INSERT INTO teamchat.answer_blocks -- mock");});
 const renewal=m.trace.findIndex(s=>s.includes("SET lease_expires_at=now()+interval '4 minutes'"));
 const write=m.trace.findIndex(s=>s.includes("INSERT INTO teamchat.answer_blocks"));
 assert.ok(renewal>=0&&renewal<write);
 assert.equal(m.trace.at(-1),"COMMIT");
});
test("exhausted AI job produces one durable failure event and terminal state",async()=>{
 const m=new Mock(sql=>sql.includes("attempts>=5 AND state='running'")?[{room_id:"assortment-review"}]:sql.includes("SELECT next_sequence")?[{next_sequence:"17"}]:[]);
 assert.equal(await failExhaustedJob(pool(m),ctx,turn),true);
 assert.ok(m.trace.some(s=>s.includes("'ai_failed'"))===false); // event type is parameterized
 assert.ok(m.trace.some(s=>s.includes("INSERT INTO teamchat.room_events")));
 assert.ok(m.trace.some(s=>s.includes("SET state='failed'")));
});
