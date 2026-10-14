import type {LiveEvent} from "./socket.ts";

export interface AnswerSegment {index:number;kind:string;rendered:string;sources:string[]}
export interface AiTurn {
 turnId:string;
 state:"waiting"|"working"|"complete"|"failed";
 /** Human-readable progress while the answer is being prepared. */
 activity:string;
 segments:AnswerSegment[];
 /** Server-fetched tool results backing this answer (shown as Sources). */
 sources:LiveEvent[];
 failedReason?:string;
 restarted:boolean;
}

const TOOL_ACTIVITY:Record<string,string>={
 search_catalog:"Searching the catalog",get_catalog_code:"Looking up a catalog code",get_store_assortment:"Checking a store's assortment",
 calculate_uplift:"Calculating a score change",compare_assortment_options:"Comparing assortment options",
 search_memory:"Searching team decisions",save_memory:"Saving to shared memory"};

/** Summarise one AI turn from its (already reset-filtered) events. */
export function summariseTurn(turnId:string,events:readonly LiveEvent[]):AiTurn{
 const segments:AnswerSegment[]=[];const sources:LiveEvent[]=[];
 let state:AiTurn["state"]=events.length?"working":"waiting",activity="Reading your message…",failedReason:string|undefined,restarted=false;
 for(const e of events){
  if(e.type==="ai_turn_started")activity="Thinking…";
  else if(e.type==="ai_retrying"){
   const attempt=Number(e.payload.attempt),wait=Number(e.payload.delaySeconds);
   activity=`The AI service is busy; trying again${Number.isFinite(wait)?` in ${wait} s`:""}${Number.isFinite(attempt)?` (attempt ${attempt} of 3)`:""}…`;
  }
  else if(e.type==="ai_tool_start")activity=`${TOOL_ACTIVITY[String(e.payload.name)]??"Fetching workspace data"}…`;
  else if(e.type==="ai_tool")activity="Writing the answer…";
  else if(e.type==="ai_answer_block")sources.push(e);
  else if(e.type==="ai_answer_segment")segments.push({index:Number(e.payload.index),kind:String(e.payload.kind??"say"),rendered:String(e.payload.rendered??""),
   sources:Array.isArray(e.payload.sources)?e.payload.sources.map(String):[]});
  else if(e.type==="ai_answer_reset")restarted=true;
  else if(e.type==="ai_complete")state="complete";
  else if(e.type==="ai_failed"){state="failed";failedReason=String(e.payload.reason??"Processing failed");}
 }
 segments.sort((a,b)=>a.index-b.index);
 return {turnId,state,activity,segments,sources,failedReason,restarted};
}
export function displayName(uid:unknown,members:ReadonlyMap<string,string>):string{
 return typeof uid==="string"&&members.get(uid)||"Unknown member";
}
export function initials(name:string):string{
 const parts=name.trim().split(/\s+/).filter(Boolean);
 return ((parts[0]?.[0]??"?")+(parts.length>1?parts.at(-1)![0]!:"")).toUpperCase();
}
/** Within this distance of the bottom, new messages keep the view pinned. */
export const FOLLOW_THRESHOLD_PX=100;
export function isNearBottom(el:{scrollHeight:number;scrollTop:number;clientHeight:number}):boolean{
 return el.scrollHeight-el.scrollTop-el.clientHeight<=FOLLOW_THRESHOLD_PX;
}
