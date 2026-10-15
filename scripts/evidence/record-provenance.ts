/** Writes the target's provenance file (TEAMCHAT_TARGET; config/targets) from live systems only: Cloud Build results,
 * registry image configs, Cloud Run serving revisions and the Hosting release.
 * Usage: node --experimental-strip-types scripts/evidence/record-provenance.ts --build <id> --clean-clone <dir>
 * If the web build used VITE_* overrides (staging), export the same values when running this. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {execFileSync} from "node:child_process";
import {APPLICATION_PATHS,GCP,gcloudJson,liveDeployment,type Provenance} from "./lib.ts";
import {ACCOUNTS,TARGET,openDb} from "../acceptance/common.ts";

const arg=(name:string)=>{const i=process.argv.indexOf(name);if(i<0||!process.argv[i+1])throw Error(`${name} is required`);return process.argv[i+1]!;};
const buildId=arg("--build"),cleanClone=path.resolve(arg("--clean-clone"));
const SITE=TARGET.project,APP_URL=TARGET.appUrl,CHANNEL=TARGET.hostingChannel??"live";
const sha256=(data:Buffer|string)=>crypto.createHash("sha256").update(data).digest("hex");
const token=execFileSync("gcloud",["auth","print-access-token"],{encoding:"utf8"}).trim();
const google=async(url:string,accept?:string)=>{
 const res=await fetch(url,{headers:{Authorization:`Bearer ${token}`,"x-goog-user-project":GCP.project,...(accept?{Accept:accept}:{})}});
 if(!res.ok)throw Error(`${url} -> ${res.status}`);return res;
};

async function imageConfig(name:string,digest:string){
 const m=/^([^/]+)\/(.+)$/.exec(name.split(":")[0]!)!;
 const manifest=await (await google(`https://${m[1]}/v2/${m[2]}/manifests/${digest}`,"application/vnd.docker.distribution.manifest.v2+json,application/vnd.oci.image.manifest.v1+json")).json() as any;
 const config=await (await google(`https://${m[1]}/v2/${m[2]}/blobs/${manifest.config.digest}`)).json() as any;
 return {labels:config.config.Labels as Record<string,string>,cmd:(config.config.Cmd as string[]).join(" ")};
}

const build=(()=>{
 try{return gcloudJson(["builds","describe",buildId]);}
 catch{return gcloudJson(["builds","describe",buildId,"--region",GCP.region]);}
})();
if(build.status!=="SUCCESS")throw Error(`Build ${buildId} is ${build.status}`);
const sha=build.substitutions?._GIT_SHA as string;
if(!/^[0-9a-f]{40}$/.test(sha??""))throw Error("Build has no _GIT_SHA substitution");
const cloneHead=execFileSync("git",["-C",cleanClone,"rev-parse","HEAD"],{encoding:"utf8"}).trim();
if(cloneHead!==sha)throw Error(`Clean clone is at ${cloneHead}, build used ${sha}`);
if(execFileSync("git",["-C",cleanClone,"status","--porcelain","--untracked-files=no"],{encoding:"utf8"}).trim())throw Error("Clean clone has tracked modifications");
const treeListing=execFileSync("git",["ls-tree","-r",sha,"--",...APPLICATION_PATHS],{encoding:"utf8"});

const live=liveDeployment(TARGET.apiService,TARGET.workerService);
const image=async(service:"api"|"worker")=>{
 const built=(build.results.images as Array<{name:string;digest:string}>).find(i=>i.name.endsWith(`/${service}:${sha}`));
 if(!built)throw Error(`Build ${buildId} produced no ${service}:${sha} image`);
 const servingDigest=service==="api"?live.apiDigest:live.workerDigest;
 if(built.digest!==servingDigest)throw Error(`${service} serves ${servingDigest}, build produced ${built.digest}`);
 const config=await imageConfig(built.name,built.digest);
 if(config.labels["org.opencontainers.image.revision"]!==sha)throw Error(`${service} image revision label is not ${sha}`);
 return {service:service==="api"?TARGET.apiService:TARGET.workerService,revision:service==="api"?live.apiRevision:live.workerRevision,
  image:`${built.name.split(":")[0]}@${built.digest}`,digest:built.digest,labels:config.labels,cmd:config.cmd,buildId};
};
const api=await image("api"),worker=await image("worker");

const release=((await (await google(`https://firebasehosting.googleapis.com/v1beta1/sites/${SITE}/channels/${CHANNEL}/releases?pageSize=1`)).json()) as any).releases[0];
const dist=path.join(cleanClone,"apps/web/dist");
const localBuildAssets:Record<string,string>={};
const walk=(dir:string)=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);
 if(e.isDirectory())walk(p);else localBuildAssets["/"+path.relative(dist,p)]=sha256(fs.readFileSync(p));}};
walk(dist);
const servedAssets:Record<string,string>={};
const index=await (await fetch(`${APP_URL}/`,{cache:"no-store"})).text();
servedAssets["/index.html"]=sha256(index);
for(const ref of index.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g))servedAssets[ref[1]!]=sha256(Buffer.from(await (await fetch(APP_URL+ref[1])).arrayBuffer()));
const assetsMatchLocalBuild=Object.keys(localBuildAssets).length===Object.keys(servedAssets).length&&
 Object.entries(localBuildAssets).every(([k,v])=>servedAssets[k]===v);
if(!assetsMatchLocalBuild)throw Error("Served Hosting assets differ from the clean-clone build");
const envFile=path.join(cleanClone,"apps/web/.env.production");
// Vite lets the build environment override .env.production (staging points the bundle at its own API).
const webEnvOverrides=Object.fromEntries(Object.entries(process.env).filter(([k])=>k.startsWith("VITE_")).sort());

const FIXTURE_DIR="teamchat-ai-assessment/teamchat-ai-seed-data";
const fixtureHashes=Object.fromEntries(fs.readdirSync(FIXTURE_DIR).sort().map(f=>[f,sha256(fs.readFileSync(path.join(FIXTURE_DIR,f)))]));
const pool=await openDb();
const tenants:Record<string,{datasetVersions:Record<string,string>;memories:number;memoriesWithout768Embedding:number}>={};
try{
 for(const tenant of [...new Set(Object.values(ACCOUNTS).map(a=>a.tenant))].sort()){
  const client=await pool.connect();
  try{
   await client.query("BEGIN");await client.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]);
   const versions=await client.query<{filename:string;sha256:string}>("SELECT filename,sha256 FROM teamchat.dataset_versions ORDER BY filename");
   const memories=await client.query<{total:number;missing:number}>(
    "SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE embedding IS NULL OR vector_dims(embedding)<>768)::int AS missing FROM teamchat.memories");
   await client.query("COMMIT");
   tenants[tenant]={datasetVersions:Object.fromEntries(versions.rows.map(r=>[r.filename,r.sha256])),memories:memories.rows[0]!.total,memoriesWithout768Embedding:memories.rows[0]!.missing};
  }finally{client.release();}
 }
}finally{await pool.end();}
const datasetHashesMatchFixtures=Object.values(tenants).every(t=>JSON.stringify(t.datasetVersions)===JSON.stringify(fixtureHashes));
const memoriesWithout768Embedding=Object.values(tenants).reduce((n,t)=>n+t.memoriesWithout768Embedding,0);

const workerEnv=gcloudJson(["run","services","describe",TARGET.workerService,"--region",GCP.region]).spec.template.spec.containers[0].env as Array<{name:string;value?:string}>;
const sql=gcloudJson(["sql","instances","describe","teamchat-pg-instance"]);
const secret=gcloudJson(["secrets","versions","list",TARGET.databaseSecret]) as Array<{name:string;state:string;createTime:string}>;

const provenance:Provenance={
 capturedAt:new Date().toISOString(),
 source:{sha,applicationPathsTreeHash:sha256(treeListing),repository:"https://github.com/engasm89/teamchat-ai",cleanClone:"git clone checked out at the SHA, no tracked modifications"} as Provenance["source"],
 api,worker,
 build:{id:buildId,createTime:build.createTime,source:`gs://${build.source.storageSource.bucket}/${build.source.storageSource.object}`,substitutions:build.substitutions},
 hosting:{site:SITE,channel:CHANNEL,url:APP_URL,releaseVersion:release.version.name,releaseTime:release.releaseTime,servedAssets,localBuildAssets,assetsMatchLocalBuild,
  message:release.message,untrackedBuildInput:{file:"apps/web/.env.production",sha256:sha256(fs.readFileSync(envFile)),
   note:"Firebase web config and public API URLs; gitignored by the repository, copied into the clean clone for the build. Its values are visible in the served JavaScript.",
   ...(Object.keys(webEnvOverrides).length?{environmentOverrides:webEnvOverrides,
    overridesNote:"VITE_* variables set for the clean-clone web build (run this recorder with the same values); they take precedence over the file and are public in the served JavaScript."}:{})}},
 vertex:Object.fromEntries(workerEnv.filter(e=>/^VERTEX_/.test(e.name)).map(e=>[e.name,e.value??""])),
 database:{instance:sql.connectionName,version:sql.databaseVersion,tier:sql.settings.tier,database:TARGET.database,applicationRole:TARGET.dbRole,
  databaseUrlSecret:{name:TARGET.databaseSecret,versions:secret.map(v=>({version:v.name.split("/").pop(),state:v.state,createTime:v.createTime}))},
  fixtureHashes,tenants,datasetHashesMatchFixtures,memoriesWithout768Embedding,
  readAs:`${TARGET.dbRole} through cloud-sql-proxy, one transaction per tenant with app.tenant_id set (RLS enforced)`},
 target:TARGET.name,
 ...(TARGET.name==="production"?{priorDeployment:"qa_evidence/provenance/prior-deployment-dc70fc8.json"}:{}),
};
fs.mkdirSync(path.dirname(TARGET.provenance),{recursive:true});
fs.writeFileSync(TARGET.provenance,JSON.stringify(provenance,null,1)+"\n");
console.log(JSON.stringify({sha,api:api.revision,apiDigest:api.digest,worker:worker.revision,workerDigest:worker.digest,hosting:release.version.name,assetsMatchLocalBuild,datasetHashesMatchFixtures,memoriesWithout768Embedding}));
