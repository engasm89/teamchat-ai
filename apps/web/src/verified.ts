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
 if(verified.template==="assistant_text"){
  const values=verified.values;
  if(verified.source==="model_conversation"&&values&&typeof values==="object"&&typeof (values as Record<string,unknown>).message==="string")
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
 if(verified.template==="get_store_assortment"&&result&&typeof result==="object"){
  const r=result as Record<string,unknown>,s=r.store as Record<string,unknown>|undefined;
  if(s){
   const codes=Array.isArray(s.carried_categories_2026)?s.carried_categories_2026:[];
   const gaps=Array.isArray(s.suspected_gaps)?s.suspected_gaps:[];
   const summary=gaps.map(g=>{
    if(!g||typeof g!=="object")return "";
    const gap=g as Record<string,unknown>;
    return `• ${String(gap.catalog_code??"")}: ${String(gap.description??"")} (evidence: ${String(gap.evidence??"not provided")})`;
   }).filter(Boolean).join("\n");
   return `${String(s.store_id??"")} — ${String(s.store_name??"")}\nChannel: ${String(s.channel??"")} · Format: ${String(s.store_format??"")} · Segment: ${String(s.segment??"")}\nCarried codes (${codes.length}): ${codes.join(", ")}\nSuspected assortment gaps (${gaps.length}; not confirmed demand):\n${summary||"No documented gaps"}\nSeasonal relevance has not been inferred beyond fixture labels.\nSource: ${String(r.ref??"")}`;
  }
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
 if(verified.template==="compare_assortment_options"&&result&&typeof result==="object"){
  const x=result as Record<string,unknown>,c=x.comparison as Record<string,unknown>|undefined;
  const a=c?.option_a as Record<string,unknown>|undefined,b=c?.option_b as Record<string,unknown>|undefined;
  if(c&&a&&b)return `Store ${String(x.store_id)} · original score ${String(c.baseline)}\nOption A: ${JSON.stringify(x.codes_a)} → score ${String(a.score)}, uplift ${String(a.uplift)}\nOption B: ${JSON.stringify(x.codes_b)} → score ${String(b.score)}, uplift ${String(b.uplift)}\nDifference (B − A): ${String(c.difference_b_minus_a)}\nA retained/superseded classes: ${JSON.stringify(a.retained)} / ${JSON.stringify(a.removed)}\nB retained/superseded classes: ${JSON.stringify(b.retained)} / ${JSON.stringify(b.removed)}\nAssumption: ${String(c.caveat)}\nSource: ${String(x.ref??"")}`;
 }
 if(verified.template==="save_memory"&&result&&typeof result==="object"){
  const x=result as Record<string,unknown>,m=x.memory as Record<string,unknown>|undefined;
  if(Array.isArray(x.validation_errors))return `Not saved — the value does not fit the shared-memory shape (a flat set of named text, number or yes/no fields):\n${x.validation_errors.map(e=>{
   const err=e as Record<string,unknown>;return `• ${String(err.field??"value")}: ${String(err.issue??"invalid")}`;}).join("\n")}`;
  if(x.saved===false)return `Not saved — ${String(x.error??"the memory could not be stored")}`;
  if(x.saved===true&&m)return `Saved to shared memory: ${String(m.key??"")}\n${JSON.stringify(m.value)}\nRecorded by: ${String(m.created_by??"")} on ${String(m.created_at??"")} in #${String(m.source_room_id??"")}\nSource: ${String(x.ref??"")}`;
 }
 // Other records are server-fetched and remain structured with source IDs.
 return JSON.stringify(verified,null,2);
}
