import type {LiveEvent} from "./socket.ts";

/** Persisted events are immutable audit history. A resumed worker emits an
 * ai_answer_reset to supersede incomplete answer blocks from an old attempt.
 * Project the view from replayed events; never erase the underlying audit log.
 */
export function visibleTranscript(events:readonly LiveEvent[]):LiveEvent[]{
 const ordered=[...events].sort((a,b)=>a.sequence-b.sequence);
 const latestReset=new Map<string,number>();
 for(const event of ordered){
  if(event.type!=="ai_answer_reset")continue;
  const turn=event.turnId??event.payload.turnId;
  if(typeof turn==="string")latestReset.set(turn,event.sequence);
 }
 return ordered.filter(event=>{
  if(event.type!=="ai_answer_block")return true;
  const turn=event.turnId??event.payload.turnId;
  return typeof turn!=="string"||event.sequence>=(latestReset.get(turn)??0);
 });
}
