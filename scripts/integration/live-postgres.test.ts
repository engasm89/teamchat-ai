import test from "node:test";
import assert from "node:assert/strict";
import {createPgPool,resolveVerifiedIdentity,assertRuntimeDbRole} from "../../src/server/database.ts";
import {inTenantTransaction,sendDurableMessage,replayRoom} from "../../src/persistence/postgres.ts";
import {resolvedContext,NO_MATCH} from "../../src/tenant.ts";
import {SqlToolExecutor} from "../../src/server/sql-tools.ts";
import {SourceLedger} from "../../src/grounding.ts";
/** Run ONLY against a provisioned database using the NONOWNER app role.
 * DATABASE_URL and TEST_NORTHSIDE_UID / TEST_VALLEY_UID must be set and mapped
 * to active Firebase users by scripts/provision-demo-users.ts beforehand. */
const configured=Boolean(process.env.DATABASE_URL&&process.env.TEST_NORTHSIDE_UID&&process.env.TEST_VALLEY_UID&&process.env.VERTEX_EMBEDDING_MODEL_ID);
const required=process.env.REQUIRE_POSTGRES==="1";
test("real PostgreSQL role, semantic memory backfill and FORCED RLS isolation",{skip:!configured&&!required},async()=>{
 if(!configured)throw Error("Live PostgreSQL credentials, test UIDs and embedding model are required; refusing to report a false pass");
 const pool=await createPgPool();
 try{
  await assertRuntimeDbRole(pool);
  const direct=await pool.connect();
  try{
   const role=await direct.query<{rolsuper:boolean;rolbypassrls:boolean}>("SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user");
   assert.equal(role.rows[0]?.rolsuper,false);assert.equal(role.rows[0]?.rolbypassrls,false);
   const noContext=await direct.query("SELECT store_id FROM teamchat.stores");
   assert.equal(noContext.rows.length,0);
   await assert.rejects(direct.query("SELECT * FROM teamchat.auth_directory"),/permission denied/);
  }finally{direct.release();}
  const north=await resolveVerifiedIdentity(pool,process.env.TEST_NORTHSIDE_UID!);
  const valley=await resolveVerifiedIdentity(pool,process.env.TEST_VALLEY_UID!);
  assert.notEqual(north.tenantId,valley.tenantId);
  const nsRows=await inTenantTransaction(pool,north,c=>c.query<{store_id:string}>("SELECT store_id FROM teamchat.stores"));
  const vRows=await inTenantTransaction(pool,valley,c=>c.query<{store_id:string}>("SELECT store_id FROM teamchat.stores"));
  assert.equal(nsRows.rows.length,12);assert.equal(vRows.rows.length,12);
  const nsIds=new Set(nsRows.rows.map(x=>x.store_id));const valleyExclusive=vRows.rows.find(x=>!nsIds.has(x.store_id));
  if(valleyExclusive){const denied=await inTenantTransaction(pool,north,c=>c.query("SELECT * FROM teamchat.stores WHERE tenant_id=$1 AND store_id=$2",[valley.tenantId,valleyExclusive.store_id]));assert.equal(denied.rows.length,0);}
  // Test the exact public AI tool path, not just direct SELECTs: a foreign
  // store must be observationally indistinguishable from a nonexistent one.
  if(valleyExclusive){
   const sqlTools=new SqlToolExecutor(pool);
   const foreign=await sqlTools.execute(north,"assortment-review","get_store_assortment",{store_id:valleyExclusive.store_id},new SourceLedger(north,"foreign-live"));
   const nonexistent=await sqlTools.execute(north,"assortment-review","get_store_assortment",{store_id:"ST-9999"},new SourceLedger(north,"unknown-live"));
   assert.deepEqual(foreign,nonexistent);
  }
  // The buyer can omit separators but only an actual source row can return.
  const catalogTool=new SqlToolExecutor(pool);
  const canonical=await catalogTool.execute(north,"assortment-review","get_catalog_code",{catalog_code:"APP-100.12"},new SourceLedger(north,"canonical-live"));
  const shorthand=await catalogTool.execute(north,"assortment-review","get_catalog_code",{catalog_code:"app10012"},new SourceLedger(north,"short-live"));
  assert.ok(canonical&&typeof canonical==="object"&&"product" in canonical);
  assert.ok(shorthand&&typeof shorthand==="object"&&"product" in shorthand);
  assert.deepEqual((canonical as {product:unknown}).product,(shorthand as {product:unknown}).product);
  // FORCED RLS WITH CHECK must reject an attempted cross-company write.
  await assert.rejects(inTenantTransaction(pool,north,async c=>{
   await c.query("INSERT INTO teamchat.memories(tenant_id,memory_id,key,value,created_by,created_at,source_room_id) VALUES($1,$2,$3,'{}'::jsonb,$4,now(),$5)",
    [valley.tenantId,"rls-negative-test","rls-negative-test",north.uid,"assortment-review"]);
  }));
  const own=await inTenantTransaction(pool,north,c=>c.query("SELECT COUNT(*)::integer AS n FROM teamchat.memories"));
  assert.ok(Number(own.rows[0]?.n)>=4);
  for(const context of [north,valley]){
   const memories=await inTenantTransaction(pool,context,c=>c.query<{total:string;ready:string}>(
    "SELECT COUNT(*)::text AS total,COUNT(*) FILTER(WHERE embedding IS NOT NULL AND embedding_model=$1)::text AS ready FROM teamchat.memories WHERE tenant_id=$2",
    [process.env.VERTEX_EMBEDDING_MODEL_ID,context.tenantId]));
   assert.ok(Number(memories.rows[0]?.total)>=4);
   assert.equal(memories.rows[0]?.total,memories.rows[0]?.ready,"Seeded semantic memory embeddings must be backfilled");
  }
  const x=await replayRoom(pool,north,"not-in-my-tenant",0);assert.deepEqual(x,NO_MATCH);
  // Scope must reset even if a connection is reused.
  const second=await pool.connect();try{const leaked=await second.query("SELECT * FROM teamchat.catalog");assert.equal(leaked.rows.length,0);}finally{second.release();}
 }finally{await pool.end();}
});
