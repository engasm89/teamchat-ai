/** Shared plumbing for runners that test the deployed stack. Nothing here
 * decides a verdict; it binds a run to the deployment and reads ground truth. */
import fs from "node:fs";
import {execFileSync} from "node:child_process";
import {GCP,keychainPassword,liveDeployment,loadProvenance,type DeploymentRef} from "../evidence/lib.ts";
import {createPgPool} from "../../src/server/database.ts";
import {replayRoom,inTenantTransaction,type PersistedEvent,type SqlPool} from "../../src/persistence/postgres.ts";
import {resolvedContext} from "../../src/tenant.ts";

export const APP_URL="https://focus-clean-4b9f4.web.app";
export const API_URL="https://teamchat-api-1068908463902.us-central1.run.app";
export const WS_URL="wss://teamchat-api-1068908463902.us-central1.run.app/ws";
export const ACCOUNTS={
 n1:{email:"northside.buyer1@teamchat.internal",tenant:"northside-outfitters"},
 n2:{email:"northside.buyer2@teamchat.internal",tenant:"northside-outfitters"},
 n3:{email:"northside.analyst3@teamchat.internal",tenant:"northside-outfitters"},
 v1:{email:"valley.buyer1@teamchat.internal",tenant:"valley-home-goods"},
 v2:{email:"valley.buyer2@teamchat.internal",tenant:"valley-home-goods"},
 v3:{email:"valley.analyst3@teamchat.internal",tenant:"valley-home-goods"},
} as const;
export type AccountKey=keyof typeof ACCOUNTS;
/** QA traffic stays out of the rooms reviewers are asked to use. */
export const QA_ROOM={"northside-outfitters":"supply-planning","valley-home-goods":"pricing"} as const;

export const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
export const tag=(prefix:string)=>`${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`;

/** Refuse to produce evidence unless the live services run the provenance images. */
export function bindDeployment():{sourceSha:string;deployment:DeploymentRef}{
 const provenance=loadProvenance();
 if(!provenance)throw Error("qa_evidence/provenance.json missing; deploy and record provenance first");
 const live=liveDeployment(provenance.api.service,provenance.worker.service);
 if(live.apiDigest!==provenance.api.digest||live.workerDigest!==provenance.worker.digest)
  throw Error(`Live images ${live.apiDigest}/${live.workerDigest} differ from provenance ${provenance.api.digest}/${provenance.worker.digest}`);
 return {sourceSha:provenance.source.sha,deployment:{...live,hostingVersion:provenance.hosting.releaseVersion}};
}

export function firebaseApiKey():string{
 if(process.env.FIREBASE_API_KEY)return process.env.FIREBASE_API_KEY;
 const env="apps/web/.env.production";
 const key=fs.existsSync(env)?/^VITE_FIREBASE_API_KEY=(.+)$/m.exec(fs.readFileSync(env,"utf8"))?.[1]?.trim():undefined;
 if(!key)throw Error("Set FIREBASE_API_KEY (the public web API key)");
 return key;
}
export async function firebaseSignIn(account:AccountKey):Promise<{uid:string;idToken:string;email:string;tenant:string}>{
 const {email,tenant}=ACCOUNTS[account];
 const res=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseApiKey()}`,{
  method:"POST",headers:{"content-type":"application/json"},
  body:JSON.stringify({email,password:keychainPassword(email),returnSecureToken:true})});
 if(!res.ok)throw Error(`Firebase sign-in failed for ${email}: HTTP ${res.status}`);
 const body=await res.json() as {localId:string;idToken:string};
 return {uid:body.localId,idToken:body.idToken,email,tenant};
}

/** Read-only access through cloud-sql-proxy as the restricted runtime role. */
export async function openDb():Promise<SqlPool&{end():Promise<void>}>{
 const url=execFileSync("gcloud",["secrets","versions","access","latest","--secret=teamchat-database-url","--project",GCP.project],{encoding:"utf8"}).trim();
 // Never let a parse error echo the URL: it contains the password.
 const m=/^postgres(?:ql)?:\/\/([^:/@]+):([^@]+)@[^/]*\/([A-Za-z0-9_]+)/.exec(url);
 if(!m)throw Error("teamchat-database-url secret is not in the expected postgres://user:password@host/db form");
 const port=process.env.DB_PROXY_PORT??"6543";
 const local=`postgres://${encodeURIComponent(m[1]!)}:${encodeURIComponent(decodeURIComponent(m[2]!))}@127.0.0.1:${port}/${m[3]}`;
 process.env.PG_POOL_MAX??="3";
 const pool=await createPgPool(local);
 const c=await pool.connect();
 try{const who=await c.query<{u:string}>("SELECT current_user AS u");if(who.rows[0]?.u!=="teamchat_api")throw Error("Unexpected DB role");}
 finally{c.release();}
 return pool;
}

export async function authoritativeEvents(pool:SqlPool,tenant:string,uid:string,room:string,after:number):Promise<PersistedEvent[]>{
 const ctx=resolvedContext(uid,tenant);const all:PersistedEvent[]=[];let cursor=after;
 for(;;){
  const page=await replayRoom(pool,ctx,room,cursor,500);
  if(!Array.isArray(page))throw Error(`Room ${room} not readable for ${uid}`);
  all.push(...page.map(e=>({...e,sequence:Number(e.sequence)})));
  if(page.length<500)return all;
  cursor=Number(page.at(-1)!.sequence);
 }
}
export async function lastSequence(pool:SqlPool,tenant:string,uid:string,room:string):Promise<number>{
 return inTenantTransaction(pool,resolvedContext(uid,tenant),async c=>{
  const r=await c.query<{s:string|null}>("SELECT max(sequence)::text AS s FROM teamchat.room_events WHERE tenant_id=$1 AND room_id=$2",[tenant,room]);
  return Number(r.rows[0]?.s??0);
 });
}

/** The visible projection the brief requires: every persisted event in order,
 * except answer blocks that a later reset for the same turn superseded. */
export function expectedProjection(events:readonly PersistedEvent[]):PersistedEvent[]{
 const ordered=[...events].sort((a,b)=>Number(a.sequence)-Number(b.sequence));
 const reset=new Map<string,number>();
 for(const e of ordered)if(e.type==="ai_answer_reset"&&e.turn_id)reset.set(e.turn_id,Number(e.sequence));
 return ordered.filter(e=>e.type!=="ai_answer_block"||!e.turn_id||Number(e.sequence)>=(reset.get(e.turn_id)??0));
}

export interface ProjectionItem {id:string;seq:number;turn:string|null;type:string}
/** Compare a rendered projection with the authoritative one, item by item. */
export function compareProjection(actual:readonly ProjectionItem[],expected:readonly PersistedEvent[]){
 const ids=actual.map(a=>a.id);
 const duplicates=[...new Set(ids.filter((id,i)=>ids.indexOf(id)!==i))];
 const expectedIds=expected.map(e=>e.event_id);
 const missing=expectedIds.filter(id=>!ids.includes(id));
 const unexpected=ids.filter(id=>!expectedIds.includes(id));
 const seqs=actual.map(a=>a.seq);
 const ordered=seqs.every((s,i)=>i===0||s>seqs[i-1]!);
 const exact=JSON.stringify(ids)===JSON.stringify(expectedIds);
 return {exact,ordered,duplicates,missing,unexpected,actualCount:ids.length,expectedCount:expectedIds.length};
}
