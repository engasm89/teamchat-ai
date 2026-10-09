import test from "node:test";
import assert from "node:assert/strict";
import {claimJob,persistToolPlan,persistTool} from "../src/server/ai-jobs.ts";
import {resolvedContext} from "../src/tenant.ts";
import {visibleTranscript} from "../apps/web/src/transcript.ts";
import type {LiveEvent} from "../apps/web/src/socket.ts";
import type {QueryResult,SqlClient,SqlPool} from "../src/persistence/postgres.ts";

const ctx=resolvedContext("verified-user","northside-outfitters");
const turn="00000000-0000-4000-8000-000000000001";
class Recorder implements SqlClient{
 public statements:Array<{sql:string;args:unknown[]}>=[];
 private readonly respond:(sql:string)=>unknown[];
 constructor(respond:(sql:string)=>unknown[]){this.respond=respond;}
 async query<T=Record<string,unknown>>(sql:string,args:unknown[]=[]):Promise<QueryResult<T>>{
  this.statements.push({sql,args});const rows=this.respond(sql) as T[];
  return {rows,rowCount:rows.length};
 }
 release(){}
}
const pool=(c:Recorder):SqlPool=>({connect:async()=>c});
const job=(attempts:number)=>({room_id:"assortment-review",turn_id:turn,tenant_id:ctx.tenantId,user_uid:ctx.uid,transcript_cutoff:"1",memory_consent:false,state:"running",fencing_token:"2",attempts});

test("retry removes persisted partial blocks and emits one durable reset before new execution",async()=>{
 const c=new Recorder(sql=>sql.includes("UPDATE teamchat.ai_jobs SET state='running'")?[job(2)]:
  sql.includes("DELETE FROM teamchat.answer_blocks")?[{block_index:0},{block_index:1}]:
  sql.includes("SELECT next_sequence")?[{next_sequence:"12"}]:[]);
 const claimed=await claimJob(pool(c),ctx,turn,"worker-2");
 assert.equal(claimed?.fence,2);
 const all=c.statements;
 const del=all.findIndex(s=>s.sql.includes("DELETE FROM teamchat.answer_blocks"));
 const append=all.findIndex(s=>s.sql.includes("INSERT INTO teamchat.room_events"));
 assert.ok(del>=0&&append>del);
 assert.equal(all[append]!.args[3],"ai_answer_reset");
 assert.equal(all.at(-1)?.sql,"COMMIT");
});

test("initial claim and retry without partial blocks do not reset transcript",async()=>{
 for(const [attempts,prior] of [[1,[{block_index:0}]],[2,[]]] as const){
  const c=new Recorder(sql=>sql.includes("UPDATE teamchat.ai_jobs SET state='running'")?[job(attempts)]:
   sql.includes("DELETE FROM teamchat.answer_blocks")?[...prior]:[]);
  await claimJob(pool(c),ctx,turn,"worker");
  assert.ok(!c.statements.some(s=>s.sql.includes("INSERT INTO teamchat.room_events")));
 }
});

test("every tool starts with a fenced durable plan, then completes against exactly that plan",async()=>{
 const c=new Recorder(sql=>sql.includes("state='running' AND lease_expires_at>now() FOR UPDATE")?[{ok:1}]:
  sql.includes("INSERT INTO teamchat.tool_calls")?[{operation_id:"r0-c0"}]:
  sql.includes("UPDATE teamchat.tool_calls")?[{operation_id:"r0-c0"}]:
  sql.includes("SELECT next_sequence")?[{next_sequence:"4"}]:[]);
 const p=pool(c);const args={key:"escalation",value:{contact:"Mike"},room:"assortment-review"};
 await persistToolPlan(p,ctx,"assortment-review",turn,2,"r0-c0","save_memory",args);
 await persistTool(p,ctx,"assortment-review",turn,2,"r0-c0","save_memory",args,{saved:true});
 const plans=c.statements.filter(s=>s.sql.includes("INSERT INTO teamchat.tool_calls"));
 const writes=c.statements.filter(s=>s.sql.includes("UPDATE teamchat.tool_calls"));
 assert.equal(plans.length,1);assert.equal(writes.length,1);
 assert.ok(c.statements.findIndex(s=>s.sql.includes("INSERT INTO teamchat.tool_calls"))<c.statements.findIndex(s=>s.sql.includes("UPDATE teamchat.tool_calls")));
 assert.ok(writes[0]!.sql.includes("arguments=$5::jsonb"));
 assert.deepEqual(c.statements.filter(s=>s.sql.includes("INSERT INTO teamchat.room_events")).map(s=>s.args[3]),["ai_tool_start","ai_tool"]);
});

function ev(seq:number,type:string,turnId:string):LiveEvent{
 return {eventId:`event-${seq}`,sequence:seq,type,roomId:"assortment-review",tenantId:ctx.tenantId,turnId,payload:{}};
}
test("replayed history supersedes only the interrupted turn's old answer blocks",()=>{
 const all=[ev(1,"ai_answer_block","A"),ev(2,"ai_answer_block","B"),ev(3,"ai_answer_reset","A"),ev(4,"ai_answer_block","A"),ev(5,"ai_complete","A")];
 const visible=visibleTranscript(all);
 assert.deepEqual(visible.map(e=>e.sequence),[2,3,4,5]);
 assert.deepEqual(visibleTranscript(all.slice().reverse()).map(e=>e.sequence),[2,3,4,5]);
});

test("a tool result cannot be completed without the exact durable plan",async()=>{
 const c=new Recorder(sql=>sql.includes("state='running' AND lease_expires_at>now() FOR UPDATE")?[{ok:1}]:[]);
 await assert.rejects(persistTool(pool(c),ctx,"assortment-review",turn,2,"r0-c0","save_memory",{key:"different"},{saved:true}),
  /plan missing, already completed, or diverged/);
 assert.ok(c.statements.some(s=>s.sql==="ROLLBACK"));
 assert.ok(!c.statements.some(s=>s.sql.includes("INSERT INTO teamchat.room_events")));
});
