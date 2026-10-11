import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {parse} from "csv-parse/sync";
import {validate,parseInventory,renderCsv,combine,fingerprintOf,type ChecksConfig} from "../scripts/validate-matrix.ts";
import {sha256File,writeManifest,harnessFingerprint,type RunResults,type TestResult} from "../scripts/evidence/lib.ts";

const INVENTORY="docs/FINAL_HANDOFF_2026-10-09/REQUIREMENTS_LINE_BY_LINE.csv";
const TESTED="a".repeat(40);
const PROVENANCE={capturedAt:"2026-10-11T00:00:00Z",source:{sha:TESTED,applicationPathsTreeHash:"x"},
 api:{service:"teamchat-api",revision:"api-1",image:"api",digest:"sha256:aaa",labels:{}},
 worker:{service:"teamchat-worker",revision:"worker-1",image:"worker",digest:"sha256:bbb",labels:{}},
 hosting:{site:"s",releaseVersion:"v",releaseTime:"t",servedAssets:{},localBuildAssets:{},assetsMatchLocalBuild:true},vertex:{},database:{}};
const noGit=(args:string[])=>args[0]==="log"?"2026-10-09T10:00:00+03:00":"";
// The test harness is one file, "harness.ts", committed at "h" with content "v1".
const gitShow=(rev:string,file:string)=>rev==="h"&&file==="harness.ts"?Buffer.from("v1"):null;
const HARNESS_V1=fingerprintOf(["harness.ts"],()=>Buffer.from("v1"));

function fixture(config:Partial<ChecksConfig>,setup?:(root:string)=>void){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"matrix-"));
 fs.mkdirSync(path.join(root,path.dirname(INVENTORY)),{recursive:true});
 fs.copyFileSync(INVENTORY,path.join(root,INVENTORY));
 fs.mkdirSync(path.join(root,"qa_evidence/runs"),{recursive:true});
 fs.writeFileSync(path.join(root,"qa_evidence/provenance.json"),JSON.stringify(PROVENANCE));
 const full:ChecksConfig={schemaVersion:1,inventory:{path:INVENTORY,sha256:sha256File(INVENTORY)},provenance:"qa_evidence/provenance.json",requirements:{},checks:{},...config};
 fs.mkdirSync(path.join(root,"docs/requirements"),{recursive:true});
 fs.writeFileSync(path.join(root,"docs/requirements/checks.json"),JSON.stringify(full));
 setup?.(root);
 return root;
}
function writeRun(root:string,name:string,tests:TestResult[],overrides:Partial<RunResults>={}){
 const dir=path.join(root,"qa_evidence/runs",name);fs.mkdirSync(dir,{recursive:true});
 const run:RunResults={schemaVersion:1,suite:"acceptance",runId:name,environment:"deployed",startedAt:`2026-10-11T00:00:0${name.slice(-1)}Z`,finishedAt:"",
  harness:{gitHead:"h",dirty:false,fingerprint:HARNESS_V1,files:["harness.ts"]},source:{sha:TESTED},
  deployment:{apiRevision:"api-1",workerRevision:"worker-1",apiDigest:"sha256:aaa",workerDigest:"sha256:bbb"},tests,...overrides};
 fs.writeFileSync(path.join(dir,"results.json"),JSON.stringify(run));
 return dir;
}
const passing=(id:string,req:string,extra:Partial<TestResult>={}):TestResult=>({id,title:id,requirementIds:[req],status:"PASS",startedAt:"",finishedAt:"",details:{},
 assertions:[{name:"observed",pass:true}],artifacts:[],...extra});
const testCheck={kind:"test" as const,appliesTo:["S01"],description:"S01",suite:"acceptance",testId:"S01",requireDeployment:true};
const verdictOf=(report:Awaited<ReturnType<typeof validate>>,id:string)=>report.requirements.find(r=>r.row.id===id)!;

test("inventory parser handles quoted commas and keeps the 61 authoritative rows verbatim",()=>{
 const rows=parseInventory(fs.readFileSync(INVENTORY,"utf8"));
 assert.equal(rows.length,61);
 assert.equal(rows.find(r=>r.id==="E05")?.requirement,"Final email to Gonzalo, cc Elisa with submission");
 assert.equal(rows.find(r=>r.id==="G01")?.requirement,"No Firebase database listeners, managed realtime transport or browser polling");
});

test("validator runs and reports NOT VERIFIED when no evidence is mapped (never requires PASS to run)",async()=>{
 const report=await validate({root:fixture({}),gitRunner:noGit,gitShow,offline:true});
 assert.equal(report.requirements.length,61);
 assert.equal(report.counts["NOT VERIFIED"],61);
 assert.equal(report.counts.PASS,0);
});

test("combine never produces PASS from empty, failing, blocked or unverified evidence",()=>{
 assert.equal(combine([]),"NOT VERIFIED");
 assert.equal(combine(["PASS","FAIL"]),"FAIL");
 assert.equal(combine(["PASS","BLOCKED"]),"BLOCKED");
 assert.equal(combine(["PASS","NOT VERIFIED"]),"NOT VERIFIED");
 assert.equal(combine(["PASS","PASS"]),"PASS");
});

test("file checks fail for a missing file, a checksum mismatch and absent required content",async()=>{
 const root=fixture({requirements:{E01:["missing"],E02:["hash"],E03:["content"],E04:["good"]},checks:{
  missing:{kind:"file",appliesTo:["E01"],description:"",path:"docs/none.md"},
  hash:{kind:"file",appliesTo:["E02"],description:"",path:"docs/a.md",sha256:"0".repeat(64)},
  content:{kind:"file",appliesTo:["E03"],description:"",path:"docs/a.md",contains:["@paluchi"]},
  good:{kind:"file",appliesTo:["E04"],description:"",path:"docs/a.md",contains:["deadline"]}}},
  r=>fs.writeFileSync(path.join(r,"docs/a.md"),"deadline Friday"));
 const report=await validate({root,gitRunner:noGit,gitShow,offline:true});
 assert.equal(verdictOf(report,"E01").verdict,"FAIL");
 assert.equal(verdictOf(report,"E02").verdict,"FAIL");
 assert.equal(verdictOf(report,"E03").verdict,"FAIL");
 assert.equal(verdictOf(report,"E04").verdict,"PASS");
});

test("evidence cited for a requirement it does not apply to fails",async()=>{
 const root=fixture({requirements:{E01:["c"]},checks:{c:{kind:"file",appliesTo:["E02"],description:"",path:"docs/a.md"}}},
  r=>fs.writeFileSync(path.join(r,"docs/a.md"),"x"));
 assert.equal(verdictOf(await validate({root,gitRunner:noGit,gitShow,offline:true}),"E01").verdict,"FAIL");
});

test("a test result passes only against the tested commit and deployed revisions",async()=>{
 const good=fixture({requirements:{S01:["t"]},checks:{t:testCheck}},r=>{writeManifest(writeRun(r,"run-1",[passing("S01","S01")]));});
 assert.equal(verdictOf(await validate({root:good,gitRunner:noGit,gitShow,offline:true}),"S01").verdict,"PASS");
 const wrongSha=fixture({requirements:{S01:["t"]},checks:{t:testCheck}},r=>{writeManifest(writeRun(r,"run-1",[passing("S01","S01")],{source:{sha:"b".repeat(40)}}));});
 assert.equal(verdictOf(await validate({root:wrongSha,gitRunner:noGit,gitShow,offline:true}),"S01").verdict,"NOT VERIFIED");
 const wrongImage=fixture({requirements:{S01:["t"]},checks:{t:testCheck}},r=>{writeManifest(writeRun(r,"run-1",[passing("S01","S01")],
  {deployment:{apiRevision:"api-1",workerRevision:"worker-1",apiDigest:"sha256:old",workerDigest:"sha256:bbb"}}));});
 assert.equal(verdictOf(await validate({root:wrongImage,gitRunner:noGit,gitShow,offline:true}),"S01").verdict,"NOT VERIFIED");
});

test("stale evidence: application source changed after the tested commit",async()=>{
 const root=fixture({requirements:{S01:["t"]},checks:{t:testCheck}},r=>{writeManifest(writeRun(r,"run-1",[passing("S01","S01")]));});
 const report=await validate({root,offline:true,gitShow,gitRunner:args=>args[0]==="diff"?"src/server/http-socket.ts":""});
 assert.equal(verdictOf(report,"S01").verdict,"NOT VERIFIED");
});

test("contradictory, assertion-free and undeclared test results fail",async()=>{
 const contradictory=fixture({requirements:{S01:["t"]},checks:{t:testCheck}},r=>{writeManifest(writeRun(r,"run-1",[passing("S01","S01",{assertions:[{name:"x",pass:false}]})]));});
 assert.equal(verdictOf(await validate({root:contradictory,gitRunner:noGit,gitShow,offline:true}),"S01").verdict,"FAIL");
 const empty=fixture({requirements:{S01:["t"]},checks:{t:testCheck}},r=>{writeManifest(writeRun(r,"run-1",[passing("S01","S01",{assertions:[]})]));});
 assert.equal(verdictOf(await validate({root:empty,gitRunner:noGit,gitShow,offline:true}),"S01").verdict,"FAIL");
 const undeclared=fixture({requirements:{S01:["t"]},checks:{t:testCheck}},r=>{writeManifest(writeRun(r,"run-1",[passing("S01","S02")]));});
 assert.equal(verdictOf(await validate({root:undeclared,gitRunner:noGit,gitShow,offline:true}),"S01").verdict,"FAIL");
});

test("every run of the current harness counts: one failing repetition fails the requirement",async()=>{
 const root=fixture({requirements:{S01:["t"]},checks:{t:{...testCheck,minRuns:2}}},r=>{
  writeManifest(writeRun(r,"run-1",[passing("S01","S01")]));
  writeManifest(writeRun(r,"run-2",[{...passing("S01","S01"),status:"FAIL",assertions:[{name:"x",pass:false}]}]));
 });
 assert.equal(verdictOf(await validate({root,gitRunner:noGit,gitShow,offline:true}),"S01").verdict,"FAIL");
 const tooFew=fixture({requirements:{S01:["t"]},checks:{t:{...testCheck,minRuns:2}}},r=>{writeManifest(writeRun(r,"run-1",[passing("S01","S01")]));});
 assert.equal(verdictOf(await validate({root:tooFew,gitRunner:noGit,gitShow,offline:true}),"S01").verdict,"NOT VERIFIED");
});

test("a run counts only if its harness is reproduced by the files at its recorded commit",async()=>{
 const make=(harness:Partial<RunResults["harness"]>)=>fixture({requirements:{S01:["t"]},checks:{t:testCheck}},r=>{
  writeManifest(writeRun(r,"run-1",[passing("S01","S01")],{harness:{gitHead:"h",dirty:false,fingerprint:HARNESS_V1,files:["harness.ts"],...harness}}));});
 const untrackedEvidenceElsewhere=await validate({root:make({dirty:true}),gitRunner:noGit,gitShow,offline:true});
 assert.equal(verdictOf(untrackedEvidenceElsewhere,"S01").verdict,"PASS");
 const editedAfterCommit=await validate({root:make({fingerprint:fingerprintOf(["harness.ts"],()=>Buffer.from("v2"))}),gitRunner:noGit,gitShow,offline:true});
 assert.equal(verdictOf(editedAfterCommit,"S01").verdict,"NOT VERIFIED");
 assert.match(verdictOf(editedAfterCommit,"S01").checks[0]!.notes.join(),/not the one committed at h/);
 const neverCommitted=await validate({root:make({gitHead:"other"}),gitRunner:noGit,gitShow,offline:true});
 assert.equal(verdictOf(neverCommitted,"S01").verdict,"NOT VERIFIED");
 const noFiles=await validate({root:make({files:[],fingerprint:fingerprintOf([],()=>Buffer.alloc(0))}),gitRunner:noGit,gitShow,offline:true});
 assert.equal(verdictOf(noFiles,"S01").verdict,"NOT VERIFIED");
});

test("the validator fingerprints harness files exactly as the run recorder does",()=>{
 const files=["scripts/evidence/lib.ts","scripts/acceptance/common.ts"];
 assert.equal(fingerprintOf(files,f=>fs.readFileSync(f)),harnessFingerprint(files));
});

test("tampered artifacts and duplicated screenshots under different names fail",async()=>{
 const tampered=fixture({requirements:{S01:["t"]},checks:{t:testCheck}},r=>{
  const dir=writeRun(r,"run-1",[]);fs.writeFileSync(path.join(dir,"shot.png"),"image-a");
  const rel=path.join("qa_evidence/runs/run-1/shot.png");
  writeRun(r,"run-1",[passing("S01","S01",{artifacts:[{path:rel,sha256:sha256File(path.join(dir,"shot.png")),description:"s"}]})]);
  writeManifest(dir);fs.writeFileSync(path.join(dir,"shot.png"),"image-b");
 });
 assert.equal(verdictOf(await validate({root:tampered,gitRunner:noGit,gitShow,offline:true}),"S01").verdict,"FAIL");
 const duplicate=fixture({requirements:{S01:["t"],S02:["u"]},checks:{t:testCheck,u:{...testCheck,appliesTo:["S02"],testId:"S02"}}},r=>{
  const dir=writeRun(r,"run-1",[]);
  fs.writeFileSync(path.join(dir,"a.png"),"same");fs.writeFileSync(path.join(dir,"b.png"),"same");
  const art=(f:string)=>({path:`qa_evidence/runs/run-1/${f}`,sha256:sha256File(path.join(dir,f)),description:f});
  writeRun(r,"run-1",[passing("S01","S01",{artifacts:[art("a.png")]}),passing("S02","S02",{artifacts:[art("b.png")]})]);
  writeManifest(dir);
 });
 const report=await validate({root:duplicate,gitRunner:noGit,gitShow,offline:true});
 assert.equal(verdictOf(report,"S01").verdict,"FAIL");
 assert.ok(report.integrityErrors.some(e=>e.includes("Identical image content")));
});

test("URL evidence must be reachable; offline validation leaves it NOT VERIFIED",async()=>{
 const root=fixture({requirements:{D01:["u"],D02:["v"]},checks:{
  u:{kind:"url",appliesTo:["D01"],description:"",url:"https://example.invalid/app",contains:["TeamChat"]},
  v:{kind:"url",appliesTo:["D02"],description:"",url:"https://example.invalid/repo",json:[{pointer:"/private",equals:false}]}}});
 const fetcher=async(url:string)=>url.endsWith("app")?{status:404,text:""}:{status:200,text:JSON.stringify({private:false})};
 const online=await validate({root,gitRunner:noGit,gitShow,fetcher});
 assert.equal(verdictOf(online,"D01").verdict,"FAIL");
 assert.equal(verdictOf(online,"D02").verdict,"PASS");
 assert.equal(verdictOf(await validate({root,gitRunner:noGit,gitShow,offline:true}),"D02").verdict,"NOT VERIFIED");
});

test("pending human action is BLOCKED, and done without evidence fails",async()=>{
 const root=fixture({requirements:{E05:["h"],D07:["d"]},checks:{
  h:{kind:"human",appliesTo:["E05"],description:"",action:"Ashraf sends",done:false},
  d:{kind:"human",appliesTo:["D07"],description:"",action:"Ashraf sends",done:true}}});
 const report=await validate({root,gitRunner:noGit,gitShow,offline:true});
 assert.equal(verdictOf(report,"E05").verdict,"BLOCKED");
 assert.equal(verdictOf(report,"D07").verdict,"FAIL");
});

test("a modified requirement inventory is an integrity error",async()=>{
 const root=fixture({},r=>fs.appendFileSync(path.join(r,INVENTORY),"X01,Extra,Injected,none,-,-,-,-\n"));
 const report=await validate({root,gitRunner:noGit,gitShow,offline:true});
 assert.ok(report.integrityErrors.some(e=>e.includes("differs from pinned")));
 assert.ok(report.integrityErrors.some(e=>e.includes("62 rows")));
});

test("live deployment drift from the tested revision fails",async()=>{
 const root=fixture({requirements:{G05:["l"]},checks:{l:{kind:"live-deployment",appliesTo:["G05"],description:""}}});
 const live=async()=>({apiRevision:"api-2",apiDigest:"x@sha256:new",workerRevision:"worker-1",workerDigest:"x@sha256:bbb"});
 assert.equal(verdictOf(await validate({root,gitRunner:noGit,gitShow,liveDeployment:live}),"G05").verdict,"FAIL");
 const same=async()=>({apiRevision:"api-1",apiDigest:"x@sha256:aaa",workerRevision:"worker-1",workerDigest:"x@sha256:bbb"});
 assert.equal(verdictOf(await validate({root,gitRunner:noGit,gitShow,liveDeployment:same}),"G05").verdict,"PASS");
});

test("generated CSV round-trips through a standards-compliant parser",async()=>{
 const report=await validate({root:fixture({}),gitRunner:noGit,gitShow,offline:true});
 const rows=parse(renderCsv(report),{columns:true}) as Array<Record<string,string>>;
 assert.equal(rows.length,61);
 assert.equal(rows.find(r=>r.id==="E05")?.requirement,"Final email to Gonzalo, cc Elisa with submission");
 assert.ok(rows.every(r=>r.verdict==="NOT VERIFIED"));
});
