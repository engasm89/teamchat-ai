/** Release gates run from a clean clone of the tested commit.
 * Usage: node --experimental-strip-types scripts/gates/run-gates.ts --clone <dir> [--scratch]
 * Requires: cloud-sql-proxy on DB_PROXY_PORT (default 6543), Homebrew postgresql@17 + pgvector,
 * gitleaks on PATH, apps/web/.env.production present in the clone (untracked build input). */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
import {isDeepStrictEqual} from "node:util";
import {spawn,spawnSync,execFileSync} from "node:child_process";
import WebSocket from "ws";
import {RunRecorder,deploymentRef,loadProvenance,keychainPassword,GCP,type TestRecorder} from "../evidence/lib.ts";
import {ACCOUNTS,APP_URL,firebaseSignIn,sleep} from "../acceptance/common.ts";

const HARNESS=["scripts/gates/run-gates.ts","scripts/gates/memory-repair-driver.ts","scripts/evidence/lib.ts","scripts/acceptance/common.ts"];
const arg=(name:string)=>{const i=process.argv.indexOf(name);if(i<0||!process.argv[i+1])throw Error(`${name} is required`);return process.argv[i+1]!;};
const clone=path.resolve(arg("--clone"));
const ORIGINAL_ZIP=path.resolve("reference/original_employer_assessment.zip");
const FIXTURES=["product_codes.csv","promo_coefficients.csv","segment_coefficients.csv","stores.json","team_memory_seed.json"];
const sha256=(data:Buffer|string)=>crypto.createHash("sha256").update(data).digest("hex");

const provenance=loadProvenance();
if(!provenance)throw Error("qa_evidence/provenance.json missing");
const head=execFileSync("git",["-C",clone,"rev-parse","HEAD"],{encoding:"utf8"}).trim();
if(head!==provenance.source.sha)throw Error(`Clone is at ${head}; provenance source is ${provenance.source.sha}`);
if(execFileSync("git",["-C",clone,"status","--porcelain","--untracked-files=no"],{encoding:"utf8"}).trim())throw Error("Clone has tracked modifications");

const secrets:string[]=[];
const redact=(text:string)=>secrets.reduce((s,x)=>x?s.split(x).join("[redacted]"):s,text);
function sh(t:TestRecorder,log:string,cmd:string,args:string[],opts:{cwd?:string;env?:NodeJS.ProcessEnv;timeoutMs?:number}={}){
 const started=Date.now();
 const r=spawnSync(cmd,args,{cwd:opts.cwd??clone,env:opts.env??process.env,encoding:"utf8",timeout:opts.timeoutMs??600000,maxBuffer:64*1024*1024});
 const out=redact(`$ ${cmd} ${args.join(" ")}\n(cwd ${path.relative(clone,opts.cwd??clone)||"."}, exit ${r.status}, ${Date.now()-started} ms)\n\n${r.stdout??""}${r.stderr??""}`);
 fs.writeFileSync(path.join(t.dir,log),out);t.artifact(log,`Output of ${cmd} ${args.join(" ")}`.slice(0,200));
 return {status:r.status,stdout:r.stdout??"",stderr:r.stderr??"",ms:Date.now()-started};
}
function cloudDb(){
 const url=execFileSync("gcloud",["secrets","versions","access","latest","--secret=teamchat-database-url","--project",GCP.project],{encoding:"utf8"}).trim();
 const m=/^postgres(?:ql)?:\/\/([^:/@]+):([^@]+)@[^/]*\/([A-Za-z0-9_]+)/.exec(url);if(!m)throw Error("Unexpected database URL form");
 const password=decodeURIComponent(m[2]!);secrets.push(password,encodeURIComponent(password));
 return {user:m[1]!,password,proxyUrl:`postgres://${m[1]}:${encodeURIComponent(password)}@127.0.0.1:${process.env.DB_PROXY_PORT??"6543"}/${m[3]}`};
}
const tap=(text:string)=>Object.fromEntries(["tests","pass","fail","cancelled","skipped","todo"].map(k=>[k,Number(new RegExp(`^# ${k} (\\d+)`,"m").exec(text)?.[1]??NaN)]));
const freePort=()=>new Promise<number>(resolve=>{const s=net.createServer().listen(0,()=>{const p=(s.address() as net.AddressInfo).port;s.close(()=>resolve(p));});});

const run=new RunRecorder({suite:"gates",environment:`clean clone of ${provenance.source.sha} on ${os.platform()} ${os.arch()}, node ${process.version}`,
 sourceSha:provenance.source.sha,deployment:deploymentRef(provenance),harnessFiles:HARNESS,
 ...(process.argv.includes("--scratch")?{runsDir:"qa_evidence/scratch/runs"}:{})});

// ---------- local PostgreSQL with pgvector (FRESH-MIGRATIONS, SIGTERM-DRAIN) ----------
const PG_BIN="/opt/homebrew/opt/postgresql@17/bin";
const pgData=fs.mkdtempSync(path.join(os.tmpdir(),"teamchat-gates-pg-"));
const pgSocket=fs.mkdtempSync(path.join("/tmp","tcpg-"));
let pgPort=0;const localRolePassword=crypto.randomBytes(18).toString("hex");secrets.push(localRolePassword);
const psql=(t:TestRecorder,log:string,args:string[],user="postgres")=>sh(t,log,`${PG_BIN}/psql`,["-v","ON_ERROR_STOP=1","-X","-q","-h",pgSocket,"-p",String(pgPort),"-U",user,"-d","teamchat",...args]);
const localQuery=(sql:string,user="postgres",env:NodeJS.ProcessEnv={})=>execFileSync(`${PG_BIN}/psql`,["-X","-A","-t","-v","ON_ERROR_STOP=1","-h",pgSocket,"-p",String(pgPort),"-U",user,"-d","teamchat","-c",sql],
 {encoding:"utf8",env:{...process.env,...env}}).trim();
const localDbUrl=()=>`postgres://teamchat_api:${localRolePassword}@127.0.0.1:${pgPort}/teamchat`;

try{
 await run.run("NPM-CI","npm ci succeeds from committed lockfiles in a clean clone",["A07"],async t=>{
  for(const dir of [clone,path.join(clone,"apps/web")])fs.rmSync(path.join(dir,"node_modules"),{recursive:true,force:true});
  const root=sh(t,"npm-ci-root.log","npm",["ci","--no-audit","--no-fund"]);
  const web=sh(t,"npm-ci-web.log","npm",["ci","--no-audit","--no-fund"],{cwd:path.join(clone,"apps/web")});
  const dirty=execFileSync("git",["-C",clone,"status","--porcelain","--untracked-files=no"],{encoding:"utf8"}).trim();
  t.detail("npm",execFileSync("npm",["--version"],{encoding:"utf8"}).trim()).detail("node",process.version)
   .detail("lockfiles",Object.fromEntries(["package-lock.json","apps/web/package-lock.json"].map(f=>[f,sha256(fs.readFileSync(path.join(clone,f)))])));
  t.assert("root npm ci exits 0",root.status===0,0,root.status);
  t.assert("apps/web npm ci exits 0",web.status===0,0,web.status);
  t.assert("lockfiles and tracked files unchanged after install",dirty==="", "",dirty);
 });

 await run.run("TYPECHECK","tsc --noEmit in a clean clone",["A04"],async t=>{
  const r=sh(t,"typecheck.log","npm",["run","check"]);
  t.assert("npm run check exits 0",r.status===0,0,r.status);
  t.assert("no TypeScript diagnostics",!/error TS\d+/.test(r.stdout+r.stderr),"none",(r.stdout+r.stderr).match(/error TS\d+[^\n]*/g)?.slice(0,5)??[]);
 });

 await run.run("UNIT-TESTS","npm test in a clean clone, 0 failures",["G02","D05","A01","A02","A03","A10"],async t=>{
  const r=sh(t,"npm-test.log","npm",["test"]);const c=tap(r.stdout);t.detail("tap",c);
  t.assert("npm test exits 0",r.status===0,0,r.status);
  t.assert("at least one test ran and all passed",c.tests>0&&c.pass===c.tests,`pass = tests > 0`,c);
  t.assert("no failed, cancelled, skipped or todo tests",c.fail===0&&c.cancelled===0&&c.skipped===0&&c.todo===0,0,c);
 });

 await run.run("FIXTURES","Five supplied fixture hashes verified against the employer archive, the repository and the live database",["G06","A05"],async t=>{
  const listing=execFileSync("unzip",["-Z1",ORIGINAL_ZIP],{encoding:"utf8"}).split("\n").filter(Boolean);
  const original:Record<string,string>={};
  for(const f of FIXTURES){const entry=listing.find(e=>e.endsWith(`/${f}`)||e===f);
   if(entry)original[f]=sha256(execFileSync("unzip",["-p",ORIGINAL_ZIP,entry],{maxBuffer:64*1024*1024}));}
  const repo=Object.fromEntries(FIXTURES.map(f=>[f,sha256(fs.readFileSync(path.join(clone,"teamchat-ai-assessment/teamchat-ai-seed-data",f)))]));
  const r=sh(t,"verify-fixtures.log","npm",["run","--silent","verify:fixtures"]);
  const reported=JSON.parse(r.stdout.slice(r.stdout.indexOf("{"))) as {hashes:Record<string,string>};
  const live=provenance.database.tenants as Record<string,{datasetVersions:Record<string,string>}>;
  t.detail("originalArchive",{path:path.relative(process.cwd(),ORIGINAL_ZIP),sha256:sha256(fs.readFileSync(ORIGINAL_ZIP)),
   note:"Archive kept outside Git in reference/; its own authenticity rests on how it was received"})
   .detail("original",original).detail("repository",repo).detail("appReported",reported.hashes);
  t.assert("all five fixtures found in the employer archive",Object.keys(original).length===5,5,Object.keys(original));
  t.assert("repository fixtures equal the employer archive byte for byte",FIXTURES.every(f=>repo[f]===original[f]),original,repo);
  t.assert("the application's fixture loader reports the same hashes",FIXTURES.every(f=>reported.hashes[f]===original[f]),original,reported.hashes);
  t.assert("live database dataset_versions equal the employer archive for both tenants",
   Object.values(live).length===2&&Object.values(live).every(x=>FIXTURES.every(f=>x.datasetVersions[f]===original[f])),original,live);
 });

 await run.run("SEED-SQL","Seed SQL regenerates byte-identical to the committed file and carries the fixture hashes",["A06"],async t=>{
  const r=sh(t,"seed-sql.log","npm",["run","seed:sql"]);
  const diff=spawnSync("git",["-C",clone,"diff","--stat","--","db/generated/seed.sql"],{encoding:"utf8"}).stdout.trim();
  const seed=fs.readFileSync(path.join(clone,"db/generated/seed.sql"),"utf8");
  const hashRows=FIXTURES.map(f=>[f,(seed.match(new RegExp(`'${f.replace(".","\\.")}','([0-9a-f]{64})'`,"g"))??[]).length]);
  t.detail("seedSha256",sha256(seed)).detail("datasetVersionRowsPerFixture",Object.fromEntries(hashRows));
  t.assert("npm run seed:sql exits 0",r.status===0,0,r.status);
  t.assert("regenerated seed.sql is identical to the committed file",diff==="","no diff",diff);
  t.assert("seed carries one dataset_versions row per fixture per tenant",hashRows.every(([,n])=>n===2),2,Object.fromEntries(hashRows));
 });

 await run.run("WEB-BUILD","Vite production build in a clean clone reproduces the served Hosting assets",["A09"],async t=>{
  const envFile=path.join(clone,"apps/web/.env.production");
  if(!fs.existsSync(envFile))throw Error("apps/web/.env.production missing from the clone");
  fs.rmSync(path.join(clone,"apps/web/dist"),{recursive:true,force:true});
  const r=sh(t,"web-build.log","npm",["--prefix","apps/web","run","build"]);
  const dist=path.join(clone,"apps/web/dist");const built:Record<string,string>={};
  const walk=(d:string)=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p);else built["/"+path.relative(dist,p)]=sha256(fs.readFileSync(p));}};
  if(fs.existsSync(dist))walk(dist);
  const served=provenance.hosting.servedAssets;
  t.detail("built",built).detail("served",served).detail("envProductionSha256",sha256(fs.readFileSync(envFile)));
  t.assert("build exits 0 (tsc + vite)",r.status===0,0,r.status);
  t.assert("built assets equal the assets served by Hosting",Object.keys(built).length===Object.keys(served).length&&Object.entries(built).every(([k,v])=>served[k]===v),served,built);
 });

 await run.run("FORBIDDEN-TRANSPORT","Client source and built bundle contain no Firebase listeners, managed realtime SDKs or timers that fetch",["G01"],async t=>{
  const srcDir=path.join(clone,"apps/web/src");
  const files=fs.readdirSync(srcDir).filter(f=>/\.(ts|tsx)$/.test(f)&&!/\.test\./.test(f));
  const hits=(rx:RegExp)=>files.flatMap(f=>fs.readFileSync(path.join(srcDir,f),"utf8").split("\n").flatMap((line,i)=>rx.test(line)?[`${f}:${i+1}: ${line.trim().slice(0,160)}`]:[]));
  const realtimeImports=hits(/from\s+["']firebase\/(firestore|database|messaging|functions)|onSnapshot|onValue\(|EventSource|sendBeacon|XMLHttpRequest/);
  const intervals=hits(/setInterval\s*\(/);
  const timers=hits(/setTimeout\s*\(/);
  const timersThatFetch=timers.filter(l=>/fetch\s*\(/.test(l));
  const fetches=hits(/fetch\s*\(/);
  const bundleDir=path.join(clone,"apps/web/dist/assets");
  const bundle=fs.readdirSync(bundleDir).filter(f=>f.endsWith(".js")).map(f=>fs.readFileSync(path.join(bundleDir,f),"utf8")).join("\n");
  const count=(s:string)=>bundle.split(s).length-1;
  const forbiddenBundle=Object.fromEntries(["firestore.googleapis.com","firebaseio.com","fcmregistrations.googleapis.com","new EventSource","sendBeacon","XMLHttpRequest"].map(s=>[s,count(s)]));
  t.detail("sourceFiles",files).detail("setTimeoutSites",timers).detail("fetchSites",fetches)
   .detail("bundleInformational",{setInterval:count("setInterval"),"@firebase/database registry name":count("@firebase/database"),
    note:"setInterval in the bundle is Firebase Auth's local storage/IndexedDB persistence polling (no network); S17 measures runtime traffic"});
  t.assert("no realtime SDK imports or listeners in client source",realtimeImports.length===0,[],realtimeImports);
  t.assert("no setInterval in client source",intervals.length===0,[],intervals);
  t.assert("no timer callback calls fetch",timersThatFetch.length===0,[],timersThatFetch);
  t.assert("only the one-shot room list fetch exists",fetches.length===1&&/\/api\/rooms/.test(fetches[0]!),"App.tsx /api/rooms only",fetches);
  t.assert("bundle has no realtime endpoints, EventSource, beacons or XHR",Object.values(forbiddenBundle).every(n=>n===0),0,forbiddenBundle);
 });

 await run.run("POSTGRES-RLS","REQUIRE_POSTGRES live RLS test against Cloud SQL as teamchat_api, 0 skipped",["G04","D05","A08"],async t=>{
  const db=cloudDb();
  const [north,valley]=[await firebaseSignIn("n1"),await firebaseSignIn("v1")];
  const env={...process.env,DATABASE_URL:db.proxyUrl,
   TEST_NORTHSIDE_UID:north.uid,TEST_VALLEY_UID:valley.uid,VERTEX_EMBEDDING_MODEL_ID:String(provenance.vertex.VERTEX_EMBEDDING_MODEL_ID)};
  const r=sh(t,"postgres-required.log","npm",["run","test:postgres:required"],{env});const c=tap(r.stdout);
  t.detail("tap",c).detail("database",{instance:provenance.database.instance,role:db.user,via:"cloud-sql-proxy 127.0.0.1"});
  t.assert("required PostgreSQL test exits 0",r.status===0,0,r.status);
  t.assert("the live test ran and passed (not skipped)",c.tests===1&&c.pass===1&&c.skipped===0&&c.fail===0,{tests:1,pass:1,skipped:0},c);
 });

 await run.run("FRESH-MIGRATIONS","Migrations and seed applied twice to an empty PostgreSQL with pgvector",["D02","A08"],async t=>{
  pgPort=await freePort();
  sh(t,"initdb.log",`${PG_BIN}/initdb`,["-D",pgData,"-U","postgres","--auth=trust","-E","UTF8"]);
  const start=sh(t,"pg-start.log",`${PG_BIN}/pg_ctl`,["-D",pgData,"-l",path.join(pgData,"server.log"),"-w","-o",`-p ${pgPort} -k ${pgSocket} -c listen_addresses=127.0.0.1`,"start"]);
  if(start.status!==0)throw Error("Local PostgreSQL did not start");
  execFileSync(`${PG_BIN}/createdb`,["-h",pgSocket,"-p",String(pgPort),"-U","postgres","teamchat"]);
  localQuery(`CREATE ROLE teamchat_api LOGIN PASSWORD '${localRolePassword}'`);
  const migrations=fs.readdirSync(path.join(clone,"db/migrations")).filter(f=>f.endsWith(".sql")).sort();
  const files=[...migrations.map(f=>`db/migrations/${f}`),"db/provision_runtime_role.sql","db/generated/seed.sql"];
  const COUNT_SQL="SELECT string_agg(format('%s=%s',c.relname,(xpath('/row/n/text()',query_to_xml(format('SELECT count(*) AS n FROM teamchat.%I',c.relname),false,true,'')))[1]::text),',' ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='teamchat' AND c.relkind='r'";
  const passes:Array<{ok:boolean;failed:string[];counts:string}>=[];
  for(const pass of [1,2]){
   const failed=files.filter(f=>psql(t,`pass${pass}-${path.basename(f)}.log`,["-f",path.join(clone,f)]).status!==0);
   passes.push({ok:failed.length===0,failed,counts:localQuery(COUNT_SQL)});
  }
  const pgvector=localQuery("SELECT extversion FROM pg_extension WHERE extname='vector'");
  // Each -c runs in order in one session; the last output line is the last statement's result.
  const asApp=(...statements:string[])=>execFileSync(`${PG_BIN}/psql`,["-X","-A","-t","-q","-v","ON_ERROR_STOP=1","-h","127.0.0.1","-p",String(pgPort),"-U","teamchat_api","-d","teamchat",
   ...statements.flatMap(s=>["-c",s])],{encoding:"utf8",stdio:["ignore","pipe","pipe"],env:{...process.env,PGPASSWORD:localRolePassword}}).trim().split("\n").at(-1)!;
  const tenant="SELECT set_config('app.tenant_id','northside-outfitters',false)";
  const role=asApp("SELECT CASE WHEN rolsuper OR rolbypassrls THEN 'privileged' ELSE 'restricted' END FROM pg_roles WHERE rolname=current_user");
  const noContext=asApp("SELECT count(*) FROM teamchat.stores");
  const north=asApp(tenant,"SELECT count(*) FROM teamchat.stores");
  let crossTenantInsert="accepted";
  try{asApp(tenant,"INSERT INTO teamchat.memories(tenant_id,memory_id,key,value,created_by,created_at,source_room_id) VALUES('valley-home-goods','gate-rls','gate-rls','{}'::jsonb,'gate',now(),'pricing')");}
  catch(e){const msg=String((e as {stderr?:string}).stderr??e);crossTenantInsert=/row-level security/.test(msg)?"rejected by RLS":`error: ${msg.slice(0,200)}`;}
  t.detail("files",files).detail("passes",passes).detail("pgvector",pgvector).detail("postgres",localQuery("SHOW server_version"));
  t.assert("first pass applies every migration, role grants and seed",passes[0]?.ok===true,true,passes[0]);
  t.assert("second pass re-applies cleanly (idempotent)",passes[1]?.ok===true,true,passes[1]);
  t.assert("row counts identical after both passes",!!passes[0]?.counts&&passes[0]?.counts===passes[1]?.counts,passes[0]?.counts,passes[1]?.counts);
  t.assert("pgvector installed",/^\d/.test(pgvector),"version",pgvector);
  t.assert("runtime role is neither superuser nor BYPASSRLS",role==="restricted","restricted",role);
  t.assert("runtime role sees no rows without tenant context",noContext==="0","0",noContext);
  t.assert("runtime role sees exactly its tenant's 12 stores with context",north==="12","12",north);
  t.assert("cross-tenant insert rejected by RLS",crossTenantInsert==="rejected by RLS","rejected by RLS",crossTenantInsert);
 });

 await run.run("SIGTERM-DRAIN","Real API and worker processes exit cleanly on SIGTERM with open sockets and pool",["A01"],async t=>{
  if(!pgPort)throw Error("Local PostgreSQL from FRESH-MIGRATIONS is not running");
  const appConnections=()=>Number(localQuery("SELECT count(*) FROM pg_stat_activity WHERE usename='teamchat_api'"));
  const results:Record<string,unknown>={};
  for(const kind of ["api","worker"] as const){
   const port=await freePort();
   const env:NodeJS.ProcessEnv={...process.env,DATABASE_URL:localDbUrl(),PORT:String(port),PG_POOL_MAX:"3",
    ...(kind==="api"?{FIREBASE_PROJECT_ID:GCP.project,ALLOWED_ORIGINS:APP_URL,LOCAL_TASK_WORKER:"1"}:
     {GCP_PROJECT_ID:GCP.project,GOOGLE_CLOUD_REGION:GCP.region,VERTEX_MODEL_ID:String(provenance.vertex.VERTEX_MODEL_ID),
      VERTEX_EMBEDDING_MODEL_ID:String(provenance.vertex.VERTEX_EMBEDDING_MODEL_ID),
      CLOUD_TASKS_AUDIENCE:"https://worker.invalid",CLOUD_TASKS_INVOKER_EMAIL:"invoker@example.invalid"})};
   const logFile=path.join(t.dir,`${kind}-process.log`);const out=fs.openSync(logFile,"w");
   const proc=spawn(process.execPath,["--experimental-strip-types",kind==="api"?"src/server/start.ts":"src/worker/start.ts"],{cwd:clone,env,stdio:["ignore",out,out]});
   const exited=new Promise<{code:number|null;signal:string|null;at:number}>(resolve=>proc.on("exit",(code,signal)=>resolve({code,signal,at:Date.now()})));
   let up=false;for(let i=0;i<60&&!up;i++){try{up=(await fetch(`http://127.0.0.1:${port}/health`)).ok;}catch{}if(!up)await sleep(500);}
   if(!up){proc.kill("SIGKILL");fs.closeSync(out);t.artifact(`${kind}-process.log`,`${kind} process output`);throw Error(`${kind} did not become healthy`);}
   const sockets:Array<{closedAt?:number;code?:number}>=[];
   if(kind==="api")for(let i=0;i<3;i++){const ws=new WebSocket(`ws://127.0.0.1:${port}/ws`,{origin:APP_URL});const rec:{closedAt?:number;code?:number}={};sockets.push(rec);
    ws.on("close",(code:number)=>{rec.closedAt=Date.now();rec.code=code;});ws.on("error",()=>{});await new Promise<void>(r=>ws.once("open",()=>r()));}
   const keepAlive=net.connect(port,"127.0.0.1");await new Promise<void>(r=>keepAlive.once("connect",()=>r()));
   let keepAliveClosedAt:number|undefined;keepAlive.on("close",()=>{keepAliveClosedAt=Date.now();});keepAlive.on("error",()=>{});keepAlive.resume();
   keepAlive.write(`GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\n\r\n`);
   await sleep(500);
   const before=appConnections();const signalAt=Date.now();proc.kill("SIGTERM");
   const exit=await Promise.race([exited,sleep(15000).then(()=>null)]);
   if(!exit)proc.kill("SIGKILL");
   await sleep(500);const after=appConnections();fs.closeSync(out);t.artifact(`${kind}-process.log`,`${kind} process output`);
   results[kind]={exit:exit?{code:exit.code,signal:exit.signal,afterMs:exit.at-signalAt}:"did not exit within 15 s",dbConnectionsBefore:before,dbConnectionsAfter:after,
    sockets:sockets.map(s=>({code:s.code??null,closedAfterMs:s.closedAt?s.closedAt-signalAt:null})),keepAliveClosedAfterMs:keepAliveClosedAt?keepAliveClosedAt-signalAt:null};
   t.assert(`${kind} exits by itself with code 0 within 15 s of SIGTERM`,!!exit&&exit.code===0&&exit.signal===null,"code 0",results[kind]);
   t.assert(`${kind} held database connections before SIGTERM`,before>0,">0",before);
   t.assert(`${kind} released every database connection`,after===0,0,after);
   t.assert(`${kind} closed the idle keep-alive HTTP connection`,keepAliveClosedAt!==undefined&&keepAliveClosedAt>=signalAt,"closed after SIGTERM",results[kind]);
   if(kind==="api")t.assert("api closed every open WebSocket",sockets.every(s=>s.closedAt!==undefined),"all closed",results[kind]);
  }
  t.detail("results",results);
 });

 await run.run("MEMORY-REPAIR","Worker loop on a real database: nested value rejected, one controlled repair stored intact, then no more attempts",["S10"],async t=>{
  if(!pgPort)throw Error("Local PostgreSQL from FRESH-MIGRATIONS is not running");
  localQuery("INSERT INTO teamchat.user_memberships(tenant_id,firebase_uid,display_name) VALUES('northside-outfitters','gate-user','Gate User') ON CONFLICT DO NOTHING");
  localQuery("INSERT INTO teamchat.rooms(tenant_id,room_id,title) VALUES('northside-outfitters','gate-room','Gate room') ON CONFLICT DO NOTHING");
  localQuery("INSERT INTO teamchat.room_memberships(tenant_id,room_id,firebase_uid) VALUES('northside-outfitters','gate-room','gate-user') ON CONFLICT DO NOTHING");
  const r=sh(t,"memory-repair-driver.log",process.execPath,["--experimental-strip-types",path.resolve("scripts/gates/memory-repair-driver.ts"),clone,"gate-user","gate-room",
   String(provenance.vertex.VERTEX_EMBEDDING_MODEL_ID)],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:localDbUrl(),PG_POOL_MAX:"3"}});
  if(r.status!==0)throw Error("Driver failed; see memory-repair-driver.log");
  const out=JSON.parse(r.stdout.trim().split("\n").at(-1)!);
  t.writeJson("memory-repair.json",out,"Persisted tool events, answer blocks and memory rows for both scenarios");
  const {nested:n,unrepairable:u}=out;
  const parse=(s:unknown)=>{try{return JSON.parse(String(s));}catch{return undefined;}};
  const repaired=parse(n.tools[1]?.arguments?.value_json);
  t.assert("nested: turn completed",n.first?.status==="completed"&&n.terminal.join()==="ai_complete","completed",{run:n.first,terminal:n.terminal});
  t.assert("nested: first save rejected with a field-level reason for the nested field",n.tools[0]?.result?.saved===false&&
   (n.tools[0]?.result?.validation_errors??[]).some((e:any)=>e.field==="leads"&&e.issue),"leads rejected",n.tools[0]?.result);
  t.assert("nested: exactly one controlled repair, executed by the worker and stored",n.tools.length===2&&n.tools[1]?.operationId==="r0-c1"&&n.tools[1]?.result?.saved===true,
   "2 operations, second saved",n.tools.map((x:any)=>({op:x.operationId,saved:x.result?.saved})));
  t.assert("nested: the repair keeps every field, re-encoding the nested one as JSON text",typeof repaired?.leads==="string"&&
   isDeepStrictEqual(parse(repaired.leads),out.originalLeads)&&repaired?.site==="north","nothing dropped",repaired);
  t.assert("nested: the stored memory equals the repaired value",n.stored.length===1&&isDeepStrictEqual(n.stored[0].value,repaired),repaired,n.stored);
  t.assert("nested: the user sees the rejection and then the saved value",n.answerBlocks.filter((b:string)=>b==="save_memory").length===2,2,n.answerBlocks);
  t.assert("nested: re-running the finished job writes nothing",n.again?.status==="completed"&&n.eventCountAfterSecondRun===n.eventCountAfterFirstRun,
   n.eventCountAfterFirstRun,{again:n.again,eventsAfterSecondRun:n.eventCountAfterSecondRun});
  const s=out.reshaped,sRepaired=parse(s.tools[1]?.arguments?.value_json);
  t.assert("reshaped: the model's flattened copy is not what gets validated; the requester's own value is, and is rejected",
   isDeepStrictEqual(parse(s.tools[0]?.arguments?.value_json),{leads:out.originalLeads,site:"north"})&&(s.tools[0]?.result?.validation_errors??[]).some((e:any)=>e.field==="leads"),
   "requester's nested value, leads rejected",{validated:s.tools[0]?.arguments?.value_json,result:s.tools[0]?.result});
  t.assert("reshaped: the one controlled repair of the requester's value is what is stored",s.tools.length===2&&s.tools[1]?.result?.saved===true&&
   isDeepStrictEqual(parse(sRepaired?.leads),out.originalLeads)&&s.stored.length===1&&isDeepStrictEqual(s.stored[0].value,sRepaired),"repaired requester value stored",s.stored);
  t.assert("unrepairable: repair rejected too, the model's retry refused, nothing stored",u.tools.length===3&&
   Array.isArray(u.tools[1]?.result?.validation_errors)&&/Repair limit reached/.test(String(u.tools[2]?.result?.error))&&u.stored.length===0&&u.terminal.join()==="ai_complete",
   "rejected, rejected, refused; 0 rows",{tools:u.tools.map((x:any)=>({op:x.operationId,errors:x.result?.validation_errors,error:x.result?.error,saved:x.result?.saved})),stored:u.stored.length});
 });

 await run.run("SECRET-SCAN","gitleaks over full history plus reviewer-password and JWT scan of evidence",["D02"],async t=>{
  const report=path.resolve(t.dir,"gitleaks-history.json");
  const g=sh(t,"gitleaks-history.log","gitleaks",["git","--redact","--no-banner","--report-format","json","--report-path",report,clone]);
  const findings=JSON.parse(fs.readFileSync(report,"utf8")) as Array<{RuleID:string;File:string;StartLine:number;Commit:string;Match:string}>;
  t.artifact("gitleaks-history.json","gitleaks findings over the full Git history (secrets redacted by gitleaks)");
  const commits=execFileSync("git",["-C",clone,"rev-list","--all","--count"],{encoding:"utf8"}).trim();
  // Publishable tree of the working repository: tracked plus untracked-but-not-ignored files.
  const files=execFileSync("git",["ls-files","-co","--exclude-standard"],{encoding:"utf8"}).split("\n").filter(Boolean).filter(f=>fs.existsSync(f)&&fs.statSync(f).isFile());
  const reviewerPasswords=Object.values(ACCOUNTS).map(a=>keychainPassword(a.email));
  const literal=[...reviewerPasswords,cloudDb().password].filter(Boolean);
  const JWT=/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/;
  const PRIVATE_KEY=/-----BEGIN [A-Z ]*PRIVATE KEY-----/;
  const hits:Array<{file:string;kind:string}>=[];
  for(const f of files){
   const buf=fs.readFileSync(f);const text=buf.toString("latin1");
   if(literal.some(p=>text.includes(p)))hits.push({file:f,kind:"reviewer or database password literal"});
   if(JWT.test(text))hits.push({file:f,kind:"JWT"});
   if(PRIVATE_KEY.test(text))hits.push({file:f,kind:"private key"});
  }
  const ruleCounts=findings.reduce<Record<string,number>>((a,f)=>{a[f.RuleID]=(a[f.RuleID]??0)+1;return a;},{});
  // A finding is triaged only when the value it flags is shown to be public:
  //  - the Firebase web key shipped in the served bundle (WEB-BUILD proves the clone's dist equals what Hosting serves);
  //  - in recorded evidence, a JSON "key" field whose every value on the line is a memory slot name
  //    (short words joined by space, _ or -), a shape no credential format here takes;
  //  - an image digest equal to the tested API or worker digest.
  const dist=path.join(clone,"apps/web/dist/assets");
  const bundle=fs.existsSync(dist)?fs.readdirSync(dist).filter(f=>f.endsWith(".js")).map(f=>fs.readFileSync(path.join(dist,f),"utf8")).join("\n"):"";
  const shown=new Map<string,string[]>();
  const lineOf=(f:{Commit:string;File:string;StartLine:number})=>{
   const k=`${f.Commit}:${f.File}`;
   if(!shown.has(k))shown.set(k,execFileSync("git",["-C",clone,"show",k],{encoding:"utf8",maxBuffer:1<<28}).split("\n"));
   return shown.get(k)![f.StartLine-1]??"";
  };
  const SLOT_NAME=/^[A-Za-z0-9]{1,16}([ _-][A-Za-z0-9]{1,16})+$/;
  const digests=[provenance.api.digest,provenance.worker.digest];
  const triage=findings.map(f=>{
   const line=lineOf(f);let triaged:string|null=null;
   if(f.RuleID==="gcp-api-key"){
    const key=/AIza[0-9A-Za-z_-]{35}/.exec(line)?.[0];
    if(key&&bundle.includes(key))triaged="public Firebase web API key, identical to the value served in the Hosting bundle";
   }else if(f.RuleID==="generic-api-key"&&/^key"\s*:\s*"/.test(f.Match)&&f.File.startsWith("qa_evidence/")){
    const values=[...line.matchAll(/"key"\s*:\s*"([^"]*)"/g)].map(m=>m[1]!);
    if(values.length&&values.every(v=>SLOT_NAME.test(v)))triaged="memory slot name in recorded evidence";
   }else if(f.RuleID==="generic-api-key"&&/sha256:REDACTED/.test(f.Match)){
    const found=[...line.matchAll(/sha256:[0-9a-f]{64}/g)].map(m=>m[0]);
    if(found.length&&found.every(d=>digests.includes(d)))triaged="tested image digest";
   }
   return {rule:f.RuleID,file:f.File,line:f.StartLine,commit:f.Commit.slice(0,12),triaged};
  });
  const untriaged=triage.filter(x=>!x.triaged);
  fs.writeFileSync(path.join(t.dir,"gitleaks-triage.json"),JSON.stringify(triage,null,1)+"\n");
  t.artifact("gitleaks-triage.json","Each gitleaks finding with the reason it is public, or null if it is not");
  const triageCounts=triage.reduce<Record<string,number>>((a,x)=>{const k=`${x.rule}: ${x.triaged??"UNTRIAGED"}`;a[k]=(a[k]??0)+1;return a;},{});
  t.detail("gitleaksVersion",execFileSync("gitleaks",["version"],{encoding:"utf8"}).trim()).detail("commitsScanned",Number(commits))
   .detail("gitleaksRuleCounts",ruleCounts).detail("gitleaksTriageCounts",triageCounts).detail("gitleaksUntriaged",untriaged)
   .detail("publishableFilesScanned",files.length).detail("literalSecretsChecked",literal.length).detail("evidenceHits",hits);
  t.assert("gitleaks completed",g.status===0||g.status===1,"exit 0 or 1",g.status);
  t.assert("every gitleaks finding in any commit is a verified public value",untriaged.length===0,[],untriaged);
  t.assert("no reviewer/database password, JWT or private key in publishable files",hits.length===0,[],hits);
 });
}finally{
 if(pgPort)spawnSync(`${PG_BIN}/pg_ctl`,["-D",pgData,"-m","fast","stop"]);
 fs.rmSync(pgData,{recursive:true,force:true});fs.rmSync(pgSocket,{recursive:true,force:true});
 run.finish();
}
