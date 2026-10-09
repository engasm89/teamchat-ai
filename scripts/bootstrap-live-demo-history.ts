/** Post-deployment history bootstrap. Fails closed unless both tenants contain
 * genuine model-driven, fetched-and-persisted AI turns. Do not fabricate AI
 * conversation rows with SQL or label offline mocks as genuine interactions. */
import {createPgPool,assertRuntimeDbRole,resolveVerifiedIdentity} from "../src/server/database.ts";
import {sendDurableMessage,replayRoom} from "../src/persistence/postgres.ts";
import {createGeminiProvider,executeAiJob} from "../src/worker/gemini.ts";
import {createVertexEmbedder} from "../src/worker/embeddings.ts";

const cases=[
 {tenant:"northside-outfitters",first:process.env.TEST_NORTHSIDE_UID,second:process.env.TEST_NORTHSIDE_UID_2,id:"northside"},
 {tenant:"valley-home-goods",first:process.env.TEST_VALLEY_UID,second:process.env.TEST_VALLEY_UID_2,id:"valley"}
];
if(cases.some(x=>!x.first||!x.second||x.first===x.second))
 throw Error("Two distinct provisioned Firebase UIDs per tenant are required for genuine multi-user demo history");
const db=await createPgPool();
try {
 await assertRuntimeDbRole(db);
 const provider=await createGeminiProvider();
 const embeddings=await createVertexEmbedder();
 for(const p of cases){
  const buyer=await resolveVerifiedIdentity(db,p.first!),colleague=await resolveVerifiedIdentity(db,p.second!);
  if(buyer.tenantId!==p.tenant||colleague.tenantId!==p.tenant)throw Error(`Cross-tenant/misconfigured demo identities for ${p.tenant}`);
  async function message(uid:typeof buyer,roomId:string,suffix:string,body:string){
   const r=await sendDurableMessage(db,uid,{roomId,clientMessageId:`live-demo-${p.id}-${suffix}`,body,allowSharedMemorySave:false});
   if("found" in r)throw Error(`Missing demo membership for ${p.tenant}/${roomId}`);
   return r;
  }
  // These are ordinary attributable team messages; they make no synthetic
  // commercial claim. Repeatable client IDs ensure idempotent re-runs.
  await message(buyer,"category-strategy","strategy-1","Let's review the existing merchandising decisions before we change a range.");
  await message(colleague,"category-strategy","strategy-2","Agreed. We should cite the actual source record for any decision.");
  await message(buyer,"assortment-review","buyer-1","Can we check the actual product catalog before making a buying decision?");
  await message(colleague,"assortment-review","colleague-1","Yes, please show the verified results to everyone in the room.");
  const turn=await message(buyer,"assortment-review","ai-1","@AI Please search the supplied catalog for portable air conditioners and show their real codes and margin classes.");
  if(!turn.aiTurnId)throw Error(`Missing persisted AI job for ${p.tenant}`);
  const ran=await executeAiJob(db,provider,turn.aiTurnId,embeddings);
  if(ran.status!=="completed")throw Error(`Genuine AI turn not complete for ${p.tenant}: ${ran.status}`);
  const events=await replayRoom(db,buyer,"assortment-review",0,500);
  if(!Array.isArray(events)||!events.some(e=>e.type==="ai_tool"&&e.payload.name==="search_catalog"&&Array.isArray(e.payload.result)&&e.payload.result.length>0)||
    !events.some(e=>e.type==="ai_complete"))throw Error(`Real source-backed AI fetch trace missing for ${p.tenant}`);
  console.log(`Verified live multi-user history and Gemini catalog fetch for ${p.tenant}`);
 }
} finally {await db.end();}
