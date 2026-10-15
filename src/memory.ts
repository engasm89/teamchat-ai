import type { MemoryValue, TeamMemory } from "./types.ts";
export interface ValidationError { field: string; issue: string; }
const FIELD_NAME = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
export function validateMemoryValue(value: unknown): {ok:true,value:MemoryValue} | {ok:false,errors:ValidationError[]} {
  const errors: ValidationError[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return {ok:false,errors:[{field:"value",issue:"Expected a flat object"}]};
  const obj = value as Record<string, unknown>; const keys = Object.keys(obj);
  if (keys.length === 0) errors.push({field:"value",issue:"At least one field is required"});
  if (keys.length > 20) errors.push({field:"value",issue:"Maximum 20 fields"});
  const size = Buffer.byteLength(JSON.stringify(obj),"utf8");
  if (size > 8192) errors.push({field:"value",issue:"Maximum 8192 UTF-8 bytes"});
  for (const [key, v] of Object.entries(obj)) {
    if (!FIELD_NAME.test(key)) errors.push({field:key,issue:"Invalid field name"});
    if (v !== null && !["string","number","boolean"].includes(typeof v)) errors.push({field:key,issue:"Nested values and arrays are not allowed"});
    if (typeof v === "number" && !Number.isFinite(v)) errors.push({field:key,issue:"Finite number required"});
    if (typeof v === "string" && v.length > 2048) errors.push({field:key,issue:"Maximum 2048 characters"});
  }
  return errors.length ? {ok:false,errors} : {ok:true,value:obj as MemoryValue};
}
/** save_memory receives its value as JSON text: Gemini's constrained decoding emits `{}` for an
 * OBJECT parameter without declared properties (qa_evidence/experiments/save-memory-schema.json). */
export function parseMemoryValueJson(text: unknown): ReturnType<typeof validateMemoryValue> {
  if (typeof text !== "string") return {ok:false,errors:[{field:"value_json",issue:"Expected the text of a JSON object"}]};
  let value: unknown;
  try { value = JSON.parse(text); } catch { return {ok:false,errors:[{field:"value_json",issue:"Not valid JSON"}]}; }
  return validateMemoryValue(value);
}
/** The one controlled repair of a rejected value: each nested object or array field is kept,
 * re-encoded as JSON text, and a field name with spaces or punctuation ("flat check value")
 * becomes its underscored form, so nothing is dropped and no value changes. Null when the
 * repair cannot change the outcome or two names would collide. */
export function controlledMemoryRepair(text: unknown): string | null {
  if (typeof text !== "string") return null;
  let value: unknown;
  try { value = JSON.parse(text); } catch { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  const rename = (k: string) => FIELD_NAME.test(k) ? k : k.trim().replace(/[^a-zA-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  const repaired = entries.map(([k, v]) => [rename(k), v !== null && typeof v === "object" ? JSON.stringify(v) : v] as const);
  if (repaired.some(([k]) => !FIELD_NAME.test(k)) || new Set(repaired.map(([k]) => k)).size !== entries.length) return null;
  if (repaired.every(([k, v], i) => k === entries[i]![0] && v === entries[i]![1])) return null;
  return JSON.stringify(Object.fromEntries(repaired));
}
/** The JSON object the requester typed into their own message, as compact text, when there is
 * exactly one. The model can reshape a value before calling save_memory (it does so reliably once
 * a room's history shows earlier rejections), which would bypass validation; what the requester
 * supplied is what must be validated. */
export function requesterMemoryValue(body: unknown): string | null {
  if (typeof body !== "string") return null;
  const found: string[] = [];
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== "{") continue;
    const end = matchingBrace(body, i);
    if (end < 0) return null;
    try { found.push(JSON.stringify(JSON.parse(body.slice(i, end + 1)))); } catch { /* not JSON: never take a fragment from inside it */ }
    i = end;
  }
  return found.length === 1 ? found[0]! : null;
}
function matchingBrace(text: string, start: number): number {
  let depth = 0, inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) { if (c === "\\") i++; else if (c === '"') inString = false; continue; }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return -1;
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
