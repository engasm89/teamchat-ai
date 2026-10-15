/** The answer contract between Gemini and the room. Gemini proposes segments;
 * the server decides what is shown. A `say` segment carries conversation only
 * (no workspace facts). A `fact` segment names a typed predicate and a source
 * alias from THIS turn; the server checks it against the fetched record and
 * writes the sentence itself. Anything else fails closed. */
import {NO_MATCH} from "./tenant.ts";
import {TOOL_DECLARATIONS} from "./tools.ts";
import {TENANTS} from "./types.ts";

type Rec=Record<string,unknown>;
const isRec=(v:unknown):v is Rec=>!!v&&typeof v==="object"&&!Array.isArray(v);
const str=(v:unknown)=>v===null||v===undefined?"":String(v);

export type SourceType="catalog"|"store"|"memory"|"uplift"|"alternatives"|"save_result";
export type NoMatchKind="product"|"store"|"memory"|"record";
export interface TurnSource {alias:string;type:SourceType;ref:string|null;label:string;data:Rec}
export interface HistoryMessage {alias:string;sequence:number;author:string;body:string}

export const PREDICATES=["product_info","product_margin_class","store_summary","store_carries_code","store_gap",
 "memory_recorded","memory_save_result","score_change","option_difference","no_match","message_quote","assistant_capabilities"] as const;
export type Predicate=typeof PREDICATES[number];
const SOURCE_FOR:Partial<Record<Predicate,SourceType[]>>={
 product_info:["catalog"],product_margin_class:["catalog"],store_summary:["store"],store_carries_code:["store"],store_gap:["store"],
 memory_recorded:["memory"],memory_save_result:["save_result"],score_change:["uplift"],option_difference:["alternatives"]};

export interface ProposedSegment {kind?:unknown;text?:unknown;predicate?:unknown;ref?:unknown;code?:unknown;no_match_kind?:unknown}
export interface VerifiedSegment {kind:"say"|"fact"|"fallback";rendered:string;predicate?:Predicate;refs:string[];sources:string[]}
export type SegmentCheck={ok:true;segment:VerifiedSegment}|{ok:false;reason:string};

const CODE=/^[A-Z]{3}-\d{3}\.\d{2}$/;
const normalizeCode=(v:unknown)=>typeof v==="string"&&CODE.test(v.trim().toUpperCase())?v.trim().toUpperCase():null;
const day=(v:unknown)=>str(v).slice(0,10);
const quote=(text:string,max=240)=>{const t=text.replace(/\s+/g," ").trim();return t.length>max?`${t.slice(0,max-1)}…`:t;};
const list=(v:unknown)=>Array.isArray(v)&&v.length?v.map(String).join(", "):"none";

/** Everything the model may cite in THIS turn, built only from this turn's
 * tool results. Each record keeps its ledger ref, which must belong to this
 * turn and tenant; anything else is ignored rather than trusted. */
export class TurnSources {
 private readonly items:TurnSource[]=[];
 private readonly misses=new Set<NoMatchKind>();
 private readonly turnId:string;private readonly tenantId:string;private readonly names:Map<string,string>;
 constructor(turnId:string,tenantId:string,names:Map<string,string>=new Map()){this.turnId=turnId;this.tenantId=tenantId;this.names=names;}
 private own(ref:unknown):ref is string{return typeof ref==="string"&&ref.startsWith(`${this.turnId}:${this.tenantId}:`);}
 private add(type:SourceType,ref:string|null,label:string,data:Rec){
  if(this.items.some(s=>s.type===type&&s.ref!==null&&s.ref===ref))return;
  if(this.items.length>=40)return;
  this.items.push({alias:`S${this.items.length+1}`,type,ref,label,data});
 }
 private isMiss(result:unknown){
  return result===NO_MATCH||(isRec(result)&&result.found===false&&result.message===NO_MATCH.message)||(Array.isArray(result)&&result.length===0);
 }
 ingest(tool:string,result:unknown):void{
  if(isRec(result)&&typeof result.error==="string"&&tool!=="save_memory")return;
  if(this.isMiss(result)){
   this.misses.add(tool==="search_catalog"||tool==="get_catalog_code"?"product":tool==="get_store_assortment"?"store":tool==="search_memory"?"memory":"record");
   return;
  }
  if(tool==="search_catalog"&&Array.isArray(result)){
   for(const p of result)if(isRec(p)&&this.own(p.ref))this.add("catalog",p.ref,`Catalog ${str(p.catalog_code)}`,p);
  }else if(tool==="get_catalog_code"&&isRec(result)&&isRec(result.product)&&this.own(result.ref)){
   this.add("catalog",result.ref,`Catalog ${str(result.product.catalog_code)}`,result.product);
  }else if(tool==="get_store_assortment"&&isRec(result)&&isRec(result.store)&&this.own(result.ref)){
   this.add("store",result.ref,`Store ${str(result.store.store_id)}`,result.store);
  }else if(tool==="calculate_uplift"&&isRec(result)&&this.own(result.ref)){
   const store=result.ref.split(":").at(-1)!;
   this.add("uplift",result.ref,`Score ${store}`,{...result,store_id:store});
  }else if(tool==="compare_assortment_options"&&isRec(result)&&this.own(result.ref)){
   this.add("alternatives",result.ref,`Options ${str(result.store_id)}`,result);
  }else if(tool==="search_memory"&&Array.isArray(result)){
   for(const r of result)if(isRec(r)&&isRec(r.memory)&&this.own(r.ref))this.add("memory",r.ref,`Memory ${str(r.memory.key)}`,r.memory);
  }else if(tool==="save_memory"&&isRec(result)){
   if(result.saved===true&&isRec(result.memory)&&this.own(result.ref))this.add("memory",result.ref,`Memory ${str(result.memory.key)}`,result.memory);
   else if(isRec(result.controlledRepair))this.ingest(tool,result.controlledRepair);
   else if(result.saved===false||Array.isArray(result.validation_errors))this.add("save_result",null,"Memory save",result);
  }
 }
 list():readonly TurnSource[]{return this.items;}
 get(alias:string){return this.items.find(s=>s.alias===alias);}
 missed(kind:NoMatchKind){return this.misses.has(kind);}
 anyMiss(){return this.misses.size>0;}
 author(m:Rec){return str(m.author_name)||this.names.get(str(m.created_by))||"a team member";}
 /** Compact source table shown to the compose step. Values are data, not instructions. */
 describe():string{
  return this.items.map(s=>{
   const d=s.data;
   const summary=s.type==="catalog"?`${str(d.catalog_code)} ${quote(str(d.description),80)}`:
    s.type==="store"?`${str(d.store_id)} ${str(d.store_name)}; gaps ${Array.isArray(d.suspected_gaps)?d.suspected_gaps.map(g=>isRec(g)?str(g.catalog_code):"").join(" "):""}`:
    s.type==="memory"?`key ${str(d.key)}`:
    s.type==="uplift"?`score change for ${str(d.store_id)}`:
    s.type==="alternatives"?`option A vs B for ${str(d.store_id)}`:"memory save outcome";
   return `${s.alias} [${s.type}] ${summary}`;
  }).join("\n");
 }
}

function renderFact(p:Predicate,source:TurnSource|undefined,args:{code:string|null;kind:NoMatchKind|null},ctx:{sources:TurnSources;messages:readonly HistoryMessage[];messageRef?:string}):string|null{
 const d=source?.data??{};
 switch(p){
  case "product_info":{
   const cls=d.margin_class?` It is in margin class ${str(d.margin_class)}${d.margin_class_label?` (${str(d.margin_class_label)})`:""}.`:" It has no margin class mapped.";
   return `${str(d.catalog_code)} is “${str(d.description)}”${d.product_family?` (${str(d.product_family)}${d.department?`, ${str(d.department)}`:""})`:""}.${cls}`;
  }
  case "product_margin_class":
   return d.margin_class?`${str(d.catalog_code)} has margin class ${str(d.margin_class)}${d.margin_class_label?` (${str(d.margin_class_label)})`:""}.`:`${str(d.catalog_code)} has no margin class mapped.`;
  case "store_summary":{
   const gaps=Array.isArray(d.suspected_gaps)?d.suspected_gaps.length:0,codes=Array.isArray(d.carried_categories_2026)?d.carried_categories_2026.length:0;
   return `${str(d.store_id)} (${str(d.store_name)}) is a ${str(d.store_format)} ${str(d.channel).replace(/_/g," ")} store in the ${str(d.segment)} segment. It carries ${codes} catalog codes and has ${gaps} suspected assortment gap${gaps===1?"":"s"} (suspected, not confirmed demand).`;
  }
  case "store_carries_code":{
   if(!args.code)return null;
   const carried=Array.isArray(d.carried_categories_2026)&&d.carried_categories_2026.map(String).includes(args.code);
   return carried?`${str(d.store_id)} (${str(d.store_name)}) carries ${args.code}.`:`${args.code} is not among the codes ${str(d.store_id)} (${str(d.store_name)}) carries.`;
  }
  case "store_gap":{
   const gaps=(Array.isArray(d.suspected_gaps)?d.suspected_gaps:[]).filter(isRec);
   const line=(g:Rec)=>`${str(g.catalog_code)} (${str(g.description)}; last carried ${str(g.last_carried)}; evidence: ${str(g.evidence)})`;
   if(args.code){
    const g=gaps.find(x=>str(x.catalog_code)===args.code);
    return g?`${line(g)} is a suspected gap at ${str(d.store_id)}. This is not confirmed demand.`:`${args.code} is not listed as a suspected gap at ${str(d.store_id)}.`;
   }
   return gaps.length?`Suspected gaps at ${str(d.store_id)} (not confirmed demand): ${gaps.map(line).join("; ")}.`:`${str(d.store_id)} has no documented suspected gaps.`;
  }
  case "memory_recorded":{
   const value=isRec(d.value)?Object.entries(d.value).map(([k,v])=>`${k.replace(/_/g," ")}: ${str(v)}`).join("; "):str(d.value);
   return `Recorded decision “${str(d.key)}”: ${value}. Recorded by ${ctx.sources.author(d)} on ${day(d.created_at)} in #${str(d.source_room_id)}.`;
  }
  case "memory_save_result":{
   if(Array.isArray(d.validation_errors))return `Not saved — the value must be a flat set of named text, number or yes/no fields: ${d.validation_errors.filter(isRec).map(e=>`${str(e.field)} (${str(e.issue)})`).join("; ")}.`;
   return `Not saved — ${str(d.error)||"the memory could not be stored"}.`;
  }
  case "score_change":{
   const before=isRec(d.before)?d.before:{},after=isRec(d.after)?d.after:{},r=isRec(d.result)?d.result:{};
   const prior=new Set(Array.isArray(before.codes)?before.codes.map(String):[]);
   const added=Array.isArray(after.codes)?after.codes.map(String).filter(c=>!prior.has(c)):[];
   return `For ${str(d.store_id)}, adding ${list(added)} changes the assortment coefficient score from ${str(before.score)} to ${str(after.score)} (difference ${str(r.delta)}). Retained classes: ${list(after.retained)}; superseded classes: ${list(after.removed)}. The score is a dimensionless coefficient, not a sales forecast.`;
  }
  case "option_difference":{
   const c=isRec(d.comparison)?d.comparison:{},a=isRec(c.option_a)?c.option_a:{},b=isRec(c.option_b)?c.option_b:{};
   return `For ${str(d.store_id)}, option A (${list(d.codes_a)}) scores ${str(a.score)} and option B (${list(d.codes_b)}) scores ${str(b.score)}; B minus A is ${str(c.difference_b_minus_a)}. ${str(c.caveat)}`.trim();
  }
  case "no_match":{
   if(!args.kind||!ctx.sources.missed(args.kind))return null;
   return args.kind==="product"?"No matching product exists in the supplied catalog.":args.kind==="memory"?"I have no record of that.":"No matching record is available in this workspace.";
  }
  case "message_quote":{
   const m=ctx.messages.find(x=>x.alias===ctx.messageRef);
   return m?`${m.author} (#${m.sequence}): “${quote(m.body)}”`:null;
  }
  case "assistant_capabilities":
   return `I can: ${TOOL_DECLARATIONS.map(t=>CAPABILITY[t.name]).join("; ")}. I can also answer questions about this room's conversation.`;
 }
}
const CAPABILITY:Record<string,string>={
 search_catalog:"search the product catalog",get_catalog_code:"look up what a catalog code means",
 get_store_assortment:"show a store's carried codes and suspected gaps with their evidence",
 calculate_uplift:"calculate the assortment coefficient score change from adding codes to a store",
 compare_assortment_options:"compare two proposed sets of codes for the same store",
 search_memory:"find decisions your team recorded, with who recorded them and when",
 save_memory:"save a decision to shared memory when you tick the consent box"};

/** Check one proposed segment. Never throws on model input. */
export function checkSegment(raw:unknown,ctx:{sources:TurnSources;messages:readonly HistoryMessage[];vocabulary:WorkspaceVocabulary}):SegmentCheck{
 if(!isRec(raw))return {ok:false,reason:"not an object"};
 const s=raw as ProposedSegment;
 if(Object.keys(raw).some(k=>!["kind","text","predicate","ref","code","no_match_kind"].includes(k)))return {ok:false,reason:"unknown field"};
 if(s.kind==="say"){
  if(typeof s.text!=="string")return {ok:false,reason:"say without text"};
  if(s.predicate!=null&&s.predicate!==""||s.ref!=null&&s.ref!=="")return {ok:false,reason:"say with fact fields"};
  const check=ctx.vocabulary.checkSay(s.text);
  return check.ok?{ok:true,segment:{kind:"say",rendered:s.text.trim(),refs:[],sources:[]}}:check;
 }
 if(s.kind!=="fact")return {ok:false,reason:"unknown kind"};
 if(typeof s.text==="string"&&s.text.trim())return {ok:false,reason:"fact with model text"};
 if(typeof s.predicate!=="string"||!(PREDICATES as readonly string[]).includes(s.predicate))return {ok:false,reason:"unknown predicate"};
 const predicate=s.predicate as Predicate;
 const ref=typeof s.ref==="string"?s.ref.trim():"";
 const code=s.code==null||s.code===""?null:normalizeCode(s.code);
 if(s.code!=null&&s.code!==""&&!code)return {ok:false,reason:"malformed code"};
 const kind=s.no_match_kind==null||s.no_match_kind===""?null:(["product","store","memory","record"] as const).find(k=>k===s.no_match_kind)??null;
 if(s.no_match_kind!=null&&s.no_match_kind!==""&&!kind)return {ok:false,reason:"unknown no-match kind"};
 if(predicate==="message_quote"){
  if(!/^M\d{1,3}$/.test(ref))return {ok:false,reason:"bad message ref"};
  const text=renderFact(predicate,undefined,{code:null,kind:null},{...ctx,messageRef:ref});
  return text?{ok:true,segment:{kind:"fact",predicate,rendered:text,refs:[],sources:[`Message ${ref}`]}}:{ok:false,reason:"unknown message ref"};
 }
 if(predicate==="no_match"||predicate==="assistant_capabilities"){
  if(ref)return {ok:false,reason:"unexpected ref"};
  const text=renderFact(predicate,undefined,{code,kind},ctx);
  return text?{ok:true,segment:{kind:"fact",predicate,rendered:text,refs:[],sources:[]}}:{ok:false,reason:"no-match not observed in this turn"};
 }
 if(!/^S\d{1,3}$/.test(ref))return {ok:false,reason:"bad source ref"};
 const source=ctx.sources.get(ref);
 if(!source)return {ok:false,reason:"unknown source ref"};
 if(!SOURCE_FOR[predicate]!.includes(source.type))return {ok:false,reason:"predicate does not fit source"};
 if((predicate==="store_carries_code")&&!code)return {ok:false,reason:"missing code"};
 if(code&&predicate!=="store_carries_code"&&predicate!=="store_gap")return {ok:false,reason:"unexpected code"};
 const text=renderFact(predicate,source,{code,kind},ctx);
 return text?{ok:true,segment:{kind:"fact",predicate,rendered:text,refs:source.ref?[source.ref]:[],sources:[source.label]}}:{ok:false,reason:"unrenderable"};
}

/** Deterministic, server-written replacement for whatever has not been shown. */
export function fallbackSegments(sources:TurnSources,shown:ReadonlySet<string>,anyShown:boolean):VerifiedSegment[]{
 const out:VerifiedSegment[]=[];
 const pending=sources.list().filter(s=>!shown.has(s.alias)).slice(0,8);
 const predicateFor:Record<SourceType,Predicate>={catalog:"product_info",store:"store_summary",memory:"memory_recorded",
  uplift:"score_change",alternatives:"option_difference",save_result:"memory_save_result"};
 const empty={sources,messages:[] as HistoryMessage[]};
 for(const s of pending){
  const predicate=predicateFor[s.type];
  const text=renderFact(predicate,s,{code:null,kind:null},empty);
  if(text)out.push({kind:"fallback",predicate,rendered:text,refs:s.ref?[s.ref]:[],sources:[s.label]});
  if(s.type==="store"){const gaps=renderFact("store_gap",s,{code:null,kind:null},empty);if(gaps)out.push({kind:"fallback",predicate:"store_gap",rendered:gaps,refs:s.ref?[s.ref]:[],sources:[s.label]});}
 }
 if(!out.length&&!anyShown){
  for(const kind of ["product","store","memory","record"] as const)if(sources.missed(kind)){
   out.push({kind:"fallback",predicate:"no_match",rendered:renderFact("no_match",undefined,{code:null,kind},empty)!,refs:[],sources:[]});
  }
  if(!out.length)out.push({kind:"fallback",rendered:"I couldn't answer that with information I could verify in this workspace.",refs:[],sources:[]});
 }
 return out;
}

// ---------- say-vocabulary check ----------
const STOP=new Set(("a about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its itself just let me more most my no nor not now of off on once only or other our ours out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours "+
 "hello hi hey thanks thank welcome glad happy sure okay ok well good great fine doing help helping today tomorrow ask asking asked question questions answer answers reply chat room conversation team teams message messages recent recently earlier later anything something nothing everything else like look looking find finding want need needs know let tell show please may might maybe also quite really still new set sets one ones way ways part parts kind kinds type types use used using work working time times day days week year years see seen mean means made make makes take give get got go going come keep check checking plan planning based include includes including different same each every many much number other others information detail details data record records note notes topic topics item items list lists option options case cases point points idea ideas thing things people person member members everyone someone anyone colleague colleagues assistant ai bot here there "+
 "short long first last free general light heavy cold warm hot small large big little morning afternoon evening night easy simple quick basic full half open clear main single double old fresh nice"
).split(/\s+/));
const APP_TERMS=new Set("catalog catalogue code codes product products store stores assortment assortments gap gaps score scores coefficient coefficients margin class classes memory memories decision decisions tool tools search searching calculation calculations compare comparison workspace category categories family families department departments season seasonal".split(" "));
const CLAIM_WORDS=/\b(carr(?:y|ies|ied|ying)|stock(?:s|ed|ing)?|in stock|out of stock|availab(?:le|ility)|unavailable|lack(?:s|ed|ing)?|missing|because|due to|caus(?:e|es|ed|ing)|own(?:s|ed|er|ership)|saved by|recorded by|decid(?:e|ed|es)|agreed|approv(?:e|ed|al)|target(?:s|ed)?|deadline|polic(?:y|ies)|supersed(?:e|es|ed|ing)|uplift|increase[sd]?|decrease[sd]?|higher|lower|profit\w*|revenue|sales|sell(?:s|ing)?|price[sd]?|pricing|cost(?:s)?|margin class \w+|best|worst|top|confirmed|finali[sz]ed|settled|signed off|scheduled|launch(?:ed|es)?|discontinued|sold out|popular|trending|demand)\b/i;
const NEGATION=/\b(no|not|never|none|nothing|isn't|aren't|doesn't|don't|didn't|wasn't|weren't|cannot|can't|without)\b/i;
const APP_NOUN=/\b(catalog|catalogue|code|product|store|record|memory|decision|gap|item|match|result)s?\b/i;

export interface VocabularySource {
 catalogText:string[];phrases:string[];requesterName?:string;tenantId:string;
 /** Human messages the model was shown, including the request: echoing a word people in the
  * room wrote is not a workspace claim. Earlier AI answers must never be included. */
 echoText?:string;
}
/** Words and phrases that would make a `say` segment a workspace claim. */
export class WorkspaceVocabulary {
 private readonly words=new Set<string>();
 private readonly phrases:string[]=[];
 private readonly echo=new Set<string>();
 constructor(src:VocabularySource){
  for(const w of (src.echoText??"").toLowerCase().match(/[a-z][a-z'-]{3,}/g)??[])this.echo.add(w.replace(/'s$/,""));
  for(const text of src.catalogText)for(const w of text.toLowerCase().match(/[a-z][a-z'-]{3,}/g)??[])
   if(!STOP.has(w)&&!APP_TERMS.has(w))this.words.add(w.replace(/'s$/,""));
  const requester=src.requesterName?.trim().toLowerCase();
  for(const raw of src.phrases){const p=raw.trim().toLowerCase();if(p.length>=3&&p!==requester)this.phrases.push(p);}
  for(const other of TENANTS.filter(t=>t!==src.tenantId)){this.phrases.push(other.replace(/-/g," "));this.phrases.push(other.split("-")[0]!);}
 }
 checkSay(text:string):{ok:true}|{ok:false;reason:string}{
  const t=text.trim();
  if(!t)return {ok:false,reason:"empty say"};
  if(t.length>600)return {ok:false,reason:"say too long"};
  if(/\d/.test(t))return {ok:false,reason:"number in say"};
  if(/https?:\/\/|www\./i.test(t))return {ok:false,reason:"link in say"};
  if(/\b[A-Z]{2,4}-[A-Z0-9]/.test(t))return {ok:false,reason:"identifier in say"};
  if(CLAIM_WORDS.test(t))return {ok:false,reason:"claim wording in say"};
  if(NEGATION.test(t)&&APP_NOUN.test(t))return {ok:false,reason:"negated workspace statement in say"};
  const lower=t.toLowerCase();
  for(const p of this.phrases){
   const at=lower.indexOf(p);
   if(at>=0&&!/[a-z0-9]/.test(lower[at-1]??" ")&&!/[a-z0-9]/.test(lower[at+p.length]??" "))return {ok:false,reason:"workspace name in say"};
  }
  for(const w of lower.match(/[a-z][a-z'-]{3,}/g)??[]){
   const base=w.replace(/'s$/,"");
   if(STOP.has(base)||APP_TERMS.has(base)||this.echo.has(base))continue;
   const forms=[base,base.replace(/ies$/,"y"),base.replace(/es$/,""),base.replace(/s$/,"")];
   if(forms.some(f=>this.words.has(f)||this.words.has(`${f}s`)))return {ok:false,reason:"catalog vocabulary in say"};
  }
  return {ok:true};
 }
}

// ---------- incremental JSON array parsing ----------
/** Extracts complete top-level elements from a streamed JSON array. Partial
 * text is never returned; a stream that ends mid-element yields nothing more. */
export class JsonArrayStream {
 private buf="";private pos=0;private started=false;private closed=false;
 private depth=0;private inString=false;private escaped=false;private elementStart=-1;
 push(chunk:string):string[]{
  this.buf+=chunk;const out:string[]=[];
  for(;this.pos<this.buf.length;this.pos++){
   const ch=this.buf[this.pos]!;
   if(this.closed)break;
   if(!this.started){if(ch==="["){this.started=true;}else if(!/\s/.test(ch))throw Error("Answer stream is not a JSON array");continue;}
   if(this.inString){if(this.escaped)this.escaped=false;else if(ch==="\\")this.escaped=true;else if(ch==="\"")this.inString=false;continue;}
   if(ch==="\""){this.inString=true;if(this.depth===0)throw Error("Bare string element");continue;}
   if(ch==="{"||ch==="["){if(this.depth===0)this.elementStart=this.pos;this.depth++;continue;}
   if(ch==="}"||ch==="]"){
    if(this.depth===0){if(ch==="]"){this.closed=true;}else throw Error("Unbalanced answer stream");continue;}
    this.depth--;
    if(this.depth===0){out.push(this.buf.slice(this.elementStart,this.pos+1));this.elementStart=-1;}
    continue;
   }
   if(this.depth===0&&!/[\s,]/.test(ch))throw Error("Unexpected token in answer stream");
  }
  return out;
 }
 get complete(){return this.closed;}
}
