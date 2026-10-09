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
/** Dispatches only opaque job IDs; Cloud Tasks OIDC signs requests to a private worker. */
export async function dispatchJob(pool:SqlPool,ctx:TenantContext,turnId:string){
 const {queue,worker,serviceAccount,audience}=validateDispatchConfig();
 const moduleName="@google-cloud/tasks";const imported=await import(moduleName);
 const CloudTasksClient=imported.CloudTasksClient??imported.default?.CloudTasksClient;
 if(!CloudTasksClient)throw Error("CloudTasksClient export unavailable");
 const client=new CloudTasksClient();
 const dispatch=await inTenantTransaction(pool,ctx,async c=>{
  const row=await c.query<{dispatch_attempts:number}>(
   "SELECT dispatch_attempts FROM teamchat.task_outbox WHERE tenant_id=$1 AND turn_id=$2::uuid FOR UPDATE",[ctx.tenantId,turnId]);
  if(row.rows.length!==1)throw Error("Job outbox missing");
  if(row.rows[0]!.dispatch_attempts>=12)throw Error("Job dispatch retry limit reached");
  return row.rows[0]!.dispatch_attempts+1;
 });
 // Rotate task names for recovery after a Cloud Tasks retry window is exhausted;
 // reusing a deleted task name can be rejected by the service tombstone window.
 const name=`${queue}/tasks/teamchat-${turnId.replaceAll("-","")}-d${dispatch}`;
 try{await client.createTask({parent:queue,task:{name,httpRequest:{httpMethod:"POST",url:`${worker.replace(/\/$/,"")}/internal/turn`,headers:{"Content-Type":"application/json"},oidcToken:{serviceAccountEmail:serviceAccount,audience},body:Buffer.from(JSON.stringify({turnId})).toString("base64")}}});}
 catch(e:unknown){if(!(e&&typeof e==="object"&&"code" in e&&e.code===6))throw e;}
 await inTenantTransaction(pool,ctx,async c=>{await c.query(
  "UPDATE teamchat.task_outbox SET state='dispatched',dispatch_attempts=GREATEST(dispatch_attempts,$3),next_retry_at=now()+interval '3 minutes' WHERE tenant_id=$1 AND turn_id=$2::uuid",
  [ctx.tenantId,turnId,dispatch]);});
}
