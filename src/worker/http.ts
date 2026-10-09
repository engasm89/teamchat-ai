import {createServer} from "node:http";
import {createPgPool} from "../server/database.ts";
import {executeAiJob,createGeminiProvider} from "./gemini.ts";
import {dispatchJob} from "../server/task-dispatch.ts";
import {inTenantTransaction} from "../persistence/postgres.ts";
import {resolvedContext} from "../tenant.ts";
import {TENANTS} from "../types.ts";

async function verifyTaskIdentity(authHeader:string|undefined):Promise<void>{
 const bearer=/^Bearer (\S+)$/.exec(authHeader??"");
 if(!bearer)throw Error("Unauthorized");
 const audience=process.env.CLOUD_TASKS_AUDIENCE,expected=process.env.CLOUD_TASKS_INVOKER_EMAIL;
 if(!audience||!expected)throw Error("OIDC validation not configured");
 const path="google-auth-library";const {OAuth2Client}=await import(path);
 const ticket=await new OAuth2Client().verifyIdToken({idToken:bearer[1],audience});
 const payload=ticket.getPayload();
 if(payload?.email!==expected||payload.email_verified!==true)throw Error("Unauthorized");
}
export async function startWorker(){
 const pool=await createPgPool(),provider=await createGeminiProvider();
 const server=createServer(async(req,res)=>{
  if(req.url==="/healthz"){res.writeHead(200);res.end("ok");return;}
  if(req.method!=="POST"||!["/internal/turn","/internal/dispatch"].includes(req.url??"")){res.writeHead(404);res.end();return;}
  try{
   await verifyTaskIdentity(req.headers.authorization);
   const chunks:Buffer[]=[];let length=0;
   for await(const chunk of req){length+=chunk.length;if(length>4096)throw Error("Request too large");chunks.push(chunk);}
   const data=JSON.parse(Buffer.concat(chunks).toString()||"{}");
   if(req.url==="/internal/turn"){
    if(typeof data.turnId!=="string")throw Error("Invalid turn ID");
    const result=await executeAiJob(pool,provider,data.turnId);
    // A busy job is not acknowledged; Cloud Tasks may retry later.
    if(result.status==="busy"){res.writeHead(503);res.end("Busy");return;}
   }else{
    // Trusted scheduler triggers outbox recovery. Enumerate only the two assessment tenants.
    for(const tenant of TENANTS){
     const ctx=resolvedContext("internal-dispatch",tenant);
     const due=await inTenantTransaction(pool,ctx,async c=>{
      const q=await c.query<{turn_id:string}>("SELECT o.turn_id::text FROM teamchat.task_outbox o JOIN teamchat.ai_jobs j ON j.tenant_id=o.tenant_id AND j.turn_id=o.turn_id WHERE o.tenant_id=$1 AND o.state='pending' AND j.state='queued' AND o.next_retry_at<=now() ORDER BY o.next_retry_at LIMIT 20",[tenant]);return q.rows;
     });
     for(const {turn_id} of due){try{await dispatchJob(pool,ctx,turn_id);}catch{/* later recovery */}}
    }
   }
   res.writeHead(200);res.end("ok");
  }catch(e){console.error("Private worker call failed",e instanceof Error?e.message:"error");res.writeHead(500);res.end("Unable to process");}
 });
 await new Promise<void>((resolve,reject)=>server.listen(Number(process.env.PORT||8081),()=>resolve()).once("error",reject));
 return {server,pool};
}
