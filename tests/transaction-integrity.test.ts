import {test} from "node:test";
import assert from "node:assert/strict";
import {inTenantTransaction,type SqlClient,type SqlPool,type QueryResult} from "../src/persistence/postgres.ts";
import {resolveVerifiedIdentity} from "../src/server/database.ts";
import {resolvedContext} from "../src/tenant.ts";

test("tenant rollback failure causes pooled connection eviction",async()=>{
 let released:Error|undefined;
 const c:SqlClient={
  release(error?:Error){released=error;},
  async query<T>(sql:string):Promise<QueryResult<T>>{
   if(sql==="ROLLBACK")throw Error("rollback channel broken");
   if(sql==="SELECT failing_query")throw Error("original query failure");
   return {rows:[],rowCount:0};
  }
 };
 const pool:SqlPool={connect:async()=>c};
 await assert.rejects(inTenantTransaction(pool,resolvedContext("uid","northside-outfitters"),async x=>{
  await x.query("SELECT failing_query");
 }),/original query failure/);
 assert.match(released?.message??"",/rollback channel broken/);
});

test("verified identity lookup works with a one-connection pool (no self-deadlock)",async()=>{
 let busy=false,connected=0;
 const c:SqlClient={release(){busy=false;},async query<T>(sql:string):Promise<QueryResult<T>>{
  if(sql.includes("resolve_tenant_for_uid"))return {rows:[{tenant_id:"northside-outfitters"}] as T[],rowCount:1};
  if(sql.includes("user_memberships"))return {rows:[{ok:1}] as T[],rowCount:1};
  return {rows:[],rowCount:0};
 }};
 const pool:SqlPool={connect:async()=>{if(busy)throw Error("pool exhausted: nested checkout");busy=true;connected++;return c;}};
 const ctx=await resolveVerifiedIdentity(pool,"firebase-user-1");
 assert.equal(ctx.tenantId,"northside-outfitters");
 assert.equal(connected,2);
 assert.equal(busy,false);
});
