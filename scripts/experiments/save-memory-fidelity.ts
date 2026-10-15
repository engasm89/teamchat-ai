/** Experiment: does Gemini hand the user's value to save_memory as given, or restructure it
 * first? A value flattened by the model never reaches server validation, so the user is not
 * told it does not fit. Production declaration and config (temperature 0, mode ANY); only the
 * system instruction varies. Read-only: calls the model, never executes tools.
 * With TRANSCRIPT=tenant:room:sequence:requesterUid the 15 room events before that live trigger are read
 * (as the worker reads them) and sent as the earlier transcript; otherwise it is empty.
 *   node --experimental-strip-types scripts/experiments/save-memory-fidelity.ts "<sentence>" > qa_evidence/experiments/save-memory-fidelity.json */
import {GoogleGenAI} from "@google/genai";
import {TOOL_DECLARATIONS} from "../../src/tools.ts";
import {trustedPlannerInstructions,buildConversationContents} from "../../src/worker/gemini.ts";
import {openDb,authoritativeEvents} from "../acceptance/common.ts";

const project="focus-clean-4b9f4",location="us-central1",model="gemini-2.5-flash",TRIALS=5;
const client=new GoogleGenAI({vertexai:true,project,location});
const FIDELITY=process.argv[2]??"";
const production=trustedPlannerInstructions({roomId:"supply-planning",memoryConsent:true});
const instructions={"as checked out":production,...(FIDELITY?{"plus fidelity sentence":`${production} ${FIDELITY}`}:{})};
const prompts={
 flat:"@AI Remember that our escalation contact for ST-4003 is Dana Whitfield and the deadline is 2026-11-20.",
 nested:'@AI Remember this complex nested roster as roster-x1: {"leads":[{"name":"Ana","shifts":[{"day":"Mon","stores":["ST-4001","ST-4002"]}]},{"name":"Ben","shifts":[{"day":"Tue","stores":["ST-4003"]}]}]}',
 nested2:'@AI Save this planogram as bay-plan-7: {"bays":[{"bay":1,"shelves":[{"level":"top","codes":["APP-100.12","APP-210.40"]}]},{"bay":2,"shelves":[{"level":"eye","codes":["ELE-330.05"]}]}],"owner":{"name":"Priya","team":"merch"}}',
};
type Ev={type:string;payload:Record<string,unknown>;sequence:number};
let earlier:Ev[]=[],uid="requester",cutoff=1;
if(process.env.TRANSCRIPT){
 const [tenant,room,seq,requester]=process.env.TRANSCRIPT.split(":");cutoff=Number(seq);uid=requester!;
 const pool=await openDb();
 try{
  const events=await authoritativeEvents(pool,tenant!,uid,room!,0) as Ev[];
  earlier=events.filter(e=>e.sequence<cutoff&&(e.type==="message"||e.type==="ai_answer_block")).slice(-15);
 }finally{await pool.end();}
}
const conversation=(text:string)=>buildConversationContents([...earlier,{type:"message",payload:{author_uid:uid,body:text},sequence:cutoff}],new Map(),{uid,cutoff}).contents;
const parse=(s:unknown)=>{try{return JSON.parse(String(s));}catch{return undefined;}};
const nestedKept=(v:unknown)=>!!v&&typeof v==="object"&&Object.values(v).some(x=>x!==null&&typeof x==="object");
const out:Array<Record<string,unknown>>=[];
for(const [variant,systemInstruction] of Object.entries(instructions))for(const [kind,text] of Object.entries(prompts))for(let trial=1;trial<=TRIALS;trial++){
 const contents=conversation(text) as any;
 try{
  const r=await client.models.generateContent({model,contents,config:{temperature:0,maxOutputTokens:1024,systemInstruction,
   tools:[{functionDeclarations:TOOL_DECLARATIONS as any}],toolConfig:{functionCallingConfig:{mode:"ANY" as any}}}});
  const calls=(r.functionCalls??[]).map(c=>({name:c.name,args:c.args}));
  const value=parse(calls.find(c=>c.name==="save_memory")?.args?.value_json);
  out.push({variant,prompt:kind,trial,calls,
   nestedReachedServer:kind==="flat"?null:nestedKept(value),
   flatFactsKept:kind==="flat"?/Dana Whitfield/.test(JSON.stringify(value))&&/2026-11-20/.test(JSON.stringify(value)):null});
 }catch(error){out.push({variant,prompt:kind,trial,error:String(error).slice(0,300)});}
}
const summary=Object.fromEntries(Object.keys(instructions).map(v=>[v,Object.fromEntries(Object.keys(prompts).map(k=>{
 const rows=out.filter(o=>o.variant===v&&o.prompt===k);
 return [k,`${rows.filter(o=>k==="flat"?o.flatFactsKept:o.nestedReachedServer).length}/${rows.length} ${k==="flat"?"saved with both facts":"reached the server still nested"}`];
}))]));
console.log(JSON.stringify({ranAt:new Date().toISOString(),model,location,config:"temperature 0, maxOutputTokens 1024, mode ANY, production declarations, consent GRANTED",fidelitySentence:FIDELITY,transcript:process.env.TRANSCRIPT??"empty",earlierEvents:earlier.length,summary,results:out},null,1));
