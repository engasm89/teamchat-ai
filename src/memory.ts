import type { MemoryValue, TeamMemory } from "./types.ts";
export interface ValidationError { field: string; issue: string; }
export function validateMemoryValue(value: unknown): {ok:true,value:MemoryValue} | {ok:false,errors:ValidationError[]} {
  const errors: ValidationError[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return {ok:false,errors:[{field:"value",issue:"Expected a flat object"}]};
  const obj = value as Record<string, unknown>; const keys = Object.keys(obj);
  if (keys.length > 20) errors.push({field:"value",issue:"Maximum 20 fields"});
  const size = Buffer.byteLength(JSON.stringify(obj),"utf8");
  if (size > 8192) errors.push({field:"value",issue:"Maximum 8192 UTF-8 bytes"});
  for (const [key, v] of Object.entries(obj)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key)) errors.push({field:key,issue:"Invalid field name"});
    if (v !== null && !["string","number","boolean"].includes(typeof v)) errors.push({field:key,issue:"Nested values and arrays are not allowed"});
    if (typeof v === "number" && !Number.isFinite(v)) errors.push({field:key,issue:"Finite number required"});
    if (typeof v === "string" && v.length > 2048) errors.push({field:key,issue:"Maximum 2048 characters"});
  }
  return errors.length ? {ok:false,errors} : {ok:true,value:obj as MemoryValue};
}
/** Lexical baseline ranking within an *already tenant-filtered* candidate set. Embedding reranking is pending Vertex integration. */
export function rankMemoriesInTenant(candidates: TeamMemory[], query: string, minScore=0.2): TeamMemory[] {
  const words = (s:string) => new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  const q=words(query); if(!q.size) return [];
  return candidates.map(m=>{
    const corpus = words(`${m.key.replaceAll("_"," ")} ${Object.values(m.value).join(" ")}`);
    const intersect=[...q].filter(w=>corpus.has(w)).length;
    return {m,score:intersect/q.size};
  }).filter(v=>v.score>=minScore).sort((a,b)=>b.score-a.score).map(v=>v.m);
}
