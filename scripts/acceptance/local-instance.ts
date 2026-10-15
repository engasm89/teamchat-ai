/** A locally spawned API instance that a test can trust to be its own. */
import net from "node:net";
import {execFileSync,type ChildProcess} from "node:child_process";

const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));

/** A TCP port the OS reports free right now. */
export function freePort():Promise<number>{
 return new Promise((resolve,reject)=>{
  const server=net.createServer();
  server.once("error",reject);
  server.listen(0,()=>{const {port}=server.address() as net.AddressInfo;server.close(()=>resolve(port));});
 });
}

/** PIDs listening on a TCP port; empty when nobody is. */
export function listenerPids(port:number):number[]{
 try{return [...new Set(execFileSync("lsof",["-t","-nP",`-iTCP:${port}`,"-sTCP:LISTEN"],{encoding:"utf8"}).split("\n").filter(Boolean).map(Number))];}
 catch(error){if((error as {status?:number}).status===1)return [];throw error;}
}

const exited=(proc:ChildProcess)=>proc.exitCode!==null||proc.signalCode!==null;

/** Healthy means the child is still running, /health answers, and the child itself holds the listening socket. */
export async function waitForOwnHealth(proc:ChildProcess,port:number,{attempts=40,intervalMs=500}={}):Promise<void>{
 for(let i=0;i<attempts;i++){
  if(exited(proc))throw Error(`Local API instance (pid ${proc.pid}) exited with ${proc.exitCode??proc.signalCode} before becoming healthy`);
  const ok=await fetch(`http://127.0.0.1:${port}/health`).then(r=>r.ok,()=>false);
  if(ok){
   const owners=listenerPids(port);
   if(exited(proc))throw Error(`Local API instance (pid ${proc.pid}) exited with ${proc.exitCode??proc.signalCode} before becoming healthy`);
   if(!owners.includes(proc.pid!))throw Error(`Port ${port} is answered by pid ${owners.join(",")||"unknown"}, not the spawned instance (pid ${proc.pid})`);
   return;
  }
  await sleep(intervalMs);
 }
 throw Error(`Local API instance (pid ${proc.pid}) did not become healthy on port ${port}`);
}

/** Resident memory and open TCP sockets of a running process. */
export function sampleProcess(pid:number):{rssKb:number;tcp:number}{
 const alive=(()=>{try{process.kill(pid,0);return true;}catch{return false;}})();
 if(!alive)throw Error(`Process ${pid} is not running, so its resources cannot be sampled`);
 const rssKb=Number(execFileSync("ps",["-o","rss=","-p",String(pid)],{encoding:"utf8"}).trim());
 if(!Number.isFinite(rssKb)||rssKb<=0)throw Error(`ps returned no resident memory for process ${pid}`);
 let tcp=0;
 try{tcp=execFileSync("lsof",["-a","-p",String(pid),"-iTCP","-nP"],{encoding:"utf8"}).split("\n").filter(l=>/TCP/.test(l)).length;}
 catch(error){if((error as {status?:number}).status!==1)throw error;}
 return {rssKb,tcp};
}
