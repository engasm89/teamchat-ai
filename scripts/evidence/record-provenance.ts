/** Writes qa_evidence/provenance.json from live systems only: Cloud Build results,
 * registry image configs, Cloud Run serving revisions and the Hosting release.
 * Usage: node --experimental-strip-types scripts/evidence/record-provenance.ts --build <id> --clean-clone <dir> */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {execFileSync} from "node:child_process";
import {APPLICATION_PATHS,GCP,gcloudJson,liveDeployment,type Provenance} from "./lib.ts";

const arg=(name:string)=>{const i=process.argv.indexOf(name);if(i<0||!process.argv[i+1])throw Error(`${name} is required`);return process.argv[i+1]!;};
const buildId=arg("--build"),cleanClone=path.resolve(arg("--clean-clone"));
const SITE="focus-clean-4b9f4",APP_URL="https://focus-clean-4b9f4.web.app";
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

const build=gcloudJson(["builds","describe",buildId]);
if(build.status!=="SUCCESS")throw Error(`Build ${buildId} is ${build.status}`);
const sha=build.substitutions?._GIT_SHA as string;
if(!/^[0-9a-f]{40}$/.test(sha??""))throw Error("Build has no _GIT_SHA substitution");
const cloneHead=execFileSync("git",["-C",cleanClone,"rev-parse","HEAD"],{encoding:"utf8"}).trim();
if(cloneHead!==sha)throw Error(`Clean clone is at ${cloneHead}, build used ${sha}`);
if(execFileSync("git",["-C",cleanClone,"status","--porcelain","--untracked-files=no"],{encoding:"utf8"}).trim())throw Error("Clean clone has tracked modifications");
const treeListing=execFileSync("git",["ls-tree","-r",sha,"--",...APPLICATION_PATHS],{encoding:"utf8"});

const live=liveDeployment("teamchat-api","teamchat-worker");
const image=async(service:"api"|"worker")=>{
 const built=(build.results.images as Array<{name:string;digest:string}>).find(i=>i.name.endsWith(`/${service}:${sha}`));
 if(!built)throw Error(`Build ${buildId} produced no ${service}:${sha} image`);
 const servingDigest=service==="api"?live.apiDigest:live.workerDigest;
 if(built.digest!==servingDigest)throw Error(`${service} serves ${servingDigest}, build produced ${built.digest}`);
 const config=await imageConfig(built.name,built.digest);
 if(config.labels["org.opencontainers.image.revision"]!==sha)throw Error(`${service} image revision label is not ${sha}`);
 return {service:`teamchat-${service}`,revision:service==="api"?live.apiRevision:live.workerRevision,
  image:`${built.name.split(":")[0]}@${built.digest}`,digest:built.digest,labels:config.labels,cmd:config.cmd,buildId};
};
const api=await image("api"),worker=await image("worker");

const release=((await (await google(`https://firebasehosting.googleapis.com/v1beta1/sites/${SITE}/releases?pageSize=1`)).json()) as any).releases[0];
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

const workerEnv=gcloudJson(["run","services","describe","teamchat-worker","--region",GCP.region]).spec.template.spec.containers[0].env as Array<{name:string;value?:string}>;
const sql=gcloudJson(["sql","instances","describe","teamchat-pg-instance"]);
const secret=gcloudJson(["secrets","versions","list","teamchat-database-url"]) as Array<{name:string;state:string;createTime:string}>;

const provenance:Provenance={
 capturedAt:new Date().toISOString(),
 source:{sha,applicationPathsTreeHash:sha256(treeListing),repository:"https://github.com/engasm89/teamchat-ai",cleanClone:"git clone from GitHub, checked out at the SHA, no tracked modifications"} as Provenance["source"],
 api,worker,
 build:{id:buildId,createTime:build.createTime,source:`gs://${build.source.storageSource.bucket}/${build.source.storageSource.object}`,substitutions:build.substitutions},
 hosting:{site:SITE,releaseVersion:release.version.name,releaseTime:release.releaseTime,servedAssets,localBuildAssets,assetsMatchLocalBuild,
  message:release.message,untrackedBuildInput:{file:"apps/web/.env.production",sha256:sha256(fs.readFileSync(envFile)),
   note:"Firebase web config and public API URLs; gitignored by the repository, copied into the clean clone for the build. Its values are visible in the served JavaScript."}},
 vertex:Object.fromEntries(workerEnv.filter(e=>/^VERTEX_/.test(e.name)).map(e=>[e.name,e.value??""])),
 database:{instance:sql.connectionName,version:sql.databaseVersion,tier:sql.settings.tier,applicationRole:"teamchat_api",
  databaseUrlSecret:{name:"teamchat-database-url",versions:secret.map(v=>({version:v.name.split("/").pop(),state:v.state,createTime:v.createTime}))}},
 priorDeployment:"qa_evidence/provenance/prior-deployment-dc70fc8.json",
};
fs.writeFileSync("qa_evidence/provenance.json",JSON.stringify(provenance,null,1)+"\n");
console.log(JSON.stringify({sha,api:api.revision,apiDigest:api.digest,worker:worker.revision,workerDigest:worker.digest,hosting:release.version.name,assetsMatchLocalBuild}));
