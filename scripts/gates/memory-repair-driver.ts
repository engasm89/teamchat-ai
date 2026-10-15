/** Runs the real worker loop (executeAiJob) from a clean clone against a local database, with a
 * scripted model, and prints what was persisted. Used by the MEMORY-REPAIR gate.
 *   DATABASE_URL=... node --experimental-strip-types scripts/gates/memory-repair-driver.ts <clone> <uid> <room> <embeddingModel> */
import path from "node:path";
import crypto from "node:crypto";

const [clone,uid,room,embeddingModel]=process.argv.slice(2) as [string,string,string,string];
const load=(rel:string)=>import(path.join(clone,rel));
const {createPgPool}=await load("src/server/database.ts");
const {sendDurableMessage,replayRoom,inTenantTransaction}=await load("src/persistence/postgres.ts");
const {executeAiJob}=await load("src/worker/gemini.ts");
const {resolvedContext}=await load("src/tenant.ts");

const pool=await createPgPool(process.env.DATABASE_URL);
const ctx=resolvedContext(uid,"northside-outfitters");
const embeddings={modelId:embeddingModel,embed:async()=>Array.from({length:768},(_,i)=>i===0?1:0)};
const leads=[{name:"Ana",shifts:[{day:"Mon",stores:["ST-4001","ST-4002"]}]},{name:"Ben",shifts:[{day:"Tue",stores:["ST-4003"]}]}];

/** The user types `supplied`; the scripted model's first save sends `modelValue` (by default the same). */
async function scenario(label:string,supplied:Record<string,unknown>,retryAfterRepair:boolean,modelValue=supplied){
 const key=`gate-${label}-${crypto.randomBytes(3).toString("hex")}`;
 const sent=await sendDurableMessage(pool,ctx,{roomId:room,clientMessageId:crypto.randomUUID(),body:`@AI Remember this as ${key}: ${JSON.stringify(supplied,null,1)}`,allowSharedMemorySave:true});
 if(!sent.aiTurnId)throw Error("No AI turn was created");
 const rounds:number[]=[];
 const call=(id:string,args:Record<string,unknown>)=>{const c={id,name:"save_memory",args};return {text:"",functionCalls:[c],content:{role:"model" as const,parts:[{functionCall:c}]}};};
 const provider={
  async round(){
   rounds.push(rounds.length);
   if(rounds.length===1)return call("call-1",{key,room,value_json:JSON.stringify(modelValue)});
   if(retryAfterRepair&&rounds.length===2)return call("call-2",{key,room,value_json:JSON.stringify({note:"model retry"})});
   return {text:"Done.",functionCalls:[],content:{role:"model" as const,parts:[{text:"Done."}]}};
  },
  // An empty reply: the server falls back to rendering the save outcome itself.
  async *compose(){yield "[]";},
 };
 const first=await executeAiJob(pool,provider,sent.aiTurnId,embeddings);
 const eventsAfterFirst=(await replayRoom(pool,ctx,room,sent.sequence,500)).filter((e:any)=>e.turn_id===sent.aiTurnId);
 const again=await executeAiJob(pool,provider,sent.aiTurnId,embeddings);
 const events=(await replayRoom(pool,ctx,room,sent.sequence,500)).filter((e:any)=>e.turn_id===sent.aiTurnId);
 const stored=await inTenantTransaction(pool,ctx,async(c:any)=>(await c.query("SELECT key,value FROM teamchat.memories WHERE tenant_id=$1 AND key=$2",[ctx.tenantId,key])).rows);
 return {key,turnId:sent.aiTurnId,first,again,modelRounds:rounds.length,eventCountAfterFirstRun:eventsAfterFirst.length,eventCountAfterSecondRun:events.length,
  tools:events.filter((e:any)=>e.type==="ai_tool").map((e:any)=>e.payload),
  answerBlocks:events.filter((e:any)=>e.type==="ai_answer_block").map((e:any)=>e.payload.verified?.template),
  terminal:events.filter((e:any)=>["ai_complete","ai_failed"].includes(e.type)).map((e:any)=>e.type),stored};
}

const out={
 nested:await scenario("nested",{leads,site:"north"},false),
 reshaped:await scenario("reshaped",{leads,site:"north"},false,{leads:"Ana: Mon (ST-4001, ST-4002); Ben: Tue (ST-4003)",site:"north"}),
 unrepairable:await scenario("unrepairable",{leads:Array.from({length:60},(_,i)=>({name:`Lead ${i}`,stores:["ST-4001","ST-4002","ST-4003"]}))},true),
 originalLeads:leads,
};
await pool.end();
console.log(JSON.stringify(out));
