// Experiment: is Hosting/API reachable from this machine while NEG-S16-DROP runs and afterwards?
import {chromium} from "playwright";
import {execFile} from "node:child_process";
const until=Date.now()+Number(process.argv[2]??600)*1000;
const curl=(url)=>new Promise(r=>execFile("curl",["-s","-o","/dev/null","--max-time","8","-w","%{http_code} %{time_connect} %{time_total}",url],(e,out)=>r(e?`ERR(${e.code}) ${out}`:out)));
const b=await chromium.launch();
let tick=0;
while(Date.now()<until){
 const at=new Date().toISOString();
 const [web,api]=await Promise.all([curl("https://focus-clean-4b9f4.web.app/?m="+tick),curl("https://teamchat-api-1068908463902.us-central1.run.app/health")]);
 let chrome="-";
 if(tick%3===0){const c=await b.newContext();const p=await c.newPage();const t=Date.now();
  try{await p.goto("https://focus-clean-4b9f4.web.app/",{waitUntil:"domcontentloaded",timeout:8000});chrome=`ok ${Date.now()-t}ms`;}catch(e){chrome=`FAIL ${Date.now()-t}ms ${String(e).split("\n")[0].slice(0,80)}`;}
  await c.close();}
 console.log(at,"web",web,"| api",api,"| chromium",chrome);
 tick++;await new Promise(r=>setTimeout(r,2000));
}
await b.close();
