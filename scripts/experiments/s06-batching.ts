/** Experiment: after get_store_assortment, does Gemini price "closing the gaps" with one
 * calculate_uplift call holding every gap code, or one code per call (which exhausts the worker's
 * six-round budget and fails the turn)? Replays round 2 of a recorded live S06 turn: the same
 * room transcript, the recorded tool result, production config (streaming, temperature 0, mode
 * AUTO, maxOutputTokens 1024). Only the calculate_uplift declaration (and optionally one
 * EXTRA_INSTRUCTION sentence) varies; TRIALS sets trials per variant. Read-only.
 *   node --experimental-strip-types scripts/experiments/s06-batching.ts <s06 evidence json> <requester uid> [description] [add_codes description] */
import fs from "node:fs";
import {GoogleGenAI} from "@google/genai";
import {TOOL_DECLARATIONS} from "../../src/tools.ts";
import {trustedPlannerInstructions,buildPlannerUserMessage} from "../../src/worker/gemini.ts";
import {openDb,authoritativeEvents} from "../acceptance/common.ts";
import * as oracle from "../acceptance/oracle.ts";

const [evidencePath,uid,description,addCodesDescription]=process.argv.slice(2) as [string,string,string?,string?];
const project="focus-clean-4b9f4",location="us-central1",model="gemini-2.5-flash",TRIALS=Number(process.env.TRIALS??8);
const EXTRA=process.env.EXTRA_INSTRUCTION??"";
const turn=JSON.parse(fs.readFileSync(evidencePath,"utf8"));
const lookup=turn.toolTrace.find((t:any)=>t.name==="get_store_assortment");
const gaps=oracle.store("northside-outfitters","ST-4007")!.suspected_gaps.map(g=>g.catalog_code).sort();

type Ev={type:string;payload:Record<string,unknown>;sequence:number};
const pool=await openDb();
let earlier:Ev[];
try{
 const events=await authoritativeEvents(pool,turn.tenant,uid,turn.room,0) as Ev[];
 earlier=events.filter(e=>e.sequence<turn.messageSequence&&(e.type==="message"||e.type==="ai_answer_block")).slice(-15);
}finally{await pool.end();}
const userText=buildPlannerUserMessage([...earlier,{type:"message",payload:{author_uid:uid,body:turn.prompt},sequence:turn.messageSequence}],uid,turn.messageSequence);
const contents=[
 {role:"user",parts:[{text:userText}]},
 {role:"model",parts:[{functionCall:{name:"get_store_assortment",args:lookup.arguments}}]},
 {role:"user",parts:[{functionResponse:{name:"get_store_assortment",response:{data:lookup.result}}}]},
];
const production=TOOL_DECLARATIONS.find(t=>t.name==="calculate_uplift")!;
const clarified={...production,description:description??production.description,parameters:{...production.parameters,properties:{...production.parameters.properties,
 add_codes:{...production.parameters.properties.add_codes,...(addCodesDescription?{description:addCodesDescription}:{})}}}};
const variants={"production":production,...(description||addCodesDescription?{"clarified":clarified}:{})};
const client=new GoogleGenAI({vertexai:true,project,location});
const results:Array<Record<string,unknown>>=[];
for(const [variant,decl] of Object.entries(variants))for(let trial=1;trial<=TRIALS;trial++){
 const tools=[{functionDeclarations:TOOL_DECLARATIONS.map(t=>t.name==="calculate_uplift"?decl:t) as any}];
 try{
  const stream=await client.models.generateContentStream({model,contents:contents as any,config:{temperature:0,tools,maxOutputTokens:1024,
   systemInstruction:trustedPlannerInstructions({roomId:turn.room,memoryConsent:false})+(variant==="clarified"&&EXTRA?` ${EXTRA}`:""),toolConfig:{functionCallingConfig:{mode:"AUTO" as any}}}});
  const calls:Array<{name?:string;args?:Record<string,unknown>}>=[];
  for await(const chunk of stream)calls.push(...(chunk.functionCalls??[]));
  const calcs=calls.filter(c=>c.name==="calculate_uplift");
  const allInOne=calcs.length===1&&JSON.stringify([...(calcs[0]!.args?.add_codes as string[]??[])].sort())===JSON.stringify(gaps);
  results.push({variant,trial,allGapsInOneCall:allInOne,calls:calls.map(c=>({name:c.name,args:c.args}))});
 }catch(error){results.push({variant,trial,error:String(error).slice(0,300)});}
}
const summary=Object.fromEntries(Object.keys(variants).map(v=>{const r=results.filter(x=>x.variant===v);return [v,`${r.filter(x=>x.allGapsInOneCall).length}/${r.length} priced every gap in one call`];}));
console.log(JSON.stringify({ranAt:new Date().toISOString(),model,location,replayedTurn:turn.turnId,gaps,
 config:"round 2 replay; streaming, temperature 0, mode AUTO, maxOutputTokens 1024, consent DENIED; earlier transcript = 15 live room events",
 clarified:variants.clarified?{description,addCodesDescription,extraInstruction:EXTRA}:null,summary,results},null,1));
