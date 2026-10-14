import test from "node:test";
import assert from "node:assert/strict";
import {validateEmbedding,vectorSql,memoryEmbeddingText,withEmbeddingTimeout,type EmbeddingProvider} from "../src/worker/embeddings.ts";
import {SqlToolExecutor,identifierTerms} from "../src/server/sql-tools.ts";
import {SourceLedger} from "../src/grounding.ts";
import {resolvedContext} from "../src/tenant.ts";
import type {SqlPool,SqlClient,QueryResult} from "../src/persistence/postgres.ts";
const good=Array.from({length:768},(_,i)=>i===0?1:0);
const embedder:EmbeddingProvider={modelId:"mock-768",embed:async()=>good};
const ctx=resolvedContext("person-n","northside-outfitters");
test("embedding input validates dimension, non-finite and zero vectors",()=>{
 assert.equal(validateEmbedding(good).length,768);
 assert.throws(()=>validateEmbedding([1,2,3]),/dimension/);
 assert.throws(()=>validateEmbedding(Array(768).fill(0)),/zero/);
 assert.throws(()=>validateEmbedding([Infinity,...Array(767).fill(1)]),/numeric/);
 assert.equal(vectorSql(good).split(",").length,768);
});
test("semantic document text has deterministic key ordering",()=>{
 assert.equal(memoryEmbeddingText("test",{z:"last",a:"first"}),"test\na: first\nz: last");
});
test("semantic search is tenant-scoped, uses model-specific vectors, and suppresses weak matches",async()=>{
 const calls:Array<{sql:string;args:unknown[]}>=[];
 const client:SqlClient={release(){},async query<T=Record<string,unknown>>(sql:string,args:unknown[]=[]):Promise<QueryResult<T>>{
  calls.push({sql,args});
  if(sql.includes("room_memberships"))return {rows:[{ok:1}] as T[],rowCount:1};
  if(sql.includes("embedding <=>"))return {rows:[
   {memory_id:"m1",key:"supplier-change",value:{who:"person"},created_by:"p1",created_at:"2026-01-01",source_room_id:"category-strategy",distance:0.19},
   {memory_id:"m2",key:"irrelevant",value:{who:"else"},created_by:"p2",created_at:"2026-01-01",source_room_id:"category-strategy",distance:0.90}
  ] as T[],rowCount:2};
  return {rows:[],rowCount:0};
 }};
 const pool:SqlPool={connect:async()=>client};
 const result=await new SqlToolExecutor(pool,embedder).execute(ctx,"assortment-review","search_memory",{query:"what did we decide about suppliers?"},new SourceLedger(ctx,"turn1")) as any[];
 assert.equal(result.length,1);assert.equal(result[0].memory.memory_id,"m1");
 const vectorCall=calls.find(x=>x.sql.includes("embedding <=>"))!;
 assert.equal(vectorCall.args[0],ctx.tenantId);
 assert.equal(vectorCall.args[2],"mock-768");
 assert.ok(vectorCall.sql.includes("WHERE mem.tenant_id=$1"));
 assert.ok(calls.some(x=>x.sql.includes("set_config('app.tenant_id'")));
});
test("identifier terms are the query words that contain a digit",()=>{
 assert.deepEqual(identifierTerms("Who is the escalation contact for case MV8LH9ZK-jaw8, due 2026-11-20? ST-4007 and A1"),["mv8lh9zk-jaw8","2026-11-20","st-4007"]);
 assert.deepEqual(identifierTerms("what did we decide about suppliers?"),[]);
});
test("memory saves require consent before embedding/model invocation",async()=>{
 let called=0;const never:EmbeddingProvider={...embedder,embed:async()=>{called++;return good;}};
 const sql:SqlPool={connect:async()=>{throw Error("DB should not be accessed");}};
 await assert.rejects(new SqlToolExecutor(sql,never).execute(ctx,"assortment-review","save_memory",{key:"a",value_json:JSON.stringify({note:"x"}),room:"assortment-review"},new SourceLedger(ctx,"t"),false),/consent/);
 assert.equal(called,0);
});

test("a stalled embedding request is abandoned after its timeout and retried once, never left hanging",async t=>{
 let calls=0;const started=Date.now();
 // AbortSignal.timeout does not hold the event loop open; the worker's HTTP server does.
 const alive=setInterval(()=>{},1000);t.after(()=>clearInterval(alive));
 const stalled=(signal:AbortSignal)=>{calls++;return new Promise<number[]>((_,reject)=>signal.addEventListener("abort",()=>reject(signal.reason)));};
 await assert.rejects(withEmbeddingTimeout(stalled,50,2),/TimeoutError|aborted|timed out/i);
 assert.equal(calls,2);
 assert.ok(Date.now()-started<1000,"two 50 ms attempts, not a 300 s wait");
 let tries=0;
 assert.deepEqual(await withEmbeddingTimeout(async()=>{if(++tries===1)throw Error("fetch failed");return good;},50,2),good);
 assert.equal(tries,2);
});
