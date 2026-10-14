import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {execFileSync} from "node:child_process";

export type Verdict="PASS"|"FAIL"|"BLOCKED"|"NOT VERIFIED";
export const RUNS_DIR="qa_evidence/runs";

export interface Assertion {name:string;pass:boolean;expected?:unknown;actual?:unknown;}
export interface Artifact {path:string;sha256:string;description:string;sameAs?:string;}
export interface TestResult {
 id:string;title:string;requirementIds:string[];status:Verdict;
 startedAt:string;finishedAt:string;
 details:Record<string,unknown>;assertions:Assertion[];artifacts:Artifact[];
 blockedReason?:string;error?:string;
}
export interface DeploymentRef {apiRevision:string;workerRevision:string;apiDigest:string;workerDigest:string;hostingVersion?:string;}
export interface RunResults {
 schemaVersion:1;suite:string;runId:string;environment:string;
 startedAt:string;finishedAt:string;
 harness:{gitHead:string;dirty:boolean;fingerprint:string;files:string[]};
 source:{sha:string};
 deployment:DeploymentRef|null;
 tests:TestResult[];
}

export const sha256=(data:string|Buffer)=>crypto.createHash("sha256").update(data).digest("hex");
export const sha256File=(file:string)=>sha256(fs.readFileSync(file));
export const utcNow=()=>new Date().toISOString();

export function git(args:string[],cwd=process.cwd()):string{
 return execFileSync("git",args,{cwd,encoding:"utf8"}).trim();
}
export function gitHead(cwd=process.cwd()){
 return {sha:git(["rev-parse","HEAD"],cwd),dirty:git(["status","--porcelain"],cwd).length>0};
}

/** Paths whose content defines the deployed application. Evidence is only
 * current while these are unchanged between the tested source and HEAD. */
export const APPLICATION_PATHS=["src","apps/web/src","apps/web/index.html","apps/web/package.json","apps/web/package-lock.json","db","deploy","package.json","package-lock.json"];

export function harnessFingerprint(files:string[]):string{
 const h=crypto.createHash("sha256");
 for(const file of [...files].sort()){h.update(file);h.update("\0");h.update(fs.readFileSync(file));h.update("\0");}
 return h.digest("hex");
}

export function walkFiles(dir:string):string[]{
 if(!fs.existsSync(dir))return [];
 return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{
  const full=path.join(dir,e.name);
  return e.isDirectory()?walkFiles(full):[full];
 });
}

export function writeManifest(runDir:string):void{
 const files=walkFiles(runDir).filter(f=>path.basename(f)!=="MANIFEST.json").sort();
 const manifest={generatedAt:utcNow(),files:files.map(f=>({path:path.relative(runDir,f),bytes:fs.statSync(f).size,sha256:sha256File(f)}))};
 fs.writeFileSync(path.join(runDir,"MANIFEST.json"),JSON.stringify(manifest,null,1)+"\n");
}

export function verifyManifest(runDir:string):string[]{
 const manifestPath=path.join(runDir,"MANIFEST.json");
 if(!fs.existsSync(manifestPath))return [`${runDir}: MANIFEST.json missing`];
 const manifest=JSON.parse(fs.readFileSync(manifestPath,"utf8")) as {files:Array<{path:string;sha256:string}>};
 const problems:string[]=[];
 const listed=new Set(manifest.files.map(f=>f.path));
 for(const entry of manifest.files){
  const full=path.join(runDir,entry.path);
  if(!fs.existsSync(full))problems.push(`${full}: listed in manifest but missing`);
  else if(sha256File(full)!==entry.sha256)problems.push(`${full}: checksum differs from manifest`);
 }
 for(const file of walkFiles(runDir)){
  const rel=path.relative(runDir,file);
  if(rel!=="MANIFEST.json"&&!listed.has(rel))problems.push(`${file}: present but not in manifest`);
 }
 return problems;
}

export class TestRecorder {
 readonly result:TestResult;
 private readonly run:RunRecorder;
 constructor(run:RunRecorder,id:string,title:string,requirementIds:string[]){
  this.run=run;
  this.result={id,title,requirementIds,status:"NOT VERIFIED",startedAt:utcNow(),finishedAt:"",details:{},assertions:[],artifacts:[]};
 }
 get dir(){const d=path.join(this.run.dir,this.result.id);fs.mkdirSync(d,{recursive:true});return d;}
 detail(key:string,value:unknown){this.result.details[key]=value;return this;}
 assert(name:string,pass:boolean,expected?:unknown,actual?:unknown){
  this.result.assertions.push({name,pass:Boolean(pass),...(expected===undefined?{}:{expected}),...(actual===undefined?{}:{actual})});
  return Boolean(pass);
 }
 /** Register a file already written inside this test's directory. */
 artifact(file:string,description:string,sameAs?:string){
  const full=path.isAbsolute(file)?file:path.join(this.dir,file);
  if(!fs.existsSync(full))throw Error(`Artifact not written: ${full}`);
  this.result.artifacts.push({path:path.relative(process.cwd(),full),sha256:sha256File(full),description,...(sameAs?{sameAs}:{})});
 }
 writeJson(name:string,value:unknown,description:string){
  fs.writeFileSync(path.join(this.dir,name),JSON.stringify(value,null,1)+"\n");
  this.artifact(name,description);
 }
 block(reason:string){this.result.blockedReason=reason;}
 fail(error:unknown){this.result.error=error instanceof Error?`${error.name}: ${error.message}`:String(error);}
 finish(){
  const r=this.result;r.finishedAt=utcNow();
  if(r.error||r.assertions.some(a=>!a.pass))r.status="FAIL";
  else if(r.blockedReason)r.status="BLOCKED";
  else if(r.assertions.length===0)r.status="NOT VERIFIED";
  else r.status="PASS";
  return r;
 }
}

export class RunRecorder {
 readonly dir:string;
 readonly results:RunResults;
 constructor(opts:{suite:string;environment:string;sourceSha:string;deployment:DeploymentRef|null;harnessFiles:string[];runsDir?:string}){
  const started=utcNow();
  const runId=`${started.replace(/[-:]/g,"").replace(/\.\d+Z$/,"Z")}-${opts.suite}-${crypto.randomBytes(3).toString("hex")}`;
  this.dir=path.join(opts.runsDir??RUNS_DIR,runId);
  fs.mkdirSync(this.dir,{recursive:true});
  const head=gitHead();
  this.results={schemaVersion:1,suite:opts.suite,runId,environment:opts.environment,startedAt:started,finishedAt:"",
   harness:{gitHead:head.sha,dirty:head.dirty,fingerprint:harnessFingerprint(opts.harnessFiles),files:[...opts.harnessFiles].sort()},
   source:{sha:opts.sourceSha},deployment:opts.deployment,tests:[]};
 }
 test(id:string,title:string,requirementIds:string[]){return new TestRecorder(this,id,title,requirementIds);}
 /** Run one test body; exceptions become a recorded FAIL, never a silent skip. */
 async run(id:string,title:string,requirementIds:string[],body:(t:TestRecorder)=>Promise<void>):Promise<TestResult>{
  const t=this.test(id,title,requirementIds);
  try{await body(t);}catch(error){t.fail(error);}
  const result=t.finish();
  this.results.tests.push(result);
  this.save();
  console.log(`${result.status.padEnd(12)} ${id} ${title}${result.error?` — ${result.error}`:""}`);
  for(const a of result.assertions.filter(a=>!a.pass))console.log(`   ✗ ${a.name} expected=${JSON.stringify(a.expected)} actual=${JSON.stringify(a.actual)?.slice(0,300)}`);
  return result;
 }
 save(){fs.writeFileSync(path.join(this.dir,"results.json"),JSON.stringify(this.results,null,1)+"\n");}
 /** Sets the process exit code from the verdicts, so shells and CI see a failed run. */
 finish(){
  this.results.finishedAt=utcNow();this.save();writeManifest(this.dir);
  const counts=this.results.tests.reduce<Record<string,number>>((a,t)=>{a[t.status]=(a[t.status]??0)+1;return a;},{});
  console.log(`\nRun ${this.results.runId}: ${JSON.stringify(counts)}\nEvidence: ${this.dir}`);
  const code=runExitCode(this.results.tests);
  if(code)process.exitCode=Math.max(Number(process.exitCode??0),code);
  return this.results;
 }
}

/** 0 only when at least one test ran and every test passed; 1 for any FAIL; 2 when nothing failed but something was blocked, unverified or nothing ran. */
export function runExitCode(tests:ReadonlyArray<Pick<TestResult,"status">>):0|1|2{
 if(tests.some(t=>t.status==="FAIL"))return 1;
 return tests.length>0&&tests.every(t=>t.status==="PASS")?0:2;
}

export function loadRuns(runsDir=RUNS_DIR):Array<{dir:string;results:RunResults}>{
 if(!fs.existsSync(runsDir))return [];
 return fs.readdirSync(runsDir,{withFileTypes:true}).filter(e=>e.isDirectory()).flatMap(e=>{
  const file=path.join(runsDir,e.name,"results.json");
  if(!fs.existsSync(file))return [];
  return [{dir:path.join(runsDir,e.name),results:JSON.parse(fs.readFileSync(file,"utf8")) as RunResults}];
 });
}

/** Reviewer passwords live only in the macOS login Keychain. */
export function keychainPassword(email:string,service="teamchat-ai-reviewer"):string{
 try{return execFileSync("security",["find-generic-password","-s",service,"-a",email,"-w"],{encoding:"utf8"}).trim();}
 catch{throw Error(`No Keychain item for ${email} (service ${service})`);}
}

export interface Provenance {
 capturedAt:string;
 source:{sha:string;applicationPathsTreeHash:string};
 api:{service:string;revision:string;image:string;digest:string;labels:Record<string,string>;buildId?:string};
 worker:{service:string;revision:string;image:string;digest:string;labels:Record<string,string>;buildId?:string};
 hosting:{site:string;releaseVersion:string;releaseTime:string;servedAssets:Record<string,string>;localBuildAssets:Record<string,string>;assetsMatchLocalBuild:boolean;[key:string]:unknown};
 vertex:Record<string,string>;
 database:Record<string,unknown>;
 [key:string]:unknown;
}
export function loadProvenance(file="qa_evidence/provenance.json"):Provenance|null{
 return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,"utf8")) as Provenance:null;
}
export const GCP={project:"focus-clean-4b9f4",region:"us-central1"};
export function gcloudJson(args:string[]):any{
 return JSON.parse(execFileSync("gcloud",[...args,"--project",GCP.project,"--format=json"],{encoding:"utf8"}));
}
/** Serving revision (100% traffic) and its bare sha256 image digest for each service. */
export function liveDeployment(apiService:string,workerService:string):DeploymentRef{
 const serving=(service:string)=>{
  const svc=gcloudJson(["run","services","describe",service,"--region",GCP.region]);
  const revision=(svc.status.traffic as Array<{revisionName:string;percent:number}>).find(t=>t.percent===100)?.revisionName??"";
  const imageDigest=gcloudJson(["run","revisions","describe",revision,"--region",GCP.region]).status.imageDigest as string;
  return {revision,digest:imageDigest.replace(/^.*@/,"")};
 };
 const api=serving(apiService),worker=serving(workerService);
 return {apiRevision:api.revision,apiDigest:api.digest,workerRevision:worker.revision,workerDigest:worker.digest};
}
export function deploymentRef(p:Provenance):DeploymentRef{
 return {apiRevision:p.api.revision,workerRevision:p.worker.revision,apiDigest:p.api.digest,workerDigest:p.worker.digest,hostingVersion:p.hosting.releaseVersion};
}
