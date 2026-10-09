import {inTenantTransaction,type SqlPool} from "../persistence/postgres.ts";
import type {TenantContext} from "../tenant.ts";
/** Dispatches only opaque job IDs; Cloud Tasks OIDC signs requests to a private worker. */
export async function dispatchJob(pool:SqlPool,ctx:TenantContext,turnId:string){
 const queue=process.env.CLOUD_TASKS_QUEUE_PATH,worker=process.env.CLOUD_TASKS_WORKER_URL,
  serviceAccount=process.env.CLOUD_TASKS_INVOKER_EMAIL,audience=process.env.CLOUD_TASKS_AUDIENCE;
 if(!queue||!worker||!serviceAccount||!audience)throw Error("Cloud Tasks configuration missing");
 if(!/^https:\/\//.test(worker))throw Error("Worker must use HTTPS");
 const moduleName="@google-cloud/tasks";const {CloudTasksClient}=await import(moduleName);
 const client=new CloudTasksClient();
 const name=`${queue}/tasks/teamchat-${turnId.replaceAll("-","")}`;
 try{await client.createTask({parent:queue,task:{name,httpRequest:{httpMethod:"POST",url:`${worker.replace(/\/$/,"")}/internal/turn`,headers:{"Content-Type":"application/json"},oidcToken:{serviceAccountEmail:serviceAccount,audience},body:Buffer.from(JSON.stringify({turnId})).toString("base64")}}});}
 catch(e:unknown){if(!(e&&typeof e==="object"&&"code" in e&&e.code===6))throw e;}
 await inTenantTransaction(pool,ctx,async c=>{await c.query("UPDATE teamchat.task_outbox SET state='dispatched',dispatch_attempts=dispatch_attempts+1 WHERE tenant_id=$1 AND turn_id=$2::uuid",[ctx.tenantId,turnId]);});
}
