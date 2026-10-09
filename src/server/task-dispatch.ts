import {inTenantTransaction,type SqlPool} from "../persistence/postgres.ts";
import type {TenantContext} from "../tenant.ts";
export function validateDispatchConfig(env:NodeJS.ProcessEnv=process.env){
 const queue=env.CLOUD_TASKS_QUEUE_PATH,worker=env.CLOUD_TASKS_WORKER_URL,
  serviceAccount=env.CLOUD_TASKS_INVOKER_EMAIL,audience=env.CLOUD_TASKS_AUDIENCE;
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
/** Dispatch only opaque job IDs; Cloud Tasks OIDC signs private worker requests.
 * The database reservation survives failures and permits bounded recovery. */
export async function dispatchJob(pool:SqlPool,ctx:TenantContext,turnId:string,
 createTaskOverride?:(request:Record<string,unknown>)=>Promise<unknown>):Promise<boolean>{
 const {queue,worker,serviceAccount,audience}=validateDispatchConfig();
 const attempt=await reserveDispatchAttempt(pool,ctx,turnId);
 if(attempt===null)return false; // Another instance has reserved it, or the job is terminal.
 const name=`${queue}/tasks/teamchat-${turnId.replaceAll("-","")}-d${attempt}`;
 const request={parent:queue,task:{name,httpRequest:{httpMethod:"POST",url:`${worker.replace(/\/$/,"")}/internal/turn`,headers:{"Content-Type":"application/json"},oidcToken:{serviceAccountEmail:serviceAccount,audience},body:Buffer.from(JSON.stringify({turnId})).toString("base64")}}};
 const create= createTaskOverride??(async (payload:Record<string,unknown>)=>{
   const moduleName="@google-cloud/tasks";const imported=await import(moduleName);
   const CloudTasksClient=imported.CloudTasksClient??imported.default?.CloudTasksClient;
   if(!CloudTasksClient)throw Error("CloudTasksClient export unavailable");
   await new CloudTasksClient().createTask(payload);
 });
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
