/** Independent expected values, computed straight from the five shipped
 * fixture files. Deliberately shares no code with src/ so a bug in the
 * application's domain layer cannot also hide in the expectation. */
import fs from "node:fs";
import {parse} from "csv-parse/sync";

const DIR="teamchat-ai-assessment/teamchat-ai-seed-data";
type Row=Record<string,string>;
const csv=(file:string)=>parse(fs.readFileSync(`${DIR}/${file}`),{columns:true}) as Row[];

export interface FixtureStore {store_id:string;store_name:string;channel:string;store_format:string;segment:string;
 carried_categories_2026:string[];suspected_gaps:Array<{catalog_code:string;description:string;last_carried:string;evidence:string}>}
export interface FixtureMemory {memory_id:string;key:string;value:Record<string,unknown>;created_by:string;created_at:string;room:string}

export const products=new Map(csv("product_codes.csv").map(r=>[r.catalog_code!,r]));
const classes=new Map(csv("promo_coefficients.csv").map(r=>[r.margin_class!,{
 label:r.label!,loyalty:thousandths(r.coefficient_loyalty!),standard:thousandths(r.coefficient_standard!),
 supersedes:(r.supersedes??"").split(";").map(s=>s.trim()).filter(Boolean)}]));
const segments=new Map(csv("segment_coefficients.csv").map(r=>[`${r.channel}|${r.store_format}|${r.segment}`,thousandths(r.coefficient!)]));
export const stores=JSON.parse(fs.readFileSync(`${DIR}/stores.json`,"utf8")) as Record<string,FixtureStore[]>;
export const memories=JSON.parse(fs.readFileSync(`${DIR}/team_memory_seed.json`,"utf8")) as Record<string,FixtureMemory[]>;

/** Coefficients in the fixtures have at most three decimals; keep them as exact integers. */
function thousandths(value:string):number{
 const m=/^(\d+)(?:\.(\d{1,3}))?$/.exec(value.trim());
 if(!m)throw Error(`Unexpected coefficient ${value}`);
 return Number(m[1])*1000+Number((m[2]??"").padEnd(3,"0"));
}
/** thousandths × thousandths is exact in millionths; render with six decimals. */
function millionths(value:number):string{
 const sign=value<0?"-":"",abs=Math.abs(value);
 return `${sign}${Math.floor(abs/1_000_000)}.${String(abs%1_000_000).padStart(6,"0")}`;
}

export const store=(tenant:string,id:string)=>stores[tenant]?.find(s=>s.store_id===id);
export const CODE_PATTERN=/\b[A-Z]{3}-\d{3}\.\d{2}\b/g;

/** A class is dropped when any other present class reaches it through the
 * "supersedes" relation (followed transitively). Every remaining distinct
 * mapped class contributes its segment coefficient once; the sum is scaled
 * by the store's channel/format/segment coefficient. */
export function score(tenant:string,storeId:string,add:string[]=[]){
 const s=store(tenant,storeId);if(!s)throw Error(`No fixture store ${tenant}/${storeId}`);
 const codes=[...new Set([...s.carried_categories_2026,...add])];
 const present=new Set<string>();const unmapped:string[]=[];
 for(const code of codes){
  const p=products.get(code);if(!p)throw Error(`Unknown code ${code}`);
  if(p.margin_class)present.add(p.margin_class);else unmapped.push(code);
 }
 const reach=(from:string)=>{
  const seen=new Set<string>(),stack=[...(classes.get(from)?.supersedes??[])];
  while(stack.length){const c=stack.pop()!;if(seen.has(c))continue;seen.add(c);stack.push(...(classes.get(c)?.supersedes??[]));}
  return seen;
 };
 const removed=new Set<string>();
 for(const c of present)for(const r of reach(c))if(r!==c&&present.has(r))removed.add(r);
 const retained=[...present].filter(c=>!removed.has(c)).sort();
 const sum=retained.reduce((n,c)=>n+(s.segment==="loyalty"?classes.get(c)!.loyalty:classes.get(c)!.standard),0);
 const factor=segments.get(`${s.channel}|${s.store_format}|${s.segment}`);
 if(factor===undefined)throw Error(`No segment coefficient for ${storeId}`);
 return {score:millionths(sum*factor),scoreMillionths:sum*factor,retained,removed:[...removed].sort(),unmapped:unmapped.sort()};
}
export function delta(before:{scoreMillionths:number},after:{scoreMillionths:number}){return millionths(after.scoreMillionths-before.scoreMillionths);}

export const codesWhere=(test:(r:Row)=>boolean)=>[...products.values()].filter(test).map(r=>r.catalog_code!);
/** Every code an answer shows must exist, and its description/class must match the fixture. */
export function productMatches(p:Record<string,unknown>){
 const f=products.get(String(p.catalog_code));
 return !!f&&String(p.description)===f.description&&String(p.margin_class??"")===(f.margin_class??"");
}
