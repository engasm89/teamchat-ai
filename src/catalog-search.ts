/** Deterministic catalog retrieval ranking; never fabricates records. */
export interface CatalogCandidate {catalog_code:string;description:string;product_family:string;department?:string; margin_class?:string|null}
const STOP=new Set(["a","an","the","for","with","and","or","of","in","to","me","show","find","need","what","is","codes","code","catalog","product","products"]);
export function catalogQueryTerms(value:string):string[] {
 const expanded=value.replace(/\bAC\b/gi,"air conditioners").replace(/\bSSD\b/gi,"solid state drives")
  .replace(/\bHBA\b/gi,"host bus adapter").replace(/\bRTW\b/gi,"ready to wear")
  .replace(/\bDIY\b/gi,"do it yourself").toLowerCase();
 return [...new Set(expanded.match(/[a-z0-9]+/g)?.filter(word=>word.length>1&&!STOP.has(word)).slice(0,12)??[])];
}
export function rankCatalog(candidates:CatalogCandidate[],query:string,limit:number):CatalogCandidate[]{
 if(!Number.isSafeInteger(limit)||limit<1||limit>25)throw Error("Invalid catalog result limit");
 const terms=catalogQueryTerms(query);if(!terms.length)return [];
 const ranked=candidates.map(item=>{
  const desc=item.description.toLowerCase(),family=item.product_family.toLowerCase();
  const scored=terms.map(t=>({t,score:(family.includes(t)?5:0)+(desc.includes(t)?3:0)}));
  const covered=scored.filter(x=>x.score>0).length;
  const score=scored.reduce((total,x)=>total+x.score,0) + (covered===terms.length?12:0);
  return {item,score,covered};
 }).filter(x=>x.covered>0);
 ranked.sort((a,b)=>b.covered-a.covered||b.score-a.score||a.item.catalog_code.localeCompare(b.item.catalog_code));
 return ranked.slice(0,limit).map(x=>x.item);
}
