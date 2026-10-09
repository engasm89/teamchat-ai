/** One-time / idempotent re-embedding for seeded or legacy memories.
 * Execute with restricted application DB credentials; never bypass RLS.
 * Do not report semantic retrieval as ready until all tenant rows are embedded. */
import {createPgPool,assertRuntimeDbRole} from "../src/server/database.ts";
import {inTenantTransaction} from "../src/persistence/postgres.ts";
import {resolvedContext} from "../src/tenant.ts";
import {TENANTS} from "../src/types.ts";
import {createVertexEmbedder,memoryEmbeddingText,vectorSql} from "../src/worker/embeddings.ts";
const pool=await createPgPool();
try {
 await assertRuntimeDbRole(pool);
 const embedding=await createVertexEmbedder();
 for(const tenant of TENANTS){
  const ctx=resolvedContext("embedding-backfill",tenant);
  const records=await inTenantTransaction(pool,ctx,async c=>{
   const result=await c.query<{memory_id:string;key:string;value:Record<string,unknown>}>(
    "SELECT memory_id,key,value FROM teamchat.memories WHERE tenant_id=$1 AND (embedding IS NULL OR embedding_model IS DISTINCT FROM $2) ORDER BY memory_id",[tenant,embedding.modelId]);
   return result.rows;
  });
  for(const record of records){
   const vector=vectorSql(await embedding.embed(memoryEmbeddingText(record.key,record.value),"RETRIEVAL_DOCUMENT"));
   await inTenantTransaction(pool,ctx,async c=>{await c.query(
    "UPDATE teamchat.memories SET embedding=$3::vector,embedding_model=$4 WHERE tenant_id=$1 AND memory_id=$2",
    [tenant,record.memory_id,vector,embedding.modelId]);});
  }
  const count=await inTenantTransaction(pool,ctx,async c=>c.query<{count:string}>(
   "SELECT COUNT(*)::text AS count FROM teamchat.memories WHERE tenant_id=$1 AND (embedding IS NULL OR embedding_model IS DISTINCT FROM $2)",[tenant,embedding.modelId]));
  if(Number(count.rows[0]?.count)!==0)throw Error(`Incomplete embedding backfill for ${tenant}`);
  console.log(`Backfill complete for ${tenant}: ${records.length} rows`);
 }
}finally{await pool.end();}
