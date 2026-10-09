/** Exact fixture-only catalog discovery. Does not synthesize a product code. */
export interface CatalogCandidate {catalog_code:string;description:string;product_family:string;department?:string;margin_class?:string|null}
const STOP=new Set(["a","an","the","for","with","and","or","of","in","to","me","show","find","need","what","is","codes","code","catalog","product","products","unit","units","thing","something","that","does","mean","about","please","which","right","our"]);
const EXPANSIONS:Readonly<Record<string,string>>={ac:"air conditioners",ssd:"solid state drives",hba:"host bus adapter",rtw:"ready to wear",diy:"do it yourself"};
function tokens(value:string):string[]{
 return [...new Set((value.toLowerCase().match(/[a-z0-9]+/g)??[])
  .map(w=>w.length>3&&w.endsWith("s")&&!w.endsWith("ss")?w.slice(0,-1):w)
  .filter(w=>w.length>1&&!STOP.has(w)))];
}
export function catalogQueryTerms(value:string):string[]{
 const expanded=value.replace(/\b(AC|SSD|HBA|RTW|DIY)\b/gi,w=>EXPANSIONS[w.toLowerCase()]!);
 return [...new Set((expanded.toLowerCase().match(/[a-z0-9]+/g)??[]).filter(w=>w.length>1&&!STOP.has(w)))].slice(0,16);
}
function rankOne<T extends CatalogCandidate>(candidates:T[],query:string):T[]{
 const terms=tokens(catalogQueryTerms(query).join(" "));if(!terms.length)return [];
 const ranked=candidates.map(item=>{
  const family=tokens(item.product_family),desc=tokens(item.description);
  const covered=terms.filter(t=>family.includes(t)||desc.includes(t)).length;
  const score=terms.reduce((n,t)=>n+(family.includes(t)?5:0)+(desc.includes(t)?3:0),0)+(covered===terms.length?12:0);
  return {item,covered,score};
 }).filter(r=>r.covered>0);
 ranked.sort((a,b)=>b.covered-a.covered||b.score-a.score||a.item.catalog_code.localeCompare(b.item.catalog_code));
 return ranked.map(r=>r.item);
}
export function rankCatalog<T extends CatalogCandidate>(candidates:T[],query:string,limit:number):T[]{
 if(!Number.isSafeInteger(limit)||limit<1||limit>25)throw Error("Invalid catalog result limit");
 const mentioned=[...new Set((query.match(/\b(AC|SSD|HBA|RTW|DIY)\b/gi)??[]).map(x=>x.toLowerCase()))];
 if(mentioned.length<2)return rankOne(candidates,query).slice(0,limit);
 // Buyers ask for several categories at once; interleave independently retrieved
 // fixture records so a broad SSD family cannot crowd AC out of the results.
 const ranked=mentioned.map(x=>rankOne(candidates,EXPANSIONS[x]!));
 const result:T[]=[],seen=new Set<string>();
 for(let offset=0;result.length<limit&&ranked.some(rows=>offset<rows.length);offset++){
  for(const rows of ranked){const item=rows[offset];if(item&&!seen.has(item.catalog_code)){
   result.push(item);seen.add(item.catalog_code);if(result.length===limit)break;
  }}
 }
 return result;
}
/** Interpret buyer-entered code without inventing entries absent from the catalog. */
export function normalizeCatalogCode(value:string):string|null{
 const cleaned=value.trim().toUpperCase().replace(/[\s-._]/g,"");
 return /^[A-Z]{3}\d{5}$/.test(cleaned)?`${cleaned.slice(0,3)}-${cleaned.slice(3,6)}.${cleaned.slice(6)}`:null;
}
export function normalizeStoreId(value:string):string|null{
 const compact=value.trim().toUpperCase().replace(/[\s-]/g,"");
 return /^(?:ST)?\d{4}$/.test(compact)?`ST-${compact.slice(-4)}`:null;
}
