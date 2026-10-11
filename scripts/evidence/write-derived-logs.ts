/** Regenerates qa_evidence/19_scenarios_audit.log and qa_evidence/postgres_required_test.log from the
 * recorded runs. Both are derived files: every line names the run it came from, and every run is
 * listed, including failed and superseded ones.
 *   node --experimental-strip-types scripts/evidence/write-derived-logs.ts */
import fs from "node:fs";
import path from "node:path";
import {loadRuns,loadProvenance,sha256File,type RunResults} from "./lib.ts";

const provenance=loadProvenance();
if(!provenance)throw Error("qa_evidence/provenance.json missing");
const runs=loadRuns().sort((a,b)=>a.results.startedAt.localeCompare(b.results.startedAt));
const onTested=(r:RunResults)=>r.source.sha===provenance.source.sha&&
 (!r.deployment||(r.deployment.apiDigest===provenance.api.digest&&r.deployment.workerDigest===provenance.worker.digest));
const newestFingerprint=(suite:string)=>runs.filter(r=>r.results.suite===suite&&onTested(r.results)).at(-1)?.results.harness.fingerprint;
const standing=(r:RunResults)=>!onTested(r)?`superseded: source ${r.source.sha.slice(0,7)}${r.deployment&&r.source.sha===provenance.source.sha?" on other images":""}`:
 r.harness.fingerprint!==newestFingerprint(r.suite)?"superseded: older harness":"current";
const header=(title:string,suites:string[])=>[
 `# ${title}`,
 `# Derived by scripts/evidence/write-derived-logs.ts at ${new Date().toISOString()} from qa_evidence/runs/*/results.json.`,
 `# Tested source ${provenance.source.sha}; API ${provenance.api.digest}; worker ${provenance.worker.digest}.`,
 `# Suites: ${suites.join(", ")}. "current" runs are the ones the validator counts; every other run is listed with the reason it is not counted.`,
 "",
];
const tally=(r:RunResults)=>Object.entries(r.tests.reduce<Record<string,number>>((a,t)=>{a[t.status]=(a[t.status]??0)+1;return a;},{})).map(([k,v])=>`${k} ${v}`).join(", ");

const audit:string[]=header("Employer scenarios S01-S19: every acceptance, restart and browser run",["acceptance","acceptance-restart","browser"]);
for(const {dir,results:r} of runs.filter(x=>["acceptance","acceptance-restart","browser"].includes(x.results.suite))){
 audit.push(`== ${r.runId}  suite=${r.suite}  ${standing(r)}  started=${r.startedAt}  ${tally(r)}`);
 audit.push(`   results.json sha256=${sha256File(path.join(dir,"results.json"))}`);
 for(const t of r.tests){
  const passed=t.assertions.filter(a=>a.pass).length;
  audit.push(`   ${t.id.padEnd(13)} ${t.status.padEnd(12)} ${passed}/${t.assertions.length} assertions  ${t.title}`);
  for(const a of t.assertions.filter(x=>!x.pass))audit.push(`      failed: ${a.name}`);
  if(t.error)audit.push(`      error: ${t.error.slice(0,200)}`);
  const scenarioDir=path.join(dir,t.id);
  for(const f of fs.existsSync(scenarioDir)?fs.readdirSync(scenarioDir).filter(x=>x.endsWith(".json")).sort():[]){
   const turn=JSON.parse(fs.readFileSync(path.join(scenarioDir,f),"utf8"));
   if(!Array.isArray(turn.toolTrace))continue;
   const tools=turn.toolTrace.map((x:any)=>`${x.name}(${JSON.stringify(x.arguments).slice(1,-1).slice(0,90)})`).join(" -> ")||"no tool calls";
   audit.push(`      ${turn.label} turn=${turn.turnId} ${turn.terminal}: ${tools}`);
  }
 }
 audit.push("");
}
fs.writeFileSync("qa_evidence/19_scenarios_audit.log",audit.join("\n"));

const pg:string[]=header("PostgreSQL gates: REQUIRE_POSTGRES live RLS test and fresh migrations, every gates run",["gates"]);
for(const {dir,results:r} of runs.filter(x=>x.results.suite==="gates")){
 pg.push(`== ${r.runId}  ${standing(r)}  started=${r.startedAt}`);
 for(const id of ["POSTGRES-RLS","FRESH-MIGRATIONS"]){
  const t=r.tests.find(x=>x.id===id);
  if(!t){pg.push(`   ${id}: not run`);continue;}
  pg.push(`   ${id} ${t.status} ${t.assertions.filter(a=>a.pass).length}/${t.assertions.length} assertions`);
  for(const a of t.assertions)pg.push(`      ${a.pass?"ok  ":"FAIL"} ${a.name}`);
 }
 const log=path.join(dir,"POSTGRES-RLS","postgres-required.log");
 if(fs.existsSync(log)){
  pg.push(`   --- ${path.relative(".",log)} (sha256=${sha256File(log)})`);
  pg.push(...fs.readFileSync(log,"utf8").trimEnd().split("\n").map(l=>`   | ${l}`));
 }
 pg.push("");
}
fs.writeFileSync("qa_evidence/postgres_required_test.log",pg.join("\n"));
console.log(`Wrote ${audit.length} audit lines and ${pg.length} postgres lines`);
