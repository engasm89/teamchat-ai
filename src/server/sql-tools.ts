import {rankCatalog,normalizeCatalogCode,normalizeStoreId} from "../catalog-search.ts";
import {inTenantTransaction,type SqlPool,type SqlClient} from "../persistence/postgres.ts";
import {NO_MATCH,type TenantContext} from "../tenant.ts";
import {parseMemoryValueJson} from "../memory.ts";
import {decimalMicro,formatMicro,multiplyMicro,retainedClasses,compareScores,compareAlternatives,type Score} from "../retail.ts";
import {TOOL_DECLARATIONS,type ToolName} from "../tools.ts";
import {SourceLedger} from "../grounding.ts";

import {memoryEmbeddingText,vectorSql,type EmbeddingProvider} from "../worker/embeddings.ts";

type Rec=Record<string,unknown>;
function argsOf(value:unknown,allowed:string[]):Rec{
 if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))throw Error("Invalid tool arguments");
 return value as Rec;
}
function str(value:unknown,key:string){if(typeof value!=="string"||!value.trim()||value.length>256)throw Error(`Invalid ${key}`);return value;}
async function requireMembership(c:SqlClient,ctx:TenantContext,room:string){
 const x=await c.query("SELECT 1 FROM teamchat.room_memberships r JOIN teamchat.user_memberships m USING(tenant_id,firebase_uid) WHERE r.tenant_id=$1 AND r.room_id=$2 AND r.firebase_uid=$3 AND m.active=true",[ctx.tenantId,room,ctx.uid]);
 if(x.rows.length!==1)throw Error("Unauthorized");
}
async function catalogCode(c:SqlClient,ctx:TenantContext,code:string){
 const r=await c.query("SELECT catalog_code,description,product_family,department,seasonality,specificity,margin_class,margin_class_label FROM teamchat.catalog WHERE tenant_id=$1 AND catalog_code=$2",[ctx.tenantId,code]);
 return r.rows[0];
}
async function getStore(c:SqlClient,ctx:TenantContext,id:string){
 const store=(await c.query("SELECT store_id,store_name,channel,store_format,segment,opened,buyer,last_review FROM teamchat.stores WHERE tenant_id=$1 AND store_id=$2",[ctx.tenantId,id])).rows[0];
 if(!store)return null;
 const codes=(await c.query("SELECT catalog_code FROM teamchat.store_carried_codes WHERE tenant_id=$1 AND store_id=$2 ORDER BY catalog_code",[ctx.tenantId,id])).rows.map(r=>r.catalog_code);
 const gaps=(await c.query("SELECT catalog_code,description,last_carried,evidence FROM teamchat.store_gaps WHERE tenant_id=$1 AND store_id=$2 ORDER BY catalog_code",[ctx.tenantId,id])).rows;
 return {...store,carried_categories_2026:codes,suspected_gaps:gaps};
}
async function storeScore(c:SqlClient,ctx:TenantContext,store:Rec,codes:string[]):Promise<Score>{
 const unique=[...new Set(codes)];
 const mapping=await c.query<{catalog_code:string; margin_class:string|null}>(
  "SELECT catalog_code,margin_class FROM teamchat.catalog WHERE tenant_id=$1 AND catalog_code=ANY($2::text[])",[ctx.tenantId,unique]);
 if(mapping.rows.length!==unique.length)throw Error("Unrecognized catalog code");
 const present=new Set(mapping.rows.map(r=>r.catalog_code));if(unique.some(id=>!present.has(id)))throw Error("Unrecognized catalog code");
 const classes=new Set(mapping.rows.flatMap(p=>p.margin_class?[p.margin_class]:[]));
 const margins=await c.query<{margin_class:string; coefficient_loyalty:string;coefficient_standard:string}>("SELECT margin_class,coefficient_loyalty::text,coefficient_standard::text FROM teamchat.margin_classes WHERE tenant_id=$1",[ctx.tenantId]);
 const edges=await c.query<{source_class:string;target_class:string}>("SELECT source_class,target_class FROM teamchat.supersession_edges WHERE tenant_id=$1",[ctx.tenantId]);
 const supersedes=new Map(margins.rows.map(m=>[m.margin_class,[] as string[]]));
 for(const edge of edges.rows)supersedes.get(edge.source_class)?.push(edge.target_class);
 const {retained,removed}=retainedClasses(classes,supersedes);
 const segment=await c.query<{coefficient:string}>("SELECT coefficient::text FROM teamchat.segment_coefficients WHERE tenant_id=$1 AND channel=$2 AND store_format=$3 AND segment=$4",[ctx.tenantId,store.channel,store.store_format,store.segment]);
 if(segment.rows.length!==1)throw Error("Missing segment coefficient");
 let sum=0n;for(const name of retained){const m=margins.rows.find(x=>x.margin_class===name)!;sum+=decimalMicro(String(store.segment)==="loyalty"?m.coefficient_loyalty:m.coefficient_standard);}
 const factor=segment.rows[0]!.coefficient;
 const version=await c.query<{sha256:string}>("SELECT sha256 FROM teamchat.dataset_versions WHERE tenant_id=$1 AND filename='promo_coefficients.csv'",[ctx.tenantId]);
 return {score:formatMicro(multiplyMicro(sum,decimalMicro(factor))),retained,removed,unmapped:mapping.rows.filter(p=>!p.margin_class).map(p=>p.catalog_code),codes:unique,multiplier:factor,segment:String(store.segment),provenance:{dataset:"assessment fixtures",version:version.rows[0]?.sha256??"unknown"}};
}

/** All tools use scoped PostgreSQL transactions; model arguments never include tenant or authorization. */
export class SqlToolExecutor{
 private readonly pool:SqlPool;
 private readonly embeddings?:EmbeddingProvider;
 constructor(pool:SqlPool,embeddings?:EmbeddingProvider){this.pool=pool;this.embeddings=embeddings;}
 async execute(ctx:TenantContext,roomId:string,name:ToolName,raw:unknown,ledger:SourceLedger,consent=false,jobFence?:{turnId:string;fence:number}):Promise<unknown>{
  if(!TOOL_DECLARATIONS.some(d=>d.name===name))throw Error("Undeclared tool");
  // Expensive embedding calls happen before opening a PostgreSQL transaction.
  let queryVector:string|undefined,saveVector:string|undefined;
  if(name==="search_memory"){
   const a=argsOf(raw,["query"]),query=str(a.query,"query");
   if(!this.embeddings)throw Error("Semantic memory service not configured");
   queryVector=vectorSql(await this.embeddings.embed(query,"RETRIEVAL_QUERY"));
  }
  if(name==="save_memory"){
   const a=argsOf(raw,["key","value_json","room"]);
   if(!consent)throw Error("Shared-memory save not consented");
   const key=str(a.key,"key"),valid=parseMemoryValueJson(a.value_json);
   if(valid.ok){
    if(!this.embeddings)throw Error("Semantic memory service not configured");
    saveVector=vectorSql(await this.embeddings.embed(memoryEmbeddingText(key,valid.value),"RETRIEVAL_DOCUMENT"));
   }
  }
  return inTenantTransaction(this.pool,ctx,async c=>{
   await requireMembership(c,ctx,roomId);
   switch(name){
    case "search_catalog":{
     const a=argsOf(raw,["query","limit"]);const query=str(a.query,"query").replace(/[%_\\]/g," ");
     const limit=a.limit===undefined?10:Number(a.limit);if(!Number.isInteger(limit)||limit<1||limit>25)throw Error("Invalid limit");
     const r=await c.query<{catalog_code:string;description:string;product_family:string;department:string;margin_class:string|null}>(
      "SELECT catalog_code,description,product_family,department,margin_class FROM teamchat.catalog WHERE tenant_id=$1 ORDER BY catalog_code LIMIT 1500",[ctx.tenantId]);
     return rankCatalog(r.rows,query,limit).map(p=>({ref:ledger.add("catalog",String(p.catalog_code),{...p}),...p}));
    }
    case "get_catalog_code":{
     const a=argsOf(raw,["catalog_code"]);const code=normalizeCatalogCode(str(a.catalog_code,"catalog_code"));if(!code)return NO_MATCH;const p=await catalogCode(c,ctx,code);
     return p?{ref:ledger.add("catalog",code,p),product:p}:NO_MATCH;
    }
    case "get_store_assortment":{
     const a=argsOf(raw,["store_id"]);const id=normalizeStoreId(str(a.store_id,"store_id"));if(!id)return NO_MATCH;const store=await getStore(c,ctx,id);
     return store?{ref:ledger.add("store",id,store),store}:NO_MATCH;
    }
    case "calculate_uplift":{
     const a=argsOf(raw,["store_id","add_codes"]);const id=normalizeStoreId(str(a.store_id,"store_id"));if(!id)return NO_MATCH;const store=await getStore(c,ctx,id);
     if(!store)return NO_MATCH;
     if(!Array.isArray(a.add_codes)||a.add_codes.length>30||a.add_codes.some(code=>typeof code!=="string"||!normalizeCatalogCode(code)))throw Error("Invalid add_codes");
     const add=(a.add_codes as string[]).map(code=>normalizeCatalogCode(code)!);
     for(const code of add){const p=await catalogCode(c,ctx,code);if(!p)return NO_MATCH;ledger.add("catalog",code,p);}
     const before=await storeScore(c,ctx,store,store.carried_categories_2026 as string[]);
     const after=await storeScore(c,ctx,store,[...(store.carried_categories_2026 as string[]),...add]);
     const result=compareScores(before,after);
     return {ref:ledger.add("calculation",id,{...result,store_id:id,before,after,assumed_rule_version:"1"}),result,before,after};
    }
    case "compare_assortment_options":{
     const a=argsOf(raw,["store_id","option_a_codes","option_b_codes"]);
     const id=normalizeStoreId(str(a.store_id,"store_id"));if(!id)return NO_MATCH;
     const store=await getStore(c,ctx,id);if(!store)return NO_MATCH;
     const readCodes=(rawCodes:unknown)=>{
      if(!Array.isArray(rawCodes)||rawCodes.length>30||rawCodes.some(code=>typeof code!=="string"||!normalizeCatalogCode(code)))throw Error("Invalid option codes");
      return [...new Set((rawCodes as string[]).map(code=>normalizeCatalogCode(code)!))];
     };
     const codesA=readCodes(a.option_a_codes),codesB=readCodes(a.option_b_codes);
     for(const code of new Set([...codesA,...codesB])){const p=await catalogCode(c,ctx,code);if(!p)return NO_MATCH;ledger.add("catalog",code,p);}
     const carried=store.carried_categories_2026 as string[];
     const before=await storeScore(c,ctx,store,carried);
     const optionA=await storeScore(c,ctx,store,[...carried,...codesA]);
     const optionB=await storeScore(c,ctx,store,[...carried,...codesB]);
     const comparison=compareAlternatives(before,optionA,optionB);
     const ref=ledger.add("calculation",`${id}:alternatives`,{...comparison,store_id:id,codes_a:codesA,codes_b:codesB,assumed_rule_version:"1"});
     return {ref,store_id:id,codes_a:codesA,codes_b:codesB,comparison};
    }
    case "search_memory":{
     const a=argsOf(raw,["query"]);const query=str(a.query,"query");
     // Exact tenant RLS scope first, then semantic cosine distance. Weak matches
     // return no record rather than a confidently phrased invented memory.
     const r=await c.query<{memory_id:string;key:string;value:Rec;created_by:string;author_name:string;created_at:string;source_room_id:string;distance:number}>(
      `SELECT mem.memory_id,mem.key,mem.value,mem.created_by,
       COALESCE(actor.display_name,mem.created_by) AS author_name,
       mem.created_at::text,mem.source_room_id,
       (mem.embedding <=> $2::vector)::float8 AS distance
       FROM teamchat.memories mem
       LEFT JOIN teamchat.user_memberships actor
         ON actor.tenant_id=mem.tenant_id AND actor.firebase_uid=mem.created_by
       WHERE mem.tenant_id=$1 AND mem.embedding IS NOT NULL
       AND mem.embedding_model=$3 ORDER BY mem.embedding <=> $2::vector LIMIT 5`,
      [ctx.tenantId,queryVector!,this.embeddings!.modelId]);
     return r.rows.filter(m=>m.distance<=0.55).map(m=>({ref:ledger.add("memory",String(m.memory_id),m),memory:m}));
    }
    case "save_memory":{
     const a=argsOf(raw,["key","value_json","room"]);if(!consent)throw Error("Shared-memory save not consented");
     const key=str(a.key,"key"),sourceRoom=str(a.room,"room");if(sourceRoom!==roomId)throw Error("Source room mismatch");
     if(!jobFence)throw Error("Memory mutation requires a durable AI job lease");
     const lease=await c.query("SELECT 1 FROM teamchat.ai_jobs WHERE tenant_id=$1 AND turn_id=$2::uuid AND fencing_token=$3 AND state='running' AND lease_expires_at>now() FOR UPDATE",[ctx.tenantId,jobFence.turnId,jobFence.fence]);
     if(lease.rows.length!==1)throw Error("AI job lease lost");
     const valid=parseMemoryValueJson(a.value_json);if(!valid.ok)return {validation_errors:valid.errors,saved:false};
     const r=await c.query("INSERT INTO teamchat.memories(tenant_id,memory_id,key,value,created_by,created_at,source_room_id,embedding,embedding_model) VALUES ($1,gen_random_uuid()::text,$2,$3::jsonb,$4,now(),$5,$6::vector,$7) ON CONFLICT (tenant_id,key) DO NOTHING RETURNING memory_id,key,value,created_by,created_at::text,source_room_id",[ctx.tenantId,key,JSON.stringify(valid.value),ctx.uid,roomId,saveVector!,this.embeddings!.modelId]);
     if(!r.rows.length){
      const previous=await c.query("SELECT memory_id,key,value,created_by,created_at::text,source_room_id FROM teamchat.memories WHERE tenant_id=$1 AND key=$2 AND value=$3::jsonb",[ctx.tenantId,key,JSON.stringify(valid.value)]);
      const old=previous.rows[0];
      if(old&&old.created_by===ctx.uid&&old.source_room_id===roomId)return {saved:true,reused:true,ref:ledger.add("memory",String(old.memory_id),old),memory:old};
      return {saved:false,error:"Memory key already exists; revision required"};
     }
     const memory=r.rows[0]!;
     await c.query("INSERT INTO teamchat.memory_versions(tenant_id,memory_id,version,value,changed_by) VALUES($1,$2,1,$3::jsonb,$4)",
      [ctx.tenantId,memory.memory_id,JSON.stringify(valid.value),ctx.uid]);
     return {saved:true,ref:ledger.add("memory",String(memory.memory_id),memory),memory};
    }
   }
  });
 }
}
