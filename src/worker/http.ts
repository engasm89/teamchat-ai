import {failExhaustedDispatch,failExhaustedJob,recoverableJobs} from "../server/ai-jobs.ts";
import {createVertexEmbedder} from "./embeddings.ts";
import {createServer} from "node:http";
import {createPgPool,assertRuntimeDbRole} from "../server/database.ts";
import {executeAiJob,createGeminiProvider} from "./gemini.ts";
import {dispatchJob,validateDispatchConfig} from "../server/task-dispatch.ts";
import {inTenantTransaction} from "../persistence/postgres.ts";
import {resolvedContext} from "../tenant.ts";
import {TENANTS} from "../types.ts";

async function verifyTaskIdentity(authHeader:string|undefined):Promise<void>{
 const bearer=/^Bearer (\S+)$/.exec(authHeader??"");
 if(!bearer)throw Error("Unauthorized");
 const audience=process.env.CLOUD_TASKS_AUDIENCE,expected=process.env.CLOUD_TASKS_INVOKER_EMAIL;
 if(!audience||!expected)throw Error("OIDC validation not configured");
 const path="google-auth-library";const imported=await import(path);
 const OAuth2Client=imported.OAuth2Client??imported.default?.OAuth2Client;
 if(!OAuth2Client)throw Error("OAuth2Client export unavailable");
 const ticket=await new OAuth2Client().verifyIdToken({idToken:bearer[1],audience});
 const payload=ticket.getPayload();
 if(payload?.email!==expected||payload.email_verified!==true)throw Error("Unauthorized");
}
export async function startWorker(){
 validateDispatchConfig();
 const pool=await createPgPool();
 try{
 await assertRuntimeDbRole(pool);
 const provider=await createGeminiProvider();
 const embeddings=await createVertexEmbedder();
 const server=createServer(async(req,res)=>{
  if(req.url==="/health"||req.url==="/healthz"){res.writeHead(200);res.end("ok");return;}
  if(req.method!=="POST"||!["/internal/turn","/internal/dispatch"].includes(req.url??"")){res.writeHead(404);res.end();return;}
  try{
   await verifyTaskIdentity(req.headers.authorization);
   const chunks:Buffer[]=[];let length=0;
   for await(const chunk of req){length+=chunk.length;if(length>4096)throw Error("Request too large");chunks.push(chunk);}
   const data=JSON.parse(Buffer.concat(chunks).toString()||"{}");
   if(req.url==="/internal/turn"){
    if(typeof data.turnId!=="string")throw Error("Invalid turn ID");
    const result=await executeAiJob(pool,provider,data.turnId,embeddings);
    // A busy job is not acknowledged; Cloud Tasks may retry later.
    if(result.status==="busy"){res.writeHead(503);res.end("Busy");return;}
   }else{
    // Trusted scheduler triggers outbox recovery. Enumerate only the two assessment tenants.
    for(const tenant of TENANTS){
     const ctx=resolvedContext("internal-dispatch",tenant);
     const due=await recoverableJobs(pool,ctx);
     for(const turn_id of due){
      if(await failExhaustedJob(pool,ctx,turn_id))continue;
      if(await failExhaustedDispatch(pool,ctx,turn_id))continue;
      try{await dispatchJob(pool,ctx,turn_id);}catch{/* next scheduled recovery */}
     }
    }
   }
   res.writeHead(200);res.end("ok");
  }catch(e){console.error("Private worker call failed",e instanceof Error?e.message:"error");res.writeHead(500);res.end("Unable to process");}
 });
 await new Promise<void>((resolve,reject)=>server.listen(Number(process.env.PORT||8081),()=>resolve()).once("error",reject));
 return {server,pool,async close(){await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end();}};
 }catch(error){await pool.end();throw error;}
}
