/** Batch B experiment: which browser-side fault mechanisms really affect the
 * live app's WebSocket? Results decide how S16/S17 and their negative
 * controls inject faults. Writes qa_evidence/experiments/websocket-faults.json. */
import fs from "node:fs";
import {chromium,type Browser,type BrowserContext,type Page} from "playwright";
import {keychainPassword,utcNow} from "../evidence/lib.ts";

const APP=process.env.APP_URL??"https://focus-clean-4b9f4.web.app";
const OUT="qa_evidence/experiments/websocket-faults.json";
const QA_ROOMS=["supply-planning","category-strategy"];
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));

const INSTRUMENT=`(()=>{const N=window.WebSocket;window.__ws=[];
 window.WebSocket=function(url,p){const s=p===undefined?new N(url):new N(url,p);const id=window.__ws.length;
  const rec={id,url:String(url),openedAt:null,closedAt:null,closeCode:null,received:0,sent:0};window.__ws.push(rec);
  s.addEventListener("open",()=>rec.openedAt=Date.now());
  s.addEventListener("close",e=>{rec.closedAt=Date.now();rec.closeCode=e.code;});
  s.addEventListener("message",()=>rec.received++);
  const send=s.send.bind(s);s.send=d=>{rec.sent++;return send(d);};return s;};
 window.WebSocket.prototype=N.prototype;Object.assign(window.WebSocket,{CONNECTING:0,OPEN:1,CLOSING:2,CLOSED:3});})();`;

async function signIn(context:BrowserContext,email:string):Promise<{page:Page;room:string}>{
 const page=await context.newPage();
 await page.goto(APP,{waitUntil:"networkidle"});
 await page.fill('input[type="email"]',email);
 await page.fill('input[type="password"]',keychainPassword(email));
 await page.click('button:has-text("Sign in")');
 await page.locator("button.channel").first().waitFor({timeout:30000});
 const channels=await page.locator("button.channel").allTextContents();
 const room=QA_ROOMS.find(r=>channels.some(c=>c.replace(/^#\s*/,"").trim()===r));
 if(!room)throw Error(`No QA room among ${channels.join(", ")}`);
 await page.click(`button.channel:has-text("${room}")`);
 await page.locator("span.status.online").waitFor({timeout:30000});
 return {page,room};
}
const wsLog=(page:Page)=>page.evaluate(()=>(window as any).__ws as Array<Record<string,any>>);
const status=(page:Page)=>page.locator("span.status").textContent();

async function observe(page:Page,ms:number){
 const samples:Array<{t:number;status:string|null}>=[];const start=Date.now();
 while(Date.now()-start<ms){samples.push({t:Date.now()-start,status:await status(page)});await sleep(1000);}
 return samples;
}

async function offlineExperiment(browser:Browser,email:string,mode:"setOffline"|"cdp"){
 const context=await browser.newContext();await context.addInitScript(INSTRUMENT);
 const {page}=await signIn(context,email);
 const before=await wsLog(page);const cdp=mode==="cdp"?await context.newCDPSession(page):null;
 const t0=Date.now();
 if(cdp){await cdp.send("Network.enable");await cdp.send("Network.emulateNetworkConditions",{offline:true,latency:0,downloadThroughput:-1,uploadThroughput:-1});}
 else await context.setOffline(true);
 const whileOffline=await observe(page,20000);
 const afterOffline=await wsLog(page);
 if(cdp)await cdp.send("Network.emulateNetworkConditions",{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
 else await context.setOffline(false);
 const recovery=await observe(page,30000);
 const final=await wsLog(page);await context.close();
 const original=afterOffline[before.length-1];
 return {mode,socketsBefore:before.length,
  originalSocketClosedWhileOffline:original?.closedAt!=null,closeDelayMs:original?.closedAt?original.closedAt-t0:null,closeCode:original?.closeCode??null,
  statusesWhileOffline:[...new Set(whileOffline.map(s=>s.status))],statusesDuringRecovery:[...new Set(recovery.map(s=>s.status))],
  socketsAfterRecovery:final.length,finalStatus:recovery.at(-1)?.status??null};
}

async function routeExperiment(browser:Browser,routedEmail:string,senderEmail:string){
 const routed=await browser.newContext();await routed.addInitScript(INSTRUMENT);
 const frames={clientToServer:0,serverToClient:0,duplicated:0,dropped:[] as number[]};
 let mode:"pass"|"duplicate"|"drop"="pass";let dropOnce=false;
 let current:{close:(o?:{code?:number;reason?:string})=>Promise<void>}|null=null;
 await routed.routeWebSocket(/\/ws$/,ws=>{
  current=ws;
  const server=ws.connectToServer();
  ws.onMessage(m=>{frames.clientToServer++;server.send(m);});
  server.onMessage(m=>{
   frames.serverToClient++;
   const frame=JSON.parse(String(m));
   if(frame.type==="event"&&frame.event?.type==="message"){
    if(mode==="drop"&&dropOnce){dropOnce=false;frames.dropped.push(frame.event.sequence);return;}
    if(mode==="duplicate"){ws.send(m);frames.duplicated++;}
   }
   ws.send(m);
  });
 });
 const {page,room}=await signIn(routed,routedEmail);
 const senderContext=await browser.newContext();const {page:sender}=await signIn(senderContext,senderEmail);
 if(!(await sender.locator(`button.channel.active:has-text("${room}")`).count()))await sender.click(`button.channel:has-text("${room}")`);
 const tag=`exp-${Date.now().toString(36)}`;
 const post=async(text:string)=>{await sender.fill('input[aria-label="Message"]',text);await sender.click('button:has-text("Send")');};
 const rendered=(text:string)=>page.locator("article.message",{hasText:text}).count();
 const waitRendered=async(text:string,ms=20000)=>{const s=Date.now();while(Date.now()-s<ms){if(await rendered(text))return true;await sleep(500);}return false;};

 const proxiedOnline=(await status(page))==="online";
 mode="duplicate";const dup=`${tag} duplicate probe`;await post(dup);const dupArrived=await waitRendered(dup);await sleep(2000);
 const dupCount=await rendered(dup);
 mode="drop";dropOnce=true;const a=`${tag} drop probe A`;const b=`${tag} drop probe B`;
 await post(a);await sleep(3000);const aBeforeGap=await rendered(a);
 mode="pass";await post(b);const bArrived=await waitRendered(b);const aRecovered=await waitRendered(a,15000);
 const socketsBeforeClose=(await wsLog(page)).length;
 await current!.close({code:4000,reason:"fault injection"});
 const closeObserved=await observe(page,15000);
 const after=await wsLog(page);
 const c=`${tag} after forced close`;await post(c);const cArrived=await waitRendered(c);
 await routed.close();await senderContext.close();
 return {room,proxiedOnline,frames,
  duplicate:{arrived:dupArrived,renderedCount:dupCount},
  drop:{renderedBeforeGapFilled:aBeforeGap,laterMessageArrived:bArrived,droppedMessageRecoveredByReplay:aRecovered},
  forcedClose:{socketsBefore:socketsBeforeClose,socketsAfter:after.length,closeCode:after[socketsBeforeClose-1]?.closeCode??null,
   statuses:[...new Set(closeObserved.map(s=>s.status))],messageAfterReconnectArrived:cArrived}};
}

const browser=await chromium.launch();
const result:Record<string,unknown>={startedAt:utcNow(),app:APP,playwright:(await import("playwright/package.json",{with:{type:"json"}})).default.version};
try{
 result.setOffline=await offlineExperiment(browser,"northside.buyer2@teamchat.internal","setOffline");
 result.cdpOffline=await offlineExperiment(browser,"northside.buyer2@teamchat.internal","cdp");
 result.routeWebSocket=await routeExperiment(browser,"northside.buyer2@teamchat.internal","northside.buyer1@teamchat.internal");
}catch(e){result.error=e instanceof Error?e.stack:String(e);}
finally{await browser.close();}
result.finishedAt=utcNow();
fs.mkdirSync("qa_evidence/experiments",{recursive:true});
fs.writeFileSync(OUT,JSON.stringify(result,null,1)+"\n");
console.log(JSON.stringify(result,null,1));
