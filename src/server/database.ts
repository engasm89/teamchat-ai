import type {SqlPool,SqlClient,QueryResult} from "../persistence/postgres.ts";
import {resolvedContext,type TenantContext} from "../tenant.ts";

/** Adapter for a real `pg` Pool. Import is lazy to permit offline contract tests. */
export async function createPgPool(connectionString=process.env.DATABASE_URL):Promise<SqlPool & {end():Promise<void>}> {
 if(!connectionString)throw new Error("DATABASE_URL is required");
 const moduleName="pg";
 const {Pool}=await import(moduleName);
 const raw=new Pool({connectionString,max:Math.max(1,Math.min(10,Number(process.env.PG_POOL_MAX||5))),
   connectionTimeoutMillis:5000,idleTimeoutMillis:15000,allowExitOnIdle:false});
 return raw as SqlPool & {end():Promise<void>};
}

/** Call ONLY with verified Firebase UID. The resolver function cannot receive a tenant override.
 * Database role may execute this function, but may not SELECT from the auth directory. */
export async function resolveVerifiedIdentity(pool:SqlPool,uid:string):Promise<TenantContext> {
 if(typeof uid!=="string"||!uid||uid.length>200)throw new Error("Unauthorized");
 const client=await pool.connect();
 try {
  const result=await client.query<{tenant_id:string}>("SELECT teamchat.resolve_tenant_for_uid($1) AS tenant_id",[uid]);
  const tenant=result.rows[0]?.tenant_id;
  if(!tenant)throw new Error("Unauthorized");
  // Membership MUST remain active, checked inside tenant-local RLS scope.
  await client.query("BEGIN");
  try{
   await client.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);
   const member=await client.query("SELECT 1 FROM teamchat.user_memberships WHERE tenant_id=$1 AND firebase_uid=$2 AND active=true",[tenant,uid]);
   if(member.rows.length!==1)throw new Error("Unauthorized");
   await client.query("COMMIT");
  }catch(e){await client.query("ROLLBACK");throw e;}
  return resolvedContext(uid,tenant);
 }finally{client.release();}
}
export interface FirebaseIdentityVerifier {verify(token:string):Promise<string>}
export async function createFirebaseVerifier():Promise<FirebaseIdentityVerifier>{
 const path="firebase-admin/app", authPath="firebase-admin/auth";
 const app=await import(path), auth=await import(authPath);
 if(!app.getApps().length)app.initializeApp();
 const instance=auth.getAuth();
 return {async verify(token:string){
  if(typeof token!=="string"||token.length>10000||!token)throw new Error("Unauthorized");
  const claims=await instance.verifyIdToken(token,true);
  if(!claims.uid||claims.firebase?.sign_in_provider==="anonymous")throw new Error("Unauthorized");
  return claims.uid as string;
 }};
}

export interface SqlNotification {channel:string;payload?:string}
export interface PgListener extends SqlClient {on(event:"notification",listener:(message:SqlNotification)=>void):void;on(event:"error"|"end",listener:(error?:Error)=>void):void;removeAllListeners(event?:string):void;}
/** Dedicated LISTEN client; never use a transaction-pool query connection for listener. */
export async function connectEventListener(connectionString=process.env.DATABASE_URL):Promise<{client:PgListener,close():Promise<void>}>{
 if(!connectionString)throw new Error("DATABASE_URL is required");
 const moduleName="pg";const {Client}=await import(moduleName);
 const client=new Client({connectionString,connectionTimeoutMillis:5000,keepAlive:true}) as PgListener & {connect():Promise<void>;end():Promise<void>};
 await client.connect();await client.query("LISTEN teamchat_events");await client.query("LISTEN teamchat_presence");await client.query("LISTEN teamchat_typing");
 return {client,close:()=>client.end()};
}
