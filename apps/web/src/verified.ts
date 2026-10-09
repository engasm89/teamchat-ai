/** Render only server-verified structured results. Never render Gemini's
 * unchecked candidate prose as a business claim. */
export function renderVerifiedBlock(raw:unknown):string{
 if(!raw||typeof raw!=="object")return "Unable to display verified result";
 const verified=raw as Record<string,unknown>;
 if(verified.template==="missing"){
  const values=verified.values;
  if(values&&typeof values==="object"&&typeof (values as Record<string,unknown>).message==="string")
   return (values as Record<string,string>).message;
 }
 const result=verified.result;
 if(verified.template==="search_catalog"&&Array.isArray(result)){
  return result.map(p=>{
   if(!p||typeof p!=="object")return "";
   const item=p as Record<string,unknown>;
   return `${String(item.catalog_code??"")} — ${String(item.description??"")} — margin class ${item.margin_class??"not mapped"} [${String(item.ref??"")}]`;
  }).filter(Boolean).join("\n");
 }
 if(verified.template==="get_catalog_code"&&result&&typeof result==="object"){
  const r=result as Record<string,unknown>,p=r.product as Record<string,unknown>|undefined;
  if(p)return `${String(p.catalog_code??"")} — ${String(p.description??"")}\nMargin class: ${p.margin_class??"not mapped"}\nSource: ${String(r.ref??"")}`;
 }
 if(verified.template==="search_memory"&&Array.isArray(result)){
  return result.map(entry=>{
   const row=entry as Record<string,unknown>,m=row.memory as Record<string,unknown>|undefined;
   if(!m)return "";
   return `Recorded decision: ${String(m.key??"")}\n${JSON.stringify(m.value)}\nRecorded by: ${String(m.author_name??m.created_by??"")} on ${String(m.created_at??"")} in #${String(m.source_room_id??"")}\nSource: ${String(row.ref??"")}`;
  }).filter(Boolean).join("\n\n");
 }
 if(verified.template==="calculate_uplift"&&result&&typeof result==="object"){
  const x=result as Record<string,unknown>,before=x.before as Record<string,unknown>|undefined,
   after=x.after as Record<string,unknown>|undefined,r=x.result as Record<string,unknown>|undefined;
  if(before&&after&&r)return `Assortment coefficient score: ${String(before.score)} → ${String(after.score)}\nDifference: ${String(r.delta??"not calculated")}\nRetained classes: ${JSON.stringify(after.retained)}\nSuperseded classes: ${JSON.stringify(after.removed)}\nAssumption: each distinct mapped class counts once; segment-specific coefficients, then channel/format factor. This is not a sales forecast.\nSource: ${String(x.ref??"")}`;
 }
 // Other records are server-fetched and remain structured with source IDs.
 return JSON.stringify(verified,null,2);
}
