/** Generate deterministic SQL fixture load; run the result with a privileged migration identity, not runtime app role. */
import {mkdirSync,writeFileSync} from "node:fs";
import {loadFixtures} from "../src/fixtures.ts";
import {TENANTS} from "../src/types.ts";
const set=loadFixtures();
function q(value:unknown):string{return value===null||value===undefined?"NULL":`'${String(value).replaceAll("'","''")}'`;}
function insert(table:string,columns:string[],values:unknown[],conflict="DO NOTHING"):string {
 return `INSERT INTO teamchat.${table} (${columns.join(",")}) VALUES (${values.map(q).join(",")}) ON CONFLICT ${conflict};`;
}
const lines=["-- Generated ONLY from employer-provided unchanged fixture bytes", "-- idempotent inserts; explicit updates require versioned migrations", "BEGIN;"];
for(const tenant of TENANTS) {
 lines.push(`SELECT set_config('app.tenant_id', ${q(tenant)}, true);`);
 lines.push(insert("tenants",["tenant_id","display_name"],[tenant,tenant==="northside-outfitters"?"Northside Outfitters":"Valley Home Goods"]));
 const rooms=new Set(["assortment-review","category-strategy"]);
 for(const memory of set.memoriesByTenant[tenant])rooms.add(memory.room);
 for(const room of [...rooms].sort()) lines.push(insert("rooms",["tenant_id","room_id","title"],[tenant,room,room]));
 for(const m of set.marginRows)lines.push(insert("margin_classes",["tenant_id","margin_class","label","coefficient_loyalty","coefficient_standard"],
  [tenant,m.margin_class,m.label,m.coefficient_loyalty,m.coefficient_standard]));
 for(const m of set.marginRows)for(const target of m.supersedes)lines.push(insert("supersession_edges",["tenant_id","source_class","target_class"],[tenant,m.margin_class,target]));
 for(const p of set.productRows)lines.push(insert("catalog",["tenant_id","catalog_code","description","product_family","department","seasonality","specificity","margin_class","margin_class_label","dataset_hash"],
  [tenant,p.catalog_code,p.description,p.product_family,p.department,p.seasonality,p.specificity,p.margin_class,p.margin_class_label,set.hashes["product_codes.csv"]]));
 for(const sc of set.segmentRows)lines.push(insert("segment_coefficients",["tenant_id","channel","store_format","segment","coefficient"],
  [tenant,sc.channel,sc.store_format,sc.segment,sc.coefficient]));
 for(const s of set.storesByTenant[tenant]) {
  lines.push(insert("stores",["tenant_id","store_id","store_name","channel","store_format","segment","opened","buyer","last_review"],
   [tenant,s.store_id,s.store_name,s.channel,s.store_format,s.segment,s.opened,s.buyer,s.last_review]));
  for(const c of s.carried_categories_2026)lines.push(insert("store_carried_codes",["tenant_id","store_id","catalog_code"],[tenant,s.store_id,c]));
  for(const gap of s.suspected_gaps)lines.push(insert("store_gaps",["tenant_id","store_id","catalog_code","description","last_carried","evidence"],
   [tenant,s.store_id,gap.catalog_code,gap.description,gap.last_carried,gap.evidence]));
 }
 for(const m of set.memoriesByTenant[tenant])lines.push(insert("memories",["tenant_id","memory_id","key","value","created_by","created_at","source_room_id"],
  [tenant,m.memory_id,m.key,JSON.stringify(m.value),m.created_by,m.created_at,m.room]));
 for(const [filename,sha256] of Object.entries(set.hashes))lines.push(insert("dataset_versions",["tenant_id","filename","sha256"],[tenant,filename,sha256]));
}
lines.push("COMMIT;");
mkdirSync("db/generated",{recursive:true});const path="db/generated/seed.sql";
writeFileSync(path,lines.join("\n")+"\n");
console.log(`Wrote ${path} with ${lines.filter(line=>line.startsWith("INSERT ")).length} data INSERT statements across both tenants`);
