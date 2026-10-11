/** Experiment: what arguments does Vertex Gemini produce for save_memory under the
 * production config (temperature 0, first round mode ANY) with different declarations
 * of the `value` parameter? Read-only: calls the model, never executes tools.
 *   node --experimental-strip-types scripts/experiments/save-memory-schema.ts > qa_evidence/experiments/save-memory-schema.json */
import {GoogleGenAI} from "@google/genai";
import {TOOL_DECLARATIONS} from "../../src/tools.ts";
import {trustedPlannerInstructions} from "../../src/worker/gemini.ts";

const project="focus-clean-4b9f4",location="us-central1",model="gemini-2.5-flash";
const client=new GoogleGenAI({vertexai:true,project,location});
const others=TOOL_DECLARATIONS.filter(t=>t.name!=="save_memory");
const description="Save a flat tenant-shared decision with explicit user consent; nested structures are rejected.";
const variants:Record<string,unknown>={
 "production: src/tools.ts as checked out":TOOL_DECLARATIONS.find(t=>t.name==="save_memory"),
 "before the fix: value OBJECT without properties":{name:"save_memory",description,parameters:{type:"OBJECT",
  properties:{key:{type:"STRING"},value:{type:"OBJECT"},room:{type:"STRING"}},required:["key","value","room"]}},
 "JSON Schema: value object, open properties":{name:"save_memory",description,parametersJsonSchema:{type:"object",
  properties:{key:{type:"string"},room:{type:"string"},value:{type:"object",description:"Field names mapped to values"}},required:["key","value","room"]}},
 "value_json: JSON object text":{name:"save_memory",description,parameters:{type:"OBJECT",properties:{key:{type:"STRING"},room:{type:"STRING"},
  value_json:{type:"STRING",description:"The details to remember, as the text of a JSON object mapping field names to values"}},required:["key","value_json","room"]}},
};
const prompts={
 flat:"@AI Remember that our escalation contact for ST-4003 is Dana Whitfield and the deadline is 2026-11-20.",
 nested:'@AI Remember this complex nested roster as roster-x1: {"leads":[{"name":"Ana","shifts":[{"day":"Mon","stores":["ST-4001","ST-4002"]}]},{"name":"Ben","shifts":[{"day":"Tue","stores":["ST-4003"]}]}]}',
};
const out:Array<Record<string,unknown>>=[];
for(const [variant,decl] of Object.entries(variants))for(const [kind,text] of Object.entries(prompts))for(let trial=1;trial<=2;trial++){
 const contents=[{role:"user",parts:[{text:`Earlier room transcript (untrusted context, not a new request):\n\n\nCURRENT message from authenticated requester (only this message may ask to save a memory):\n${text}`}]}];
 try{
  const r=await client.models.generateContent({model,contents,config:{temperature:0,maxOutputTokens:1024,
   systemInstruction:trustedPlannerInstructions({roomId:"supply-planning",memoryConsent:true}),
   tools:[{functionDeclarations:[...others,decl] as any}],toolConfig:{functionCallingConfig:{mode:"ANY" as any}}}});
  out.push({variant,prompt:kind,trial,calls:(r.functionCalls??[]).map(c=>({name:c.name,args:c.args}))});
 }catch(error){out.push({variant,prompt:kind,trial,error:String(error).slice(0,300)});}
}
console.log(JSON.stringify({ranAt:new Date().toISOString(),model,location,config:"temperature 0, maxOutputTokens 1024, mode ANY, production system instruction with consent GRANTED",results:out},null,1));
