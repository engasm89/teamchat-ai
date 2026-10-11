import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {execFileSync} from "node:child_process";
import {parse} from "csv-parse/sync";
import {sha256File,loadRuns,verifyManifest,APPLICATION_PATHS,type Verdict,type RunResults,type Provenance} from "./evidence/lib.ts";

/**
 * Derives each requirement verdict from independently stored evidence.
 * Verdicts are never authored: the requirement inventory carries no status,
 * docs/requirements/checks.json carries no status, and a requirement with
 * no passing evidence cannot be PASS.
 */

export interface InventoryRow {id:string;group:string;requirement:string;original_source:string;code_or_document:string;evidence:string;status:string;closure:string;}
type CheckSpec=
 |{kind:"test";appliesTo:string[];description:string;suite:string;testId:string;minRuns?:number;requireDeployment?:boolean}
 |{kind:"file";appliesTo:string[];description:string;path:string;sha256?:string;contains?:string[];notContains?:string[]}
 |{kind:"url";appliesTo:string[];description:string;url:string;expectStatus?:number;contains?:string[];json?:Array<{pointer:string;equals:unknown}>}
 |{kind:"json";appliesTo:string[];description:string;file:string;pointer:string;op:"equals"|"gte"|"lte"|"truthy"|"equalsSourceSha";value?:unknown}
 |{kind:"live-deployment";appliesTo:string[];description:string}
 |{kind:"git";appliesTo:string[];description:string;assert:"first-commit-after";value:string}
 |{kind:"human";appliesTo:string[];description:string;action:string;done:boolean;evidence?:string};
export interface ChecksConfig {
 schemaVersion:1;
 inventory:{path:string;sha256:string};
 provenance:string;
 requirements:Record<string,string[]>;
 checks:Record<string,CheckSpec>;
}
export interface CheckOutcome {id:string;kind:string;verdict:Verdict;notes:string[];evidence:string[];}
export interface RequirementResult {row:InventoryRow;verdict:Verdict;checks:CheckOutcome[];notes:string[];}
export interface ValidationReport {
 validatedAt:string;inventorySha256:string;integrityErrors:string[];
 sourceSha:string|null;apiRevision:string|null;workerRevision:string|null;
 counts:Record<Verdict,number>;requirements:RequirementResult[];
}
export interface ValidateOptions {
 root?:string;checksFile?:string;offline?:boolean;
 fetcher?:(url:string)=>Promise<{status:number;text:string}>;
 liveDeployment?:(p:Provenance)=>Promise<{apiRevision:string;apiDigest:string;workerRevision:string;workerDigest:string}>;
 gitRunner?:(args:string[])=>string;
}

const VERDICTS:Verdict[]=["PASS","FAIL","BLOCKED","NOT VERIFIED"];

export function parseInventory(text:string):InventoryRow[]{
 return parse(text,{columns:true,skip_empty_lines:true,trim:false,bom:true}) as InventoryRow[];
}

/** Worst-case combination: one failing or contradicted check fails the requirement. */
export function combine(verdicts:Verdict[]):Verdict{
 if(!verdicts.length)return "NOT VERIFIED";
 if(verdicts.includes("FAIL"))return "FAIL";
 if(verdicts.includes("BLOCKED"))return "BLOCKED";
 if(verdicts.includes("NOT VERIFIED"))return "NOT VERIFIED";
 return "PASS";
}

function pointer(value:unknown,ptr:string):unknown{
 if(ptr===""||ptr==="/")return value;
 return ptr.split("/").slice(1).map(p=>p.replace(/~1/g,"/").replace(/~0/g,"~")).reduce<unknown>((v,k)=>
  v!==null&&typeof v==="object"?(v as Record<string,unknown>)[k]:undefined,value);
}

async function defaultFetcher(url:string){
 const res=await fetch(url,{redirect:"follow",signal:AbortSignal.timeout(20_000),headers:{"user-agent":"teamchat-matrix-validator"}});
 return {status:res.status,text:await res.text()};
}

async function defaultLiveDeployment(p:Provenance){
 const describe=(service:string)=>JSON.parse(execFileSync("gcloud",["run","services","describe",service,"--region","us-central1","--format=json"],{encoding:"utf8"}));
 const revisionDigest=(rev:string)=>JSON.parse(execFileSync("gcloud",["run","revisions","describe",rev,"--region","us-central1","--format=json"],{encoding:"utf8"})).status.imageDigest as string;
 const api=describe(p.api.service),worker=describe(p.worker.service);
 const serving=(svc:any)=>(svc.status.traffic as Array<{revisionName:string;percent:number}>).find(t=>t.percent===100)?.revisionName??"";
 const apiRevision=serving(api),workerRevision=serving(worker);
 return {apiRevision,apiDigest:revisionDigest(apiRevision),workerRevision,workerDigest:revisionDigest(workerRevision)};
}

export async function validate(options:ValidateOptions={}):Promise<ValidationReport>{
 const root=options.root??process.cwd();
 const abs=(p:string)=>path.resolve(root,p);
 const gitRun=options.gitRunner??((args:string[])=>execFileSync("git",args,{cwd:root,encoding:"utf8"}).trim());
 const fetcher=options.fetcher??defaultFetcher;
 const integrityErrors:string[]=[];
 const config=JSON.parse(fs.readFileSync(abs(options.checksFile??"docs/requirements/checks.json"),"utf8")) as ChecksConfig;

 const inventoryText=fs.readFileSync(abs(config.inventory.path),"utf8");
 const inventorySha256=sha256File(abs(config.inventory.path));
 if(inventorySha256!==config.inventory.sha256)integrityErrors.push(`Inventory ${config.inventory.path} hash ${inventorySha256} differs from pinned ${config.inventory.sha256}`);
 const rows=parseInventory(inventoryText);
 const ids=rows.map(r=>r.id);
 if(rows.length!==61)integrityErrors.push(`Inventory has ${rows.length} rows; expected 61`);
 if(new Set(ids).size!==ids.length)integrityErrors.push("Inventory contains duplicate requirement IDs");
 for(const id of Object.keys(config.requirements))if(!ids.includes(id))integrityErrors.push(`checks.json maps unknown requirement ${id}`);
 for(const [reqId,checkIds] of Object.entries(config.requirements))for(const c of checkIds)
  if(!config.checks[c])integrityErrors.push(`${reqId} references undefined check ${c}`);

 const provenance=fs.existsSync(abs(config.provenance))?JSON.parse(fs.readFileSync(abs(config.provenance),"utf8")) as Provenance:null;
 const sourceSha=provenance?.source.sha??null;
 // Evidence collected against an older application tree is stale.
 let sourceCurrent=false;const sourceNotes:string[]=[];
 if(!provenance)sourceNotes.push(`Provenance file ${config.provenance} missing`);
 else{
  try{
   gitRun(["cat-file","-e",`${provenance.source.sha}^{commit}`]);
   const diff=gitRun(["diff","--name-only",provenance.source.sha,"HEAD","--",...APPLICATION_PATHS]);
   if(diff)sourceNotes.push(`Application source changed since tested commit ${provenance.source.sha.slice(0,12)}: ${diff.split("\n").slice(0,5).join(", ")}`);
   else sourceCurrent=true;
  }catch{sourceNotes.push(`Tested commit ${provenance.source.sha} is not present in this repository`);}
 }

 const runs=loadRuns(abs("qa_evidence/runs"));
 const manifestProblems=new Map<string,string[]>(runs.map(r=>[r.dir,verifyManifest(r.dir)]));
 const artifactHashes=new Map<string,Set<string>>();
 const registerArtifact=(file:string,hash:string,sameAs?:string)=>{
  const key=sameAs?`sameAs:${sameAs}`:hash;
  if(!artifactHashes.has(hash))artifactHashes.set(hash,new Set());
  artifactHashes.get(hash)!.add(sameAs?key:file);
 };
 let liveCache:Promise<Awaited<ReturnType<NonNullable<ValidateOptions["liveDeployment"]>>>>|undefined;
 const urlCache=new Map<string,Promise<{status:number;text:string}>>();

 async function evaluate(checkId:string,reqId:string):Promise<CheckOutcome>{
  const spec=config.checks[checkId]!;
  const out:CheckOutcome={id:checkId,kind:spec.kind,verdict:"NOT VERIFIED",notes:[],evidence:[]};
  if(!spec.appliesTo.includes(reqId)){out.verdict="FAIL";out.notes.push(`Check ${checkId} is not declared applicable to ${reqId}`);return out;}
  switch(spec.kind){
   case "file":{
    out.evidence.push(spec.path);
    if(!fs.existsSync(abs(spec.path))){out.verdict="FAIL";out.notes.push(`Missing file ${spec.path}`);return out;}
    const hash=sha256File(abs(spec.path));
    if(spec.sha256&&hash!==spec.sha256){out.verdict="FAIL";out.notes.push(`Checksum mismatch for ${spec.path}`);return out;}
    if(/\.(png|jpe?g|webp)$/i.test(spec.path))registerArtifact(spec.path,hash);
    const text=spec.contains||spec.notContains?fs.readFileSync(abs(spec.path),"utf8"):"";
    for(const pattern of spec.contains??[])if(!new RegExp(pattern,"im").test(text)){out.verdict="FAIL";out.notes.push(`${spec.path} lacks required content /${pattern}/`);}
    for(const pattern of spec.notContains??[])if(new RegExp(pattern,"im").test(text)){out.verdict="FAIL";out.notes.push(`${spec.path} contains forbidden content /${pattern}/`);}
    if(out.verdict!=="FAIL")out.verdict="PASS";
    return out;
   }
   case "url":{
    out.evidence.push(spec.url);
    if(options.offline){out.notes.push("Offline validation: URL not checked");return out;}
    try{
     if(!urlCache.has(spec.url))urlCache.set(spec.url,fetcher(spec.url));
     const res=await urlCache.get(spec.url)!;
     if(res.status!==(spec.expectStatus??200)){out.verdict="FAIL";out.notes.push(`${spec.url} returned HTTP ${res.status}`);return out;}
     for(const pattern of spec.contains??[])if(!new RegExp(pattern,"im").test(res.text)){out.verdict="FAIL";out.notes.push(`${spec.url} lacks /${pattern}/`);}
     if(spec.json){
      let body:unknown;try{body=JSON.parse(res.text);}catch{out.verdict="FAIL";out.notes.push(`${spec.url} is not JSON`);return out;}
      for(const j of spec.json){const v=pointer(body,j.pointer);if(JSON.stringify(v)!==JSON.stringify(j.equals)){out.verdict="FAIL";out.notes.push(`${spec.url}${j.pointer}=${JSON.stringify(v)}, expected ${JSON.stringify(j.equals)}`);}}
     }
     if(out.verdict!=="FAIL")out.verdict="PASS";
    }catch(error){out.verdict="FAIL";out.notes.push(`${spec.url} unreachable: ${error instanceof Error?error.message:String(error)}`);}
    return out;
   }
   case "json":{
    out.evidence.push(`${spec.file}#${spec.pointer}`);
    if(!fs.existsSync(abs(spec.file))){out.verdict="FAIL";out.notes.push(`Missing ${spec.file}`);return out;}
    const v=pointer(JSON.parse(fs.readFileSync(abs(spec.file),"utf8")),spec.pointer);
    const ok=spec.op==="equals"?JSON.stringify(v)===JSON.stringify(spec.value):
     spec.op==="gte"?typeof v==="number"&&v>=Number(spec.value):
     spec.op==="lte"?typeof v==="number"&&v<=Number(spec.value):
     spec.op==="truthy"?Boolean(v):
     typeof v==="string"&&sourceSha!==null&&v===sourceSha;
    out.verdict=ok?"PASS":"FAIL";
    if(!ok)out.notes.push(`${spec.file}${spec.pointer}=${JSON.stringify(v)?.slice(0,200)} fails ${spec.op} ${JSON.stringify(spec.op==="equalsSourceSha"?sourceSha:spec.value)}`);
    return out;
   }
   case "live-deployment":{
    out.evidence.push("gcloud run services describe (live)");
    if(!provenance){out.notes.push("No provenance to compare");return out;}
    if(options.offline){out.notes.push("Offline validation: live deployment not compared");return out;}
    try{
     liveCache??=(options.liveDeployment??defaultLiveDeployment)(provenance);
     const live=await liveCache;
     const mismatches=[["api digest",live.apiDigest,provenance.api.digest],["worker digest",live.workerDigest,provenance.worker.digest]]
      .filter(([,a,b])=>!String(a).endsWith(String(b).replace(/^.*@/,"")));
     out.verdict=mismatches.length?"FAIL":"PASS";
     for(const [name,a,b] of mismatches)out.notes.push(`Live ${name} ${a} differs from tested ${b}`);
     out.evidence.push(`serving ${live.apiRevision} / ${live.workerRevision}`);
    }catch(error){out.verdict="FAIL";out.notes.push(`Live deployment query failed: ${error instanceof Error?error.message:String(error)}`);}
    return out;
   }
   case "git":{
    try{
     const first=gitRun(["log","--reverse","--format=%cI","--max-parents=0","HEAD"]).split("\n")[0]!;
     out.evidence.push(`first commit ${first}`);
     out.verdict=Date.parse(first)>Date.parse(spec.value)?"PASS":"FAIL";
     if(out.verdict==="FAIL")out.notes.push(`First commit ${first} is not after ${spec.value}`);
    }catch(error){out.verdict="FAIL";out.notes.push(String(error));}
    return out;
   }
   case "human":{
    if(!spec.done){out.verdict="BLOCKED";out.notes.push(`Awaiting human action: ${spec.action}`);return out;}
    if(!spec.evidence||!fs.existsSync(abs(spec.evidence))){out.verdict="FAIL";out.notes.push(`Human action marked done without evidence file`);return out;}
    out.evidence.push(spec.evidence);out.verdict="PASS";return out;
   }
   case "test":{
    if(!sourceCurrent||!provenance){out.notes.push(...sourceNotes);return out;}
    // Image digests bind a run to the tested build; a forced cold start creates
    // a new revision name for the same digest, so names are informational.
    const candidates=runs.filter(r=>r.results.suite===spec.suite&&r.results.source.sha===provenance.source.sha&&
     (!spec.requireDeployment||(r.results.deployment?.apiDigest===provenance.api.digest&&r.results.deployment?.workerDigest===provenance.worker.digest)));
    if(!candidates.length){out.notes.push(`No ${spec.suite} run against tested source${spec.requireDeployment?" and deployed image digests":""}`);return out;}
    // Every run of the newest harness counts; failures cannot be dropped by cherry-picking.
    const newest=[...candidates].sort((a,b)=>a.results.startedAt.localeCompare(b.results.startedAt)).at(-1)!;
    const selected=candidates.filter(r=>r.results.harness.fingerprint===newest.results.harness.fingerprint&&!r.results.harness.dirty);
    if(newest.results.harness.dirty){out.notes.push(`Newest ${spec.suite} run used an uncommitted harness`);return out;}
    const verdicts:Verdict[]=[];
    for(const run of selected){
     out.evidence.push(path.relative(root,path.join(run.dir,"results.json")));
     const problems=manifestProblems.get(run.dir)??[];
     if(problems.length){verdicts.push("FAIL");out.notes.push(...problems.slice(0,3));continue;}
     const test=run.results.tests.find(t=>t.id===spec.testId);
     if(!test){verdicts.push("NOT VERIFIED");out.notes.push(`${run.results.runId}: test ${spec.testId} absent`);continue;}
     if(!test.requirementIds.includes(reqId)){verdicts.push("FAIL");out.notes.push(`${run.results.runId}/${test.id} does not declare ${reqId}`);continue;}
     const failed=test.assertions.filter(a=>!a.pass);
     if(test.status==="PASS"&&(failed.length||test.error)){verdicts.push("FAIL");out.notes.push(`${run.results.runId}/${test.id}: PASS contradicts failing assertions`);continue;}
     if(test.status==="PASS"&&!test.assertions.length){verdicts.push("FAIL");out.notes.push(`${run.results.runId}/${test.id}: PASS without assertions`);continue;}
     for(const a of test.artifacts){
      if(!fs.existsSync(abs(a.path))){verdicts.push("FAIL");out.notes.push(`Artifact missing: ${a.path}`);continue;}
      if(sha256File(abs(a.path))!==a.sha256){verdicts.push("FAIL");out.notes.push(`Artifact checksum mismatch: ${a.path}`);continue;}
      registerArtifact(a.path,a.sha256,a.sameAs);
      out.evidence.push(a.path);
     }
     if(test.status!=="PASS")out.notes.push(`${run.results.runId}/${test.id}: ${test.status}${test.error?` (${test.error})`:""}${test.blockedReason?` (${test.blockedReason})`:""}${failed.length?` failing: ${failed.map(f=>f.name).join("; ")}`:""}`);
     verdicts.push(test.status);
    }
    const passingRuns=verdicts.filter(v=>v==="PASS").length;
    if(selected.length<(spec.minRuns??1)){out.notes.push(`${selected.length} run(s) of ${spec.suite}; ${spec.minRuns} required`);verdicts.push("NOT VERIFIED");}
    out.verdict=combine(verdicts);
    if(out.verdict==="PASS")out.notes.push(`${passingRuns}/${selected.length} run(s) passed`);
    return out;
   }
  }
 }

 const requirements:RequirementResult[]=[];
 for(const row of rows){
  const checkIds=config.requirements[row.id]??[];
  const checks:CheckOutcome[]=[];
  for(const id of checkIds)if(config.checks[id]){const c=await evaluate(id,row.id);c.notes=[...new Set(c.notes)];c.evidence=[...new Set(c.evidence)];checks.push(c);}
  const notes=checkIds.length?[]:["No evidence checks mapped to this requirement"];
  requirements.push({row,verdict:combine(checks.map(c=>c.verdict)),checks,notes});
 }
 // Identical images may only be shared when the runner explicitly declared them the same evidence.
 for(const [hash,files] of artifactHashes){
  const distinct=[...files].filter(f=>!f.startsWith("sameAs:"));
  if(distinct.length>1){
   const message=`Identical image content (${hash.slice(0,12)}) presented as different evidence: ${distinct.join(", ")}`;
   integrityErrors.push(message);
   for(const r of requirements)if(r.checks.some(c=>c.evidence.some(e=>distinct.includes(e)))){r.verdict="FAIL";r.notes.push(message);}
  }
 }
 if(integrityErrors.length)for(const r of requirements)if(r.verdict==="PASS"&&integrityErrors.some(e=>e.startsWith("Inventory"))){r.verdict="NOT VERIFIED";r.notes.push("Inventory integrity failed");}
 const counts=Object.fromEntries(VERDICTS.map(v=>[v,requirements.filter(r=>r.verdict===v).length])) as Record<Verdict,number>;
 return {validatedAt:new Date().toISOString(),inventorySha256,integrityErrors,sourceSha,
  apiRevision:provenance?.api.revision??null,workerRevision:provenance?.worker.revision??null,counts,requirements};
}

const csvCell=(v:unknown)=>{const s=String(v??"");return /[",\r\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;};
const mdCell=(v:unknown)=>String(v??"").replace(/\|/g,"\\|").replace(/\r?\n/g," ");

export function renderCsv(report:ValidationReport):string{
 const header=["id","group","requirement","original_source","closure_criterion","verdict","checks","check_verdicts","evidence","notes","tested_source_sha","api_revision","worker_revision","validated_at"];
 const lines=[header.join(",")];
 for(const r of report.requirements){
  lines.push([r.row.id,r.row.group,r.row.requirement,r.row.original_source,r.row.closure,r.verdict,
   r.checks.map(c=>c.id).join("; "),r.checks.map(c=>`${c.id}=${c.verdict}`).join("; "),
   [...new Set(r.checks.flatMap(c=>c.evidence))].join("; "),[...r.notes,...r.checks.flatMap(c=>c.notes.map(n=>`${c.id}: ${n}`))].join(" | "),
   report.sourceSha??"",report.apiRevision??"",report.workerRevision??"",report.validatedAt].map(csvCell).join(","));
 }
 return lines.join("\r\n")+"\r\n";
}

export function renderMarkdown(report:ValidationReport):{matrix:string;summary:string}{
 const c=report.counts,total=report.requirements.length;
 const head=`Generated by \`scripts/validate-matrix.ts\` at ${report.validatedAt}. Do not edit by hand.\n\n`+
  `- Requirement inventory: \`docs/FINAL_HANDOFF_2026-10-09/REQUIREMENTS_LINE_BY_LINE.csv\` (sha256 \`${report.inventorySha256}\`)\n`+
  `- Tested application commit: \`${report.sourceSha??"none recorded"}\`\n`+
  `- Cloud Run revisions under test: API \`${report.apiRevision??"none"}\`, worker \`${report.workerRevision??"none"}\`\n`+
  `- Result: **${c.PASS} PASS, ${c.FAIL} FAIL, ${c.BLOCKED} BLOCKED, ${c["NOT VERIFIED"]} NOT VERIFIED** of ${total}\n`;
 let matrix=`# Requirements Matrix (evidence-derived)\n\n${head}\n| ID | Requirement (verbatim) | Verdict | Checks | Notes |\n| --- | --- | --- | --- | --- |\n`;
 for(const r of report.requirements){
  const notes=[...r.notes,...r.checks.flatMap(x=>x.notes.map(n=>`${x.id}: ${n}`))];
  matrix+=`| ${r.row.id} | ${mdCell(r.row.requirement)} | **${r.verdict}** | ${r.checks.map(x=>`${x.id} (${x.verdict})`).join("<br>")} | ${mdCell(notes.join("; ").slice(0,600))} |\n`;
 }
 let summary=`# Requirements Summary (evidence-derived)\n\n${head}\n## By group\n\n| Group | PASS | FAIL | BLOCKED | NOT VERIFIED |\n| --- | --- | --- | --- | --- |\n`;
 for(const group of [...new Set(report.requirements.map(r=>r.row.group))]){
  const rs=report.requirements.filter(r=>r.row.group===group);
  summary+=`| ${group} | ${VERDICTS.map(v=>rs.filter(r=>r.verdict===v).length).join(" | ")} |\n`;
 }
 const open=report.requirements.filter(r=>r.verdict!=="PASS");
 if(open.length){
  summary+=`\n## Requirements not passing\n\n`;
  for(const r of open)summary+=`- **${r.row.id} ${r.verdict}** — ${r.row.requirement}: ${mdCell([...r.notes,...r.checks.filter(x=>x.verdict!=="PASS").flatMap(x=>x.notes)].join("; ").slice(0,500))}\n`;
 }
 if(report.integrityErrors.length)summary+=`\n## Integrity errors\n\n${report.integrityErrors.map(e=>`- ${e}`).join("\n")}\n`;
 return {matrix,summary};
}

async function main(){
 const args=new Set(process.argv.slice(2));
 const report=await validate({offline:args.has("--offline")});
 fs.mkdirSync("docs",{recursive:true});
 fs.writeFileSync("docs/REQUIREMENTS_FINAL_MATRIX.csv",renderCsv(report));
 const md=renderMarkdown(report);
 fs.writeFileSync("docs/REQUIREMENTS_FINAL_MATRIX.md",md.matrix);
 fs.writeFileSync("docs/REQUIREMENTS_FINAL_SUMMARY.md",md.summary);
 fs.writeFileSync("qa_evidence/matrix-validation.json",JSON.stringify(report,null,1)+"\n");
 console.log(`Validated ${report.requirements.length} requirements: ${JSON.stringify(report.counts)}`);
 for(const e of report.integrityErrors)console.error(`INTEGRITY: ${e}`);
 for(const r of report.requirements.filter(r=>r.verdict!=="PASS"))
  console.log(`${r.verdict.padEnd(12)} ${r.row.id} ${[...new Set([...r.notes,...r.checks.filter(c=>c.verdict!=="PASS").flatMap(c=>c.notes)])].join("; ").slice(0,240)}`);
 // Default mode fails on broken or contradictory evidence; the release gate
 // additionally requires every requirement to pass.
 if(report.integrityErrors.length||report.counts.FAIL>0)process.exitCode=1;
 if(args.has("--release-gate")&&report.counts.PASS!==report.requirements.length)process.exitCode=process.exitCode||2;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
