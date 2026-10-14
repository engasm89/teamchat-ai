/** Which deployed stack a live runner talks to. There is no default: every run
 * names its target (TEAMCHAT_TARGET=staging|production, or TEAMCHAT_TARGET_FILE). */
import fs from "node:fs";
import {execFileSync} from "node:child_process";
import {TENANTS,type TenantId} from "../../src/types.ts";

export type AccountKey="n1"|"n2"|"n3"|"v1"|"v2"|"v3";
export const ACCOUNT_KEYS:readonly AccountKey[]=["n1","n2","n3","v1","v2","v3"];
export interface Target {
 name:string;project:string;region:string;
 appUrl:string;apiUrl:string;workerUrl:string;
 apiService:string;workerService:string;
 database:string;databaseSecret:string;dbRole:string;
 keychainService:string;provenance:string;
 accounts:Record<AccountKey,{email:string;tenant:TenantId}>;
}

const TARGETS_DIR="config/targets";
const STRING_FIELDS=["name","project","region","appUrl","apiUrl","workerUrl","apiService","workerService","database","databaseSecret","dbRole","keychainService","provenance"] as const;

export function parseTarget(raw:unknown,source:string):Target{
 const t=raw as Partial<Target>;
 for(const f of STRING_FIELDS)if(typeof t?.[f]!=="string"||!t[f])throw Error(`${source}: missing ${f}`);
 for(const f of ["appUrl","apiUrl","workerUrl"] as const)if(!/^https:\/\/[^/]+$/.test(t[f]!))throw Error(`${source}: ${f} must be an https origin`);
 for(const k of ACCOUNT_KEYS){
  const a=t.accounts?.[k];
  if(!a||typeof a.email!=="string"||!(TENANTS as readonly string[]).includes(a.tenant))throw Error(`${source}: account ${k} needs an email and a known tenant`);
 }
 return t as Target;
}

export function readTarget(file:string):Target{
 return parseTarget(JSON.parse(fs.readFileSync(file,"utf8")),file);
}

export function loadTarget(env:NodeJS.ProcessEnv=process.env):Target{
 const file=env.TEAMCHAT_TARGET_FILE??(env.TEAMCHAT_TARGET?`${TARGETS_DIR}/${env.TEAMCHAT_TARGET}.json`:undefined);
 if(!file)throw Error("Set TEAMCHAT_TARGET=staging|production (or TEAMCHAT_TARGET_FILE); live runners have no default target");
 if(env.TEAMCHAT_TARGET&&!/^[a-z][a-z0-9-]*$/.test(env.TEAMCHAT_TARGET))throw Error("TEAMCHAT_TARGET must be a bare target name");
 if(!fs.existsSync(file))throw Error(`Target file ${file} not found`);
 return readTarget(file);
}

const origin=(url:string)=>new URL(url).origin;

/** Static half of the S19 guard: every identifier that could reach production
 * must differ from the production target's. Returns the reasons to refuse. */
export function productionCollisions(target:Target,production:Target):string[]{
 const reasons:string[]=[];
 if(target.name===production.name)reasons.push(`target is named ${production.name}`);
 for(const svc of [target.apiService,target.workerService])
  if([production.apiService,production.workerService].includes(svc))reasons.push(`service ${svc} is a production service`);
 const prodUrls=new Set([production.appUrl,production.apiUrl,production.workerUrl].map(origin));
 for(const url of [target.appUrl,target.apiUrl,target.workerUrl])
  if(prodUrls.has(origin(url)))reasons.push(`${url} is a production URL`);
 if(target.database===production.database)reasons.push(`database ${target.database} is the production database`);
 if(target.databaseSecret===production.databaseSecret)reasons.push(`secret ${target.databaseSecret} holds the production database URL`);
 if(target.dbRole===production.dbRole)reasons.push(`role ${target.dbRole} is the production runtime role`);
 if(target.keychainService===production.keychainService)reasons.push(`Keychain service ${target.keychainService} holds production passwords`);
 const prodEmails=new Set(ACCOUNT_KEYS.map(k=>production.accounts[k].email));
 if(ACCOUNT_KEYS.some(k=>prodEmails.has(target.accounts[k].email)))reasons.push("target signs in with production accounts");
 return reasons;
}

type Describe=(service:string,target:Target)=>{urls:string[]};
const gcloudDescribe:Describe=(service,target)=>{
 const svc=JSON.parse(execFileSync("gcloud",["run","services","describe",service,"--region",target.region,"--project",target.project,"--format=json"],{encoding:"utf8"}));
 const extra=svc.metadata?.annotations?.["run.googleapis.com/urls"];
 return {urls:[svc.status?.url,...(extra?JSON.parse(extra) as string[]:[])].filter(Boolean)};
};

/** S19 restarts the services it targets, so it must provably not be production:
 * the static identifiers differ, the services it will update are the ones
 * serving the URLs under test, and none of those URLs serve production. */
export function assertRestartableTarget(target:Target,production=readTarget(`${TARGETS_DIR}/production.json`),describe:Describe=gcloudDescribe):void{
 const reasons=productionCollisions(target,production);
 if(!reasons.length){
  const api=describe(target.apiService,target).urls.map(origin),worker=describe(target.workerService,target).urls.map(origin);
  if(!api.includes(origin(target.apiUrl)))reasons.push(`${target.apiService} does not serve ${target.apiUrl}`);
  if(!worker.includes(origin(target.workerUrl)))reasons.push(`${target.workerService} does not serve ${target.workerUrl}`);
  const prod=new Set([...describe(production.apiService,production).urls,...describe(production.workerService,production).urls].map(origin));
  for(const url of [...api,...worker])if(prod.has(url))reasons.push(`${url} is served by a production service`);
 }
 if(reasons.length)throw Error(`Refusing S19 (it forces new Cloud Run revisions): ${reasons.join("; ")}`);
}
