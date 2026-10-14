import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import {spawn,spawnSync} from "node:child_process";
import {runExitCode} from "../scripts/evidence/lib.ts";
import {freePort,listenerPids,waitForOwnHealth,sampleProcess} from "../scripts/acceptance/local-instance.ts";

const LIB=path.resolve("scripts/evidence/lib.ts");

/** Run a tiny suite through the real RunRecorder in a child process and return its exit status. */
function runSuite(bodies:string[]):number|null{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"runner-exit-"));
 const script=`import {RunRecorder} from ${JSON.stringify(LIB)};
const run=new RunRecorder({suite:"exit",environment:"test",sourceSha:"x",deployment:null,harnessFiles:[],runsDir:${JSON.stringify(dir)}});
try{${bodies.map((b,i)=>`await run.run("T${i}","t${i}",[],async t=>{${b}});`).join("")}}finally{run.finish();}`;
 const file=path.join(dir,"suite.ts");fs.writeFileSync(file,script);
 const r=spawnSync(process.execPath,["--experimental-strip-types",file],{encoding:"utf8"});
 fs.rmSync(dir,{recursive:true,force:true});
 return r.status;
}

test("a runner exits 1 when any scenario fails, so a shell chain or CI cannot mistake it for a pass",()=>{
 assert.equal(runSuite([`t.assert("ok",true);`,`t.assert("broken",false);`]),1);
 assert.equal(runSuite([`throw Error("boom");`]),1);
});

test("a runner exits 0 only when every scenario passes",()=>{
 assert.equal(runSuite([`t.assert("ok",true);`,`t.assert("also ok",true);`]),0);
});

test("blocked, unverified or empty runs exit 2, never 0",()=>{
 assert.equal(runSuite([`t.assert("ok",true);`,`t.block("no credentials");`]),2);
 assert.equal(runSuite([`t.assert("ok",true);`,``]),2);
 assert.equal(runExitCode([]),2);
 assert.equal(runExitCode([{status:"PASS"},{status:"BLOCKED"},{status:"FAIL"}]),1);
});

const nodeChild=(code:string)=>spawn(process.execPath,["-e",code],{stdio:"ignore"});
const exitedOf=(p:ReturnType<typeof spawn>)=>new Promise(r=>p.exitCode!==null||p.signalCode!==null?r(null):p.once("exit",r));
const healthServer=(port:number)=>new Promise<http.Server>(r=>{const s=http.createServer((_q,res)=>res.end("ok"));s.listen(port,"127.0.0.1",()=>r(s));});

test("A12 health check rejects a port answered by some other process while its own instance is dead",async()=>{
 const port=await freePort();const stranger=await healthServer(port);
 const child=nodeChild("process.exit(3)");await exitedOf(child);
 try{await assert.rejects(waitForOwnHealth(child,port,{attempts:5,intervalMs:50}),/exited with 3/);}
 finally{stranger.close();}
});

test("A12 health check rejects a port answered by some other process while its own instance is alive",async()=>{
 const port=await freePort();const stranger=await healthServer(port);
 const child=nodeChild("setTimeout(()=>{},30000)");
 try{await assert.rejects(waitForOwnHealth(child,port,{attempts:5,intervalMs:50}),/not the spawned instance/);}
 finally{child.kill("SIGKILL");stranger.close();}
});

test("A12 health check accepts its own instance and samples it; a dead process gives a clear error",async()=>{
 const port=await freePort();
 const child=nodeChild(`require("http").createServer((q,r)=>r.end("ok")).listen(${port})`);
 try{
  await waitForOwnHealth(child,port,{attempts:40,intervalMs:100});
  assert.deepEqual(listenerPids(port),[child.pid]);
  const sample=sampleProcess(child.pid!);
  assert.ok(sample.rssKb>0);assert.ok(sample.tcp>=1);
 }finally{child.kill("SIGKILL");}
 await exitedOf(child);
 assert.throws(()=>sampleProcess(child.pid!),/is not running/);
});
