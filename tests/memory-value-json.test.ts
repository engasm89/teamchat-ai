import test from "node:test";
import assert from "node:assert/strict";
import {TOOL_DECLARATIONS} from "../src/tools.ts";
import {parseMemoryValueJson} from "../src/memory.ts";
import {SqlToolExecutor} from "../src/server/sql-tools.ts";
import {SourceLedger} from "../src/grounding.ts";
import {resolvedContext} from "../src/tenant.ts";
import type {SqlClient,QueryResult} from "../src/persistence/postgres.ts";

test("every OBJECT tool parameter declares its properties (Gemini emits {} for one that does not)",()=>{
 const open:string[]=[];
 const walk=(schema:any,at:string)=>{
  if(schema?.type==="OBJECT"&&!Object.keys(schema.properties??{}).length)open.push(at);
  for(const [k,v] of Object.entries(schema?.properties??{}))walk(v,`${at}.${k}`);
  if(schema?.items)walk(schema.items,`${at}[]`);
 };
 for(const t of TOOL_DECLARATIONS)walk(t.parameters,t.name);
 assert.deepEqual(open,[]);
 const save=TOOL_DECLARATIONS.find(t=>t.name==="save_memory")!.parameters;
 assert.equal((save.properties as any).value_json.type,"STRING");
});

test("memory value JSON: flat values parse; nested, empty and malformed values get field-level reasons",()=>{
 assert.deepEqual(parseMemoryValueJson('{"contact":"Dana","deadline":"2026-11-20","priority":2,"confirmed":true,"note":null}'),
  {ok:true,value:{contact:"Dana",deadline:"2026-11-20",priority:2,confirmed:true,note:null}});
 const nested=parseMemoryValueJson('{"leads":[{"name":"Ana"}],"owner":{"name":"Ben"},"site":"ST-4001"}');
 assert.equal(nested.ok,false);
 assert.deepEqual(!nested.ok&&nested.errors.map(e=>e.field),["leads","owner"]);
 assert.deepEqual(parseMemoryValueJson("{}"),{ok:false,errors:[{field:"value",issue:"At least one field is required"}]});
 assert.deepEqual(parseMemoryValueJson("{not json"),{ok:false,errors:[{field:"value_json",issue:"Not valid JSON"}]});
 assert.deepEqual(parseMemoryValueJson({contact:"Dana"}),{ok:false,errors:[{field:"value_json",issue:"Expected the text of a JSON object"}]});
 assert.equal(parseMemoryValueJson('["a"]').ok,false);
});

test("save_memory rejects nested and empty values without writing, and refuses the old object argument",async()=>{
 const ctx=resolvedContext("buyer-a","northside-outfitters");
 const writes:string[]=[];
 const client:SqlClient={release(){},async query<T=Record<string,unknown>>(sql:string):Promise<QueryResult<T>>{
  if(/INSERT/.test(sql))writes.push(sql);
  const rows=/SELECT 1 FROM teamchat\.(room_memberships|ai_jobs)/.test(sql)?[{ok:1}]:[];
  return {rows:rows as T[],rowCount:rows.length};
 }};
 const executor=new SqlToolExecutor({connect:async()=>client},{modelId:"embed-mock",embed:async()=>{throw Error("must not embed an invalid value");}});
 const save=(args:Record<string,unknown>)=>executor.execute(ctx,"assortment-review","save_memory",args,new SourceLedger(ctx,"t"),true,
  {turnId:"00000000-0000-4000-a000-000000000009",fence:1});
 const nested=await save({key:"roster",room:"assortment-review",value_json:'{"leads":[{"name":"Ana"}]}'}) as any;
 assert.deepEqual(nested,{validation_errors:[{field:"leads",issue:"Nested values and arrays are not allowed"}],saved:false});
 const empty=await save({key:"roster",room:"assortment-review",value_json:"{}"}) as any;
 assert.equal(empty.saved,false);
 assert.deepEqual(empty.validation_errors,[{field:"value",issue:"At least one field is required"}]);
 await assert.rejects(save({key:"roster",room:"assortment-review",value:{name:"Ana"}}),/Invalid tool arguments/);
 assert.deepEqual(writes,[]);
});
