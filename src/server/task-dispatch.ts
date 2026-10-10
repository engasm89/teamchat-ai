import {inTenantTransaction,type SqlPool} from "../persistence/postgres.ts";
import type {TenantContext} from "../tenant.ts";
export function validateDispatchConfig(env:NodeJS.ProcessEnv=process.env){
 const queue=env.CLOUD_TASKS_QUEUE_PATH,worker=env.CLOUD_TASKS_WORKER_URL,
  serviceAccount=env.CLOUD_TASKS_INVOKER_EMAIL,audience=env.CLOUD_TASKS_AUDIENCE;
 if(env.LOCAL_TASK_WORKER==="1"||!queue){
  return {queue:"local",worker:"local",serviceAccount:"local",audience:"local"};
 }
 if(!queue||!/^projects\/[^/]+\/locations\/[^/]+\/queues\/[^/]+$/.test(queue)||
  !worker||!/^https:\/\/[^/]+$/.test(worker)||
  !serviceAccount||!/^[^\s@]+@[^\s@]+$/.test(serviceAccount)||
  !audience||!/^https:\/\/[^/]+$/.test(audience))
  throw Error("Cloud Tasks queue, HTTPS private worker, OIDC service account and audience are required");
 return {queue,worker,serviceAccount,audience};
}

/** Atomically reserve one dispatch attempt BEFORE the remote call. A Cloud Tasks
 * outage must consume the bounded retry budget, including attempts that throw.
 * The next_retry_at CAS also prevents simultaneous scheduler/API instances
 * from issuing overlapping task names for the same job. */
export async function reserveDispatchAttempt(pool:SqlPool,ctx:TenantContext,turnId:string):Promise<number|null>{
 return inTenantTransaction(pool,ctx,async c=>{
  const r=await c.query<{dispatch_attempts:number}>(`UPDATE teamchat.task_outbox o
    SET dispatch_attempts=o.dispatch_attempts+1,
        next_retry_at=now()+interval '3 minutes'
    WHERE o.tenant_id=$1 AND o.turn_id=$2::uuid
      AND o.state IN ('pending','dispatched')
      AND o.dispatch_attempts<12 AND o.next_retry_at<=now()
      AND EXISTS (SELECT 1 FROM teamchat.ai_jobs j
                  WHERE j.tenant_id=o.tenant_id AND j.turn_id=o.turn_id
                    AND (j.state='queued' OR (j.state='running' AND j.lease_expires_at<now())))
    RETURNING o.dispatch_attempts`,[ctx.tenantId,turnId]);
  return r.rows.length===1?Number(r.rows[0]!.dispatch_attempts):null;
 });
}
/** Each transient Cloud Tasks client opens gRPC resources. Close it after the
 * request settles, including a rejected request; never mask the original task
 * result with a cleanup exception. The factory seam permits resource-leak tests
 * without loading or contacting a cloud SDK. */
export async function invokeTaskWithClient(
 factory:()=>Promise<{createTask(request:Record<string,unknown>):Promise<unknown>;close():Promise<void>}>,
 request:Record<string,unknown>
):Promise<unknown>{
 const client=await factory();
 try{return await client.createTask(request);}
 finally{
  try{await client.close();}
  catch(error){console.error("Cloud Tasks client cleanup failed",error instanceof Error?error.name:"UnknownError");}
 }
}

/** Dispatch only opaque job IDs; Cloud Tasks OIDC signs private worker requests.
 * The database reservation survives failures and permits bounded recovery. */
export async function dispatchJob(pool:SqlPool,ctx:TenantContext,turnId:string,
 createTaskOverride?:(request:Record<string,unknown>)=>Promise<unknown>):Promise<boolean>{
 const {queue,worker,serviceAccount,audience}=validateDispatchConfig();
 const attempt=await reserveDispatchAttempt(pool,ctx,turnId);
 if(attempt===null)return false; // Another instance has reserved it, or the job is terminal.
 if(queue==="local"){
  // Local environment worker execution
  import("../worker/gemini.ts").then(async ({createGeminiProvider,executeAiJob})=>{
   const {createVertexEmbedder}=await import("../worker/embeddings.ts");
   const provider=await createGeminiProvider();
   const embeddings=await createVertexEmbedder();
   await executeAiJob(pool,provider,turnId,embeddings);
  }).catch(e=>console.error("Local task execution error",e));
  await inTenantTransaction(pool,ctx,async c=>{await c.query(
   `UPDATE teamchat.task_outbox SET state='dispatched'
    WHERE tenant_id=$1 AND turn_id=$2::uuid AND dispatch_attempts=$3`,
   [ctx.tenantId,turnId,attempt]);});
  return true;
 }
 const name=`${queue}/tasks/teamchat-${turnId.replaceAll("-","")}-d${attempt}`;
 const request={parent:queue,task:{name,httpRequest:{httpMethod:"POST",url:`${worker.replace(/\/$/,"")}/internal/turn`,headers:{"Content-Type":"application/json"},oidcToken:{serviceAccountEmail:serviceAccount,audience},body:Buffer.from(JSON.stringify({turnId})).toString("base64")}}};
 const create=createTaskOverride??(async (payload:Record<string,unknown>)=>
  invokeTaskWithClient(async()=>{
   const moduleName="@google-cloud/tasks";const imported=await import(moduleName);
   const CloudTasksClient=imported.CloudTasksClient??imported.default?.CloudTasksClient;
   if(!CloudTasksClient)throw Error("CloudTasksClient export unavailable");
   return new CloudTasksClient();
  },payload));
 try{await create(request);}
 catch(e:unknown){
  // ALREADY_EXISTS: task was created despite an ambiguous response or retry.
  if(!(e&&typeof e==="object"&&"code" in e&&e.code===6))throw e;
 }
 // Mark only this reservation as dispatched. An obsolete attempt must never
 // overwrite a newer reservation's state if the Cloud Tasks request was slow.
 await inTenantTransaction(pool,ctx,async c=>{await c.query(
  `UPDATE teamchat.task_outbox SET state='dispatched'
   WHERE tenant_id=$1 AND turn_id=$2::uuid AND dispatch_attempts=$3`,
  [ctx.tenantId,turnId,attempt]);});
 return true;
}
