import {inTenantTransaction,type SqlPool, type SqlClient} from "../persistence/postgres.ts";
import {resolvedContext,type TenantContext} from "../tenant.ts";

/** Adapter for a real `pg` Pool. Import is lazy to permit offline contract tests. */
export async function createPgPool(connectionString=process.env.DATABASE_URL):Promise<SqlPool & {end():Promise<void>}> {
 if(!connectionString)throw new Error("DATABASE_URL is required");
 const moduleName="pg";
 const imported=await import(moduleName);
 const {Pool}=(imported.default??imported) as {Pool:new (config:unknown)=>SqlPool & {end():Promise<void>}};
 const requestedPoolSize=Number(process.env.PG_POOL_MAX??5);
 if(!Number.isSafeInteger(requestedPoolSize)||requestedPoolSize<1||requestedPoolSize>10)throw Error("PG_POOL_MAX must be an integer between 1 and 10");
 const raw=new Pool({connectionString,max:requestedPoolSize,
   connectionTimeoutMillis:5000,idleTimeoutMillis:15000,allowExitOnIdle:false});
 return raw as SqlPool & {end():Promise<void>};
}

/** Refuse to start public or worker services using migration-owner credentials.
 * Checking a configured string is insufficient; inspect PostgreSQL's real role. */
export async function assertRuntimeDbRole(pool:SqlPool):Promise<void>{
 const client=await pool.connect();
 try{
  const row=await client.query<{role_name:string;rolsuper:boolean;rolbypassrls:boolean;table_owner:string}>(`
   SELECT current_user AS role_name,r.rolsuper,r.rolbypassrls,
    pg_get_userbyid(c.relowner) AS table_owner
   FROM pg_roles r JOIN pg_class c ON c.oid='teamchat.stores'::regclass
   WHERE r.rolname=current_user`);
  const r=row.rows[0];
  if(!r||r.role_name!=="teamchat_api"||r.rolsuper||r.rolbypassrls||r.table_owner===r.role_name)
   throw Error("Refusing privileged or unexpected PostgreSQL application role");
 }finally{client.release();}
}

/** Call ONLY with verified Firebase UID. The resolver function cannot receive a tenant override.
 * Database role may execute this function, but may not SELECT from the auth directory. */
export async function resolveVerifiedIdentity(pool:SqlPool,uid:string):Promise<TenantContext> {
 if(typeof uid!=="string"||!uid||uid.length>200)throw new Error("Unauthorized");
 const client=await pool.connect();let tenant:string|undefined;
 try{
  const result=await client.query<{tenant_id:string}>("SELECT teamchat.resolve_tenant_for_uid($1) AS tenant_id",[uid]);
  tenant=result.rows[0]?.tenant_id;
 }finally{client.release();}
 if(!tenant)throw Error("Unauthorized");
 const ctx=resolvedContext(uid,tenant);
 await inTenantTransaction(pool,ctx,async scoped=>{
  const member=await scoped.query("SELECT 1 FROM teamchat.user_memberships WHERE tenant_id=$1 AND firebase_uid=$2 AND active=true",[tenant,uid]);
  if(member.rows.length!==1)throw Error("Unauthorized");
 });
 return ctx;
}
export interface FirebaseIdentityVerifier {
 verify(token:string):Promise<string>;
 /** Signed Firebase expiry, in Unix epoch milliseconds (not decoded without verification). */
 verifyWithExpiry?(token:string):Promise<{uid:string;expiresAtMillis:number}>;
}
export function firebaseProjectId(value=process.env.FIREBASE_PROJECT_ID):string{
 if(typeof value!=="string"||!/^([a-z][a-z0-9-]{4,28}[a-z0-9])$/.test(value))
  throw Error("An explicit FIREBASE_PROJECT_ID is required for token verification");
 return value;
}
export async function createFirebaseVerifier():Promise<FirebaseIdentityVerifier>{
 const projectId=firebaseProjectId();
 const path="firebase-admin/app", authPath="firebase-admin/auth";
 const importedApp=await import(path), importedAuth=await import(authPath);
 const app=importedApp.getApps?importedApp:importedApp.default;
 const auth=importedAuth.getAuth?importedAuth:importedAuth.default;
 if(!app?.getApps||!auth?.getAuth)throw Error("Firebase Admin exports unavailable");
 const active=app.getApps().find((x:{name:string})=>x.name==="[DEFAULT]");
 if(!active)app.initializeApp({projectId});
 else if(active.options?.projectId!==projectId)throw Error("Firebase Admin project does not match FIREBASE_PROJECT_ID");
 const instance=auth.getAuth();
 async function verifiedClaims(token:string):Promise<{uid:string;expiresAtMillis:number}>{
  if(typeof token!=="string"||token.length>10000||!token)throw new Error("Unauthorized");
  const claims=await instance.verifyIdToken(token,false);
  if(!claims.uid||claims.firebase?.sign_in_provider==="anonymous"||
     !Number.isSafeInteger(claims.exp)||claims.exp*1000<=Date.now())
    throw new Error("Unauthorized");
  return {uid:claims.uid as string,expiresAtMillis:claims.exp*1000};
 }
 return {async verify(token:string){return (await verifiedClaims(token)).uid;},
  verifyWithExpiry:verifiedClaims};
}

export interface SqlNotification {channel:string;payload?:string}
export interface PgListener extends SqlClient {on(event:"notification",listener:(message:SqlNotification)=>void):void;on(event:"error"|"end",listener:(error?:Error)=>void):void;removeAllListeners(event?:string):void;}
/** Dedicated LISTEN client; never use a transaction-pool query connection for listener. */
export async function connectEventListener(connectionString=process.env.DATABASE_URL):Promise<{client:PgListener,close():Promise<void>}>{
 if(!connectionString)throw new Error("DATABASE_URL is required");
 const moduleName="pg";const imported=await import(moduleName);
 const {Client}=(imported.default??imported) as {Client:new (config:unknown)=>PgListener & {connect():Promise<void>;end():Promise<void>}};
 const client=new Client({connectionString,connectionTimeoutMillis:5000,keepAlive:true}) as PgListener & {connect():Promise<void>;end():Promise<void>};
 await client.connect();await client.query("LISTEN teamchat_events");await client.query("LISTEN teamchat_presence");await client.query("LISTEN teamchat_typing");
 return {client,close:()=>client.end()};
}
