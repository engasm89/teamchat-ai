/** Browser acceptance against the deployed Hosting app and Cloud Run API:
 * S01 (two browsers), S15, S16 (TCP cut and browser-offline), S17, plus
 * negative controls that run the same assertion functions against injected
 * faults. Usage: node --experimental-strip-types scripts/acceptance/browser/run-browser.ts
 *   [--only S16,NEG-S16-DUP] [--scratch]   (--scratch writes under qa_evidence/scratch/runs, outside the evidence set)
 * Requires cloud-sql-proxy on DB_PROXY_PORT (default 6543). */
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {parse} from "csv-parse/sync";
import {chromium,type BrowserContext,type Page,type CDPSession} from "playwright";
import {RunRecorder,type Assertion,type TestRecorder} from "../../evidence/lib.ts";
import {ACCOUNTS,API_URL,APP_URL,QA_ROOM,TARGET,runsDir,accountPassword,bindDeployment,openDb,authoritativeEvents,lastSequence,expectedProjection,compareProjection,
 sleep,tag,type AccountKey,type ProjectionItem} from "../common.ts";
import {CutProxy} from "./cut-proxy.ts";
import type {PersistedEvent} from "../../../src/persistence/postgres.ts";

const HARNESS=["scripts/acceptance/browser/run-browser.ts","scripts/acceptance/browser/cut-proxy.ts","scripts/acceptance/common.ts","scripts/acceptance/target.ts","scripts/evidence/lib.ts"];
const TERMINAL=new Set(["ai_complete","ai_failed"]);
const PROGRESS=new Set(["ai_tool_start","ai_tool","ai_answer_block","ai_answer_segment"]);

// ---------- instrumentation (attached before navigation) ----------
interface FrameRec {t:number;socket:number;dir:"in"|"out";frame:any;source:"page"|"route"}
interface SocketRec {id:number;url:string;createdAt:number;closedAt:number|null;error?:string}
class PageLog {
 sockets:SocketRec[]=[];frames:FrameRec[]=[];requests:Array<{t:number;url:string;method:string;type:string}>=[];
 static redact(raw:string|Buffer):any{
  try{const f=JSON.parse(String(raw));if(f&&typeof f==="object"&&"token" in f)f.token="[redacted]";return f;}
  catch{return {unparsed:String(raw).slice(0,120)};}
 }
 attach(context:BrowserContext,page:Page){
  context.on("request",r=>this.requests.push({t:Date.now(),url:r.url().split("?")[0]!,method:r.method(),type:r.resourceType()}));
  page.on("websocket",ws=>{
   const rec:SocketRec={id:this.sockets.length,url:ws.url(),createdAt:Date.now(),closedAt:null};this.sockets.push(rec);
   ws.on("framereceived",f=>this.frames.push({t:Date.now(),socket:rec.id,dir:"in",frame:PageLog.redact(f.payload),source:"page"}));
   ws.on("framesent",f=>this.frames.push({t:Date.now(),socket:rec.id,dir:"out",frame:PageLog.redact(f.payload),source:"page"}));
   ws.on("socketerror",e=>{rec.error=String(e);});
   ws.on("close",()=>{rec.closedAt=Date.now();});
  });
 }
 events(since=0){return this.frames.filter(f=>f.dir==="in"&&f.t>=since&&f.frame?.type==="event").map(f=>({t:f.t,event:f.frame.event}));}
 write(t:TestRecorder,prefix:string){
  fs.writeFileSync(path.join(t.dir,`${prefix}-ws-frames.jsonl`),this.frames.map(f=>JSON.stringify(f)).join("\n")+"\n");
  t.artifact(`${prefix}-ws-frames.jsonl`,`${prefix}: every WebSocket frame seen by Playwright (auth token redacted)`);
  fs.writeFileSync(path.join(t.dir,`${prefix}-requests.jsonl`),this.requests.map(r=>JSON.stringify(r)).join("\n")+"\n");
  t.artifact(`${prefix}-requests.jsonl`,`${prefix}: every HTTP request (query strings removed)`);
  fs.writeFileSync(path.join(t.dir,`${prefix}-sockets.json`),JSON.stringify(this.sockets,null,1)+"\n");
  t.artifact(`${prefix}-sockets.json`,`${prefix}: WebSocket lifecycle`);
 }
}

interface Session {account:AccountKey;tenant:string;room:string;uid:string;context:BrowserContext;page:Page;log:PageLog}
type RouteFault={dropEvent?:(event:any)=>boolean};

const browser=await chromium.launch();
const sessions:Session[]=[];
/** From this test network, TCP to Firebase Hosting intermittently blackholes for up to ~3 min while the API stays
 * reachable (qa_evidence/experiments/hosting-reachability.md). Page loads are retried; every attempt is published. */
const NAVIGATION_BACKOFF_MS=[15000,45000,90000];
const navigations:Array<{account:AccountKey;at:string;attempts:Array<{ms:number;ok:boolean;error?:string}>}>=[];
async function openSession(account:AccountKey,opts:{proxy?:string;init?:string;fault?:RouteFault}={}):Promise<Session>{
 const {email,tenant}=ACCOUNTS[account];const room=QA_ROOM[tenant];
 const context=await browser.newContext({viewport:{width:1280,height:860},...(opts.proxy?{proxy:{server:opts.proxy}}:{})});
 const page=await context.newPage();const log=new PageLog();log.attach(context,page);
 if(opts.init)await context.addInitScript(opts.init);
 if(opts.fault){
  await context.routeWebSocket(/\/ws$/,ws=>{
   const server=ws.connectToServer();
   ws.onMessage(m=>{log.frames.push({t:Date.now(),socket:-1,dir:"out",frame:PageLog.redact(m),source:"route"});server.send(m);});
   server.onMessage(m=>{
    const frame=PageLog.redact(m);
    if(frame?.type==="event"&&opts.fault?.dropEvent?.(frame.event))return;
    log.frames.push({t:Date.now(),socket:-1,dir:"in",frame,source:"route"});ws.send(m);
   });
  });
 }
 const attempts:Array<{ms:number;ok:boolean;error?:string}>=[];
 for(;;){
  const started=Date.now();
  try{await page.goto(APP_URL,{waitUntil:"networkidle"});attempts.push({ms:Date.now()-started,ok:true});break;}
  catch(error){attempts.push({ms:Date.now()-started,ok:false,error:String(error).split("\n")[0]!});
   if(attempts.length>=NAVIGATION_BACKOFF_MS.length+1){navigations.push({account,at:new Date().toISOString(),attempts});throw error;}
   await sleep(NAVIGATION_BACKOFF_MS[attempts.length-1]!);}
 }
 navigations.push({account,at:new Date().toISOString(),attempts});
 await page.fill('input[type="email"]',email);
 await page.fill('input[type="password"]',accountPassword(email));
 await page.click('button:has-text("Sign in")');
 await selectRoom(page,room);
 const uid=await page.evaluate(()=>Object.keys(sessionStorage).find(k=>k.startsWith("teamchat-pending-v1:"))?.slice("teamchat-pending-v1:".length)??"");
 if(!uid)throw Error(`No session cursor key for ${email}`);
 const s={account,tenant,room,uid,context,page,log};sessions.push(s);return s;
}
async function selectRoom(page:Page,room:string){
 await page.locator(`button.channel:has-text("${room}")`).waitFor({timeout:45000});
 await page.click(`button.channel:has-text("${room}")`);
 await page.locator("span.status.online").waitFor({timeout:45000});
}
async function closeAll(){for(const s of sessions.splice(0))await s.context.close().catch(()=>{});}
async function until<T>(fn:()=>Promise<T|undefined|null|false>,ms:number,every=500):Promise<T|undefined>{
 const end=Date.now()+ms;
 for(;;){const v=await fn();if(v)return v;if(Date.now()>end)return undefined;await sleep(every);}
}
const projection=(page:Page)=>page.$$eval("article.message",els=>els.map(e=>({
 id:e.getAttribute("data-event-id")??"",seq:Number(e.getAttribute("data-seq")),turn:e.getAttribute("data-turn-id"),type:e.getAttribute("data-event-type")??""})));
const after=(items:ProjectionItem[],cursor:number)=>items.filter(i=>i.seq>cursor);
async function post(s:Session,text:string){await s.page.fill('input[aria-label="Message"]',text);await s.page.click('button:has-text("Send")');}
async function storedCursor(s:Session):Promise<number|null>{
 return s.page.evaluate(([key,room])=>{const raw=sessionStorage.getItem(key!);if(!raw)return null;
  const c=new Map<string,number>(JSON.parse(raw).cursor);return c.get(room!)??null;},[`teamchat-pending-v1:${s.uid}`,s.room]);
}
async function turnIdFor(s:Session,body:string,ms=60000):Promise<string>{
 const id=await until(async()=>{
  const sent=s.log.frames.find(f=>f.dir==="out"&&f.frame?.type==="send_message"&&f.frame.body===body);
  const ack=sent&&s.log.frames.find(f=>f.dir==="in"&&f.frame?.type==="message_ack"&&f.frame.clientMessageId===sent.frame.clientMessageId);
  return ack?.frame.aiTurnId as string|undefined;
 },ms);
 if(!id)throw Error("No message_ack with an AI turn ID");
 return id;
}
const terminalRendered=(s:Session,turnId:string)=>s.page.locator(`article.message[data-turn-id="${turnId}"][data-event-type="ai_complete"], article.message[data-turn-id="${turnId}"][data-event-type="ai_failed"]`).count();
async function shot(t:TestRecorder,s:Session,name:string,description:string){
 await s.page.screenshot({path:path.join(t.dir,name),fullPage:false});t.artifact(name,description);
}
function record(t:TestRecorder,assertions:Assertion[]){for(const a of assertions)t.assert(a.name,a.pass,a.expected,a.actual);}
/** Negative control: the same checker must report at least one failure, including the expected kind. */
function recordControl(t:TestRecorder,method:string,assertions:Assertion[],mustFail:string[]){
 const failed=assertions.filter(a=>!a.pass).map(a=>a.name);
 t.detail("faultInjection",method).detail("checkerAssertions",assertions);
 t.assert("checker reports the injected fault",failed.length>0,"at least one failing assertion",failed);
 for(const name of mustFail)t.assert(`checker fails "${name}"`,failed.includes(name),"fail","see checkerAssertions");
}
const a=(name:string,pass:boolean,expected?:unknown,actual?:unknown):Assertion=>({name,pass,expected,actual});
const dbTime=(e:PersistedEvent)=>Date.parse(String(e.created_at).replace(" ","T").replace(/([+-]\d\d)$/,"$1:00"));

// ---------- pure checkers shared by tests and negative controls ----------
function s15Checks(i:{turnId:string;reloadAt:number;db:PersistedEvent[];dom:ProjectionItem[];terminalBeforeReload:boolean}):Assertion[]{
 const turn=i.db.filter(e=>e.turn_id===i.turnId);
 const terminals=turn.filter(e=>TERMINAL.has(e.type));
 const cmp=compareProjection(i.dom,expectedProjection(i.db));
 const domTurn=i.dom.filter(d=>d.turn===i.turnId);
 return [
  a("reload happened before the turn finished (client view)",!i.terminalBeforeReload,false,i.terminalBeforeReload),
  a("reload happened before the turn finished (database time)",terminals.length===1&&dbTime(terminals[0]!)>i.reloadAt,`terminal after ${new Date(i.reloadAt).toISOString()}`,terminals.map(e=>e.created_at)),
  a("turn completed exactly once",terminals.length===1&&terminals[0]!.type==="ai_complete","one ai_complete",terminals.map(e=>e.type)),
  a("turn fetched at least one tool result",turn.some(e=>e.type==="ai_tool"),">=1 ai_tool",turn.filter(e=>e.type==="ai_tool").length),
  a("rendered projection equals the database projection item by item",cmp.exact,"exact",cmp),
  a("no rendered item appears twice",cmp.duplicates.length===0,[],cmp.duplicates),
  a("every tool record of the turn is rendered",turn.filter(e=>e.type==="ai_tool").every(e=>domTurn.some(d=>d.id===e.event_id)),"all",domTurn.filter(d=>d.type==="ai_tool").length),
 ];
}
function s16Checks(i:{cursorBefore:number;db:PersistedEvent[];domA:ProjectionItem[];domB:ProjectionItem[];tagCounts:number[];
 subscribeAfter:number|null;persistedCursor:number|null}):Assertion[]{
 const expected=expectedProjection(i.db);const cmp=compareProjection(i.domA,expected);
 const lastSeq=i.db.length?Number(i.db.at(-1)!.sequence):i.cursorBefore;
 return [
  a("every missed message rendered exactly once",i.tagCounts.every(c=>c===1),i.tagCounts.map(()=>1),i.tagCounts),
  a("rendered projection equals the database projection item by item",cmp.exact,"exact",cmp),
  a("no rendered item appears twice",cmp.duplicates.length===0,[],cmp.duplicates),
  a("nothing missing",cmp.missing.length===0,[],cmp.missing),
  a("same IDs in the same order as the other browser",JSON.stringify(i.domA.map(d=>d.id))===JSON.stringify(i.domB.map(d=>d.id)),i.domB.map(d=>d.id),i.domA.map(d=>d.id)),
  a("resubscribe resumed from the cursor held before the outage",i.subscribeAfter===i.cursorBefore,i.cursorBefore,i.subscribeAfter),
  a("persisted cursor ends at the last authoritative sequence",i.persistedCursor===lastSeq,lastSeq,i.persistedCursor),
 ];
}
const IDLE_ALLOWED_REQUESTS=[/^https:\/\/securetoken\.googleapis\.com\/v1\/token$/];
function s17Checks(i:{samples:number[];requests:Array<{url:string;method:string}>;framesIn:Record<string,number>;framesOut:Record<string,number>;
 seconds:number;metrics0:Record<string,number>;metrics1:Record<string,number>;postIdleDelivered:boolean}):Assertion[]{
 const disallowed=i.requests.filter(r=>!IDLE_ALLOWED_REQUESTS.some(rx=>rx.test(r.url)));
 const liveness=(i.framesIn.presence??0)+(i.framesIn.typing??0);
 const other=Object.entries(i.framesIn).filter(([k])=>!["presence","typing"].includes(k));
 const cpu=(i.metrics1.TaskDuration!-i.metrics0.TaskDuration!)/i.seconds;
 const heap=i.metrics1.JSHeapUsedSize!-i.metrics0.JSHeapUsedSize!;
 return [
  a("exactly one app WebSocket open at every sample",i.samples.length>0&&i.samples.every(n=>n===1),"all 1",[Math.min(...i.samples),Math.max(...i.samples)]),
  a("no HTTP requests while idle (allowlist: token refresh only)",disallowed.length===0,[],disallowed.slice(0,20)),
  a("client sends no frames while idle",Object.values(i.framesOut).reduce((x,y)=>x+y,0)===0,{},i.framesOut),
  a("only low-frequency liveness frames (≤1 per 5 s)",liveness<=Math.ceil(i.seconds/5)&&other.length===0,`≤${Math.ceil(i.seconds/5)} presence/typing, no others`,i.framesIn),
  a("main-thread busy time under 5%",cpu<0.05,"<0.05",Number(cpu.toFixed(4))),
  a("JS heap growth after GC under 2 MB",heap<2_000_000,"<2000000",heap),
  a("DOM node growth under 100",i.metrics1.Nodes!-i.metrics0.Nodes!<100,"<100",i.metrics1.Nodes!-i.metrics0.Nodes!),
  a("event-listener growth under 50",i.metrics1.JSEventListeners!-i.metrics0.JSEventListeners!<50,"<50",i.metrics1.JSEventListeners!-i.metrics0.JSEventListeners!),
  a("a message sent after idling is delivered",i.postIdleDelivered,true,i.postIdleDelivered),
 ];
}

// ---------- scenario bodies ----------
async function metrics(cdp:CDPSession){
 await cdp.send("HeapProfiler.collectGarbage");
 const {metrics:list}=await cdp.send("Performance.getMetrics");
 return Object.fromEntries(list.map(m=>[m.name,m.value]));
}
async function idleWindow(s:Session,peer:Session|null,seconds:number){
 const cdp=await s.context.newCDPSession(s.page);await cdp.send("Performance.enable");
 await sleep(5000);
 const metrics0=await metrics(cdp);const start=Date.now();const samples:number[]=[];
 while(Date.now()-start<seconds*1000){samples.push(s.log.sockets.filter(x=>x.closedAt===null).length);await sleep(1000);}
 const end=Date.now();const metrics1=await metrics(cdp);
 const inWindow=<T extends {t:number}>(xs:T[])=>xs.filter(x=>x.t>=start&&x.t<end);
 const count=(dir:"in"|"out")=>inWindow(s.log.frames.filter(f=>f.dir===dir)).reduce<Record<string,number>>((m,f)=>{const k=String(f.frame?.type);m[k]=(m[k]??0)+1;return m;},{});
 let postIdleDelivered=false;
 if(peer){const text=`${tag("s17")} after idle`;await post(peer,text);
  postIdleDelivered=Boolean(await until(async()=>(await s.page.locator("article.message",{hasText:text}).count())===1,20000));}
 return {start,end,seconds,samples,requests:inWindow(s.log.requests),framesIn:count("in"),framesOut:count("out"),metrics0,metrics1,postIdleDelivered};
}

const ac=parse(fs.readFileSync("teamchat-ai-assessment/teamchat-ai-seed-data/product_codes.csv"),{columns:true}) as Array<Record<string,string>>;
const portableAc=new Map(ac.filter(r=>/portable air condition/i.test(r.description!)).map(r=>[r.catalog_code!,r.margin_class||"not mapped"]));

const {sourceSha,deployment}=bindDeployment();
const pool=await openDb();
const args=process.argv.slice(2);
const ONLY=args.includes("--only")?new Set(args[args.indexOf("--only")+1]!.split(",")):null;
const run=new RunRecorder({suite:"browser",environment:`${TARGET.name}: ${APP_URL} + ${API_URL}`,sourceSha,deployment,harnessFiles:HARNESS,
 runsDir:runsDir(args.includes("--scratch"))});
const test=(id:string,title:string,requirementIds:string[],body:(t:TestRecorder)=>Promise<void>)=>ONLY&&!ONLY.has(id)?Promise.resolve():run.run(id,title,requirementIds,body);
const monitoringWindows:Record<string,{start:number;end:number}>={};

try{
 await test("S17","Idle for 60 s with instrumentation installed before navigation",["G01","S17"],async t=>{
  try{
   const s=await openSession("n1"),peer=await openSession("n2");
   const w=await idleWindow(s,peer,60);monitoringWindows.S17={start:w.start,end:w.end};
   t.detail("window",{start:new Date(w.start).toISOString(),end:new Date(w.end).toISOString()}).detail("metricsStart",w.metrics0).detail("metricsEnd",w.metrics1)
    .detail("framesIn",w.framesIn).detail("framesOut",w.framesOut).detail("socketSamples",w.samples);
   record(t,s17Checks(w));
   s.log.write(t,"idle-user");await shot(t,s,"idle-user.png","Idle user's window at the end of the 60 s idle period");
  }finally{await closeAll();}
 });

 await test("NEG-S17","S17 checker fails when polling and a second socket are injected",["G01","S17"],async t=>{
  try{
   const init=`setInterval(()=>{fetch(${JSON.stringify(API_URL+"/health")}).catch(()=>{});window.__extra=new WebSocket(${JSON.stringify(API_URL.replace("https","wss")+"/ws")});},5000);`;
   const s=await openSession("n1",{init}),peer=await openSession("n2");
   const w=await idleWindow(s,peer,20);
   recordControl(t,"init script in the test context only: fetch every 5 s plus a second WebSocket",s17Checks(w),
    ["no HTTP requests while idle (allowlist: token refresh only)","exactly one app WebSocket open at every sample"]);
   s.log.write(t,"injected-user");
  }finally{await closeAll();}
 });

 await test("S01-BROWSER","Two signed-in Northside users watch the same AI turn arrive live, including the fetch",["G05","S01","D01"],async t=>{
  try{
   const s=await openSession("n1"),peer=await openSession("n2");
   const cursor=await lastSequence(pool,s.tenant,s.uid,s.room);
   const prompt=`@AI what's the right catalog code for portable air conditioning units, and does it carry a margin class? [${tag("s01")}]`;
   await post(s,prompt);const turnId=await turnIdFor(s,prompt);
   for(const x of [s,peer])await until(async()=>await terminalRendered(x,turnId),180000);
   await sleep(1500);
   const db=await authoritativeEvents(pool,s.tenant,s.uid,s.room,cursor);
   const expected=expectedProjection(db);
   const domA=after(await projection(s.page),cursor),domB=after(await projection(peer.page),cursor);
   const peerTimeline=peer.log.events().filter(e=>e.event?.turnId===turnId).map(e=>({t:e.t,type:e.event.type,seq:e.event.sequence}));
   const firstTool=peerTimeline.find(e=>e.type==="ai_tool_start"||e.type==="ai_tool"),complete=peerTimeline.find(e=>e.type==="ai_complete");
   const tools=db.filter(e=>e.turn_id===turnId&&e.type==="ai_tool");
   const codes=tools.flatMap(e=>JSON.stringify(e.payload).match(/APP-100\.\d\d/g)??[]);
   const peerText=await peer.page.locator(`article.message[data-turn-id="${turnId}"]`).allInnerTexts();
   const text=peerText.join("\n");
   const renderedClasses=[...text.matchAll(/(APP-100\.\d\d) — [^\n]*— margin class ([^\s[]+(?: mapped)?)/g),
    ...text.matchAll(/(APP-100\.\d\d) — [^\n]*\nMargin class: (\S+(?: mapped)?)/g),
    ...text.matchAll(/(APP-100\.\d\d) (?:is “[^”\n]*”[^\n]*? It is in|has) margin class ([^\s.(]+)/g),
    ...[...text.matchAll(/(APP-100\.\d\d) (?:is “[^”\n]*”[^\n]*? It|) ?has no margin class mapped/g)].map(m=>[m[0],m[1],"not mapped"])]
    .map(m=>[m[1]!,m[2]!] as const);
   t.detail("turnId",turnId).detail("peerTimeline",peerTimeline).detail("toolCalls",tools.map(e=>({name:e.payload.name,arguments:e.payload.arguments})));
   t.writeJson("db-events.json",db,`Authoritative events after the starting cursor (read as ${TARGET.dbRole})`);
   t.assert("signed in through Firebase Hosting UI and authenticated the socket",s.log.frames.some(f=>f.frame?.type==="auth_ok")&&peer.log.frames.some(f=>f.frame?.type==="auth_ok"),true,true);
   t.assert("asker's view equals the database projection",compareProjection(domA,expected).exact,"exact",compareProjection(domA,expected));
   t.assert("peer's view equals the database projection",compareProjection(domB,expected).exact,"exact",compareProjection(domB,expected));
   t.assert("peer saw the fetch before the answer completed",!!firstTool&&!!complete&&firstTool.t<complete.t,"tool frame earlier than ai_complete",{firstTool,complete});
   t.assert("turn completed",db.some(e=>e.turn_id===turnId&&e.type==="ai_complete"),true,db.filter(e=>e.turn_id===turnId).map(e=>e.type));
   t.assert("a catalog tool returned portable air-conditioner codes from the fixture",codes.length>0&&codes.every(c=>portableAc.has(c)),"fixture codes",[...new Set(codes)]);
   t.assert("rendered margin classes match the fixture",renderedClasses.length>0&&renderedClasses.every(([code,cls])=>portableAc.get(code)===cls),
    "fixture margin class per code",renderedClasses);
   s.log.write(t,"asker");peer.log.write(t,"peer");
   await shot(t,s,"asker.png","Asker's browser after the turn completed");await shot(t,peer,"peer.png","Second user's browser after the same turn completed");
  }finally{await closeAll();}
 });

 await test("UX-BROWSER","Names instead of user IDs, auto-follow with Jump to latest, and a new chat that a teammate sees live",["GONZALO"],async t=>{
  try{
   const s=await openSession("n1"),peer=await openSession("n2");
   const peerName=(await peer.page.locator(".sidebarfooter small").innerText()).trim();
   const gap=(p:Page)=>p.locator("section.messages").evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight);
   const first=`UX check one ${tag("ux")}`;await post(peer,first);
   const seen=await until(async()=>(await s.page.locator("article.message",{hasText:first}).count())>0,30000);
   await sleep(800);
   const author=seen?(await s.page.locator("article.message",{hasText:first}).locator("strong").first().innerText()).trim():"";
   t.assert("a teammate's message shows their display name",!!peerName&&author===peerName,peerName,author);
   t.assert("no Firebase UID is shown in the transcript",!(await s.page.locator("section.messages").innerText()).includes(peer.uid),"absent","");
   t.assert("the view follows a new message when the reader is at the bottom",(await gap(s.page))<80,"< 80 px from the bottom",await gap(s.page));
   await s.page.locator("section.messages").evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event("scroll"));});await sleep(500);
   const second=`UX check two ${tag("ux")}`;await post(peer,second);
   await until(async()=>(await s.page.locator("article.message",{hasText:second}).count())>0,30000);await sleep(800);
   const jump=s.page.locator("button.jump");
   t.assert("a reader scrolled up is not pulled down",(await s.page.locator("section.messages").evaluate(el=>el.scrollTop))<200,"stays near the top",
    await s.page.locator("section.messages").evaluate(el=>el.scrollTop));
   t.assert("'Jump to latest' appears for unseen messages",await jump.isVisible(),true,await jump.isVisible());
   if(await jump.isVisible())await jump.click();
   await until(async()=>(await gap(s.page))<80,4000,200);
   t.assert("'Jump to latest' returns to the newest message (smooth scroll, within 4 s)",(await gap(s.page))<80,"< 80 px from the bottom",await gap(s.page));
   t.assert("'Jump to latest' disappears once the reader is at the bottom",!(await jump.isVisible()),false,await jump.isVisible());
   await shot(t,s,"names-and-scroll.png","Reader's view after Jump to latest");
   if(TARGET.name==="production"){t.detail("newChat","not run: chats created in production would appear in every tenant member's list");return;}
   const title=`UX chat ${tag("c")}`;
   await s.page.click("button.newchat-open");await s.page.fill("form.newchat input[maxlength]",title);
   await s.page.click('form.newchat button:has-text("Create")');
   const listed=await until(async()=>(await peer.page.locator("button.channel",{hasText:title}).count())>0,20000,250);
   t.assert("the new chat appears in a teammate's list without a reload",!!listed,true,!!listed);
   const pageOverflow=await peer.page.evaluate(()=>document.documentElement.scrollHeight-window.innerHeight);
   t.assert("a long chat list scrolls inside the sidebar; the page itself never scrolls",pageOverflow<=1,"<= 1 px",pageOverflow);
   await s.page.locator("button.channel",{hasText:title}).click();await sleep(1000);
   await post(s,"hi! what can you help me with?");
   if(listed)await peer.page.locator("button.channel",{hasText:title}).click();
   const answered=await until(async()=>(await peer.page.locator('article.message[data-event-type="ai_answer_segment"]').count())>0,90000);
   t.assert("in the AI chat the assistant answers without @AI, and the teammate sees it",!!answered,true,!!answered);
   await shot(t,peer,"new-chat-peer.png","Teammate's view of the new AI chat");
  }finally{await closeAll();}
 });

 const s15=async(t:TestRecorder,suppress:boolean)=>{
  let target="",reloaded=false;
  const s=await openSession("n1",suppress?{fault:{dropEvent:e=>reloaded&&e?.turnId===target}}:{});
  const cursor=await lastSequence(pool,s.tenant,s.uid,s.room);
  const prompt=`@AI which categories is ST-4007 missing this season, and what would closing them be worth? [${tag("s15")}]`;
  await post(s,prompt);const turnId=await turnIdFor(s,prompt);target=turnId;
  const progress=await until(async()=>s.log.events().find(e=>e.event?.turnId===turnId&&PROGRESS.has(e.event.type)),120000,100);
  if(!progress)throw Error("Turn never showed progress");
  const terminalBeforeReload=s.log.events().some(e=>e.event?.turnId===turnId&&TERMINAL.has(e.event.type));
  await shot(t,s,"before-reload.png","Transcript with the answer in progress, just before reload");
  const reloadAt=Date.now();reloaded=true;
  await s.page.reload({waitUntil:"networkidle"});await selectRoom(s.page,s.room);
  const finished=await until(async()=>{const db=await authoritativeEvents(pool,s.tenant,s.uid,s.room,cursor);
   return db.some(e=>e.turn_id===turnId&&TERMINAL.has(e.type))?db:undefined;},240000,2000);
  await until(async()=>await terminalRendered(s,turnId),suppress?10000:30000);
  await sleep(2000);
  const db=await authoritativeEvents(pool,s.tenant,s.uid,s.room,cursor);
  const dom=after(await projection(s.page),cursor);
  t.detail("turnId",turnId).detail("reloadAt",new Date(reloadAt).toISOString()).detail("firstProgressEvent",progress.event.type).detail("terminalSeenInDb",!!finished);
  t.writeJson("db-events.json",db,"Authoritative events after the starting cursor");
  t.writeJson("rendered-projection.json",dom,"Rendered transcript items after the starting cursor (data-event-id/seq/turn-id)");
  await shot(t,s,"after-reload.png","Transcript after reload and completion");
  s.log.write(t,"user");
  return s15Checks({turnId,reloadAt,db,dom,terminalBeforeReload});
 };
 await test("S15","Refresh mid-answer: the same turn completes once, with every fetch, in order",["S15"],async t=>{
  try{record(t,await s15(t,false));}finally{await closeAll();}
 });
 await test("NEG-S15","S15 checker fails when the turn's events are suppressed after reload",["S15"],async t=>{
  try{recordControl(t,"routeWebSocket in the test context drops every event of the target turn after reload",await s15(t,true),
   ["rendered projection equals the database projection item by item"]);}finally{await closeAll();}
 });

 const outage=async(t:TestRecorder,mode:"tcp"|"offline")=>{
  const proxy=mode==="tcp"?new CutProxy():null;if(proxy)await proxy.start();
  try{
   const s=await openSession("n1",proxy?{proxy:proxy.url}:{}),peer=await openSession("n2");
   await sleep(3000);
   const cursorBefore=await storedCursor(s);const dbLast=await lastSequence(pool,s.tenant,s.uid,s.room);
   t.assert("client cursor matched the database before the outage",cursorBefore===dbLast,dbLast,cursorBefore);
   const socketsBefore=s.log.sockets.length;const cutAt=Date.now();
   if(proxy)proxy.cut();else await s.context.setOffline(true);
   const closedAt=await until(async()=>s.log.sockets[socketsBefore-1]?.closedAt??undefined,10000,100);
   const statusDuring=await s.page.locator("span.status").textContent();
   const tags=[1,2,3,4,5].map(n=>`${tag("s16")} missed #${n}`);
   for(const text of tags){await post(peer,text);await sleep(2500);}
   await shot(t,s,"during-outage.png","Disconnected user's window during the outage");
   await shot(t,peer,"peer-during-outage.png","Peer's window during the outage, messages sent");
   await sleep(Math.max(0,cutAt+30000-Date.now()));
   const restoreAt=Date.now();
   const framesDuringOutage=s.log.frames.filter(f=>f.dir==="in"&&closedAt&&f.t>closedAt&&f.t<restoreAt).length;
   const attempts=s.log.sockets.slice(socketsBefore).filter(x=>x.createdAt<restoreAt);
   if(proxy)proxy.restore();else await s.context.setOffline(false);
   await until(async()=>{for(const x of tags)if(await s.page.locator("article.message",{hasText:x}).count()<1)return false;return true;},90000);
   await sleep(2000);
   const db=await authoritativeEvents(pool,s.tenant,s.uid,s.room,cursorBefore??0);
   const domA=after(await projection(s.page),cursorBefore??0),domB=after(await projection(peer.page),cursorBefore??0);
   const tagCounts=await Promise.all(tags.map(x=>s.page.locator("article.message",{hasText:x}).count()));
   const resub=s.log.frames.find(f=>f.dir==="out"&&f.t>=restoreAt&&f.frame?.type==="subscribe"&&f.frame.roomId===s.room);
   t.detail("outage",{mode,cutAt:new Date(cutAt).toISOString(),socketClosedAfterMs:closedAt?closedAt-cutAt:null,restoreAt:new Date(restoreAt).toISOString(),
    durationMs:restoreAt-cutAt,statusDuring,reconnectAttemptsDuringOutage:attempts.length,proxyLog:proxy?.log});
   t.assert("the open WebSocket closed within 5 s of the outage starting",!!closedAt&&closedAt-cutAt<=5000,"≤5000 ms",closedAt?closedAt-cutAt:null);
   t.assert("outage lasted at least 30 s",restoreAt-cutAt>=30000,"≥30000",restoreAt-cutAt);
   t.assert("UI did not claim to be online during the outage",statusDuring!=="online",'not "online"',statusDuring);
   if(mode==="tcp"){
    t.assert("no frame reached the client during the outage",framesDuringOutage===0,0,framesDuringOutage);
    t.assert("reconnect attempts during the outage were refused",(proxy!.log.filter(l=>l.event==="refused").length)>0,">0",proxy!.log.filter(l=>l.event==="refused").length);
   }else t.assert("client held reconnects while the browser reported offline",attempts.length===0,0,attempts.length);
   t.writeJson("db-events.json",db,"Authoritative events after the pre-outage cursor");
   t.writeJson("rendered-projection.json",{disconnected:domA,peer:domB},"Rendered transcript items after the pre-outage cursor in both browsers");
   record(t,s16Checks({cursorBefore:cursorBefore??-1,db,domA,domB,tagCounts,subscribeAfter:resub?.frame.after??null,persistedCursor:await storedCursor(s)}));
   await shot(t,s,"after-recovery.png","Disconnected user's window after recovery");
   s.log.write(t,"disconnected");peer.log.write(t,"peer");
  }finally{await closeAll();await proxy?.stop();}
 };
 await test("S16","30-second TCP-level outage: everything missed arrives once, in order, with the same IDs",["S16"],t=>outage(t,"tcp"));
 await test("S16-OFFLINE","30-second browser-reported offline (the DevTools path): same guarantees",["S16"],t=>outage(t,"offline"));

 await test("NEG-S16-DROP","S16 checker fails when one event is dropped every time it is delivered",["S16"],async t=>{
  try{
   let dropTag="";
   const s=await openSession("n1",{fault:{dropEvent:e=>!!dropTag&&String(e?.payload?.body??"").includes(dropTag)}}),peer=await openSession("n2");
   await sleep(2000);const cursorBefore=(await storedCursor(s))??0;
   const tags=[1,2,3].map(n=>`${tag("neg16")} #${n}`);dropTag=tags[1]!;
   for(const x of tags){await post(peer,x);await sleep(2000);}
   await until(async()=>(await peer.page.locator("article.message",{hasText:tags[2]!}).count())===1,20000);
   await sleep(8000);
   const db=await authoritativeEvents(pool,s.tenant,s.uid,s.room,cursorBefore);
   const domA=after(await projection(s.page),cursorBefore),domB=after(await projection(peer.page),cursorBefore);
   const tagCounts=await Promise.all(tags.map(x=>s.page.locator("article.message",{hasText:x}).count()));
   const replays=s.log.frames.filter(f=>f.dir==="out"&&f.frame?.type==="replay").length;
   t.detail("replayRequestsDuringControl",replays);
   recordControl(t,"routeWebSocket in the test context drops the event carrying message #2 on every delivery, including replays",
    s16Checks({cursorBefore,db,domA,domB,tagCounts,subscribeAfter:cursorBefore,persistedCursor:await storedCursor(s)}),
    ["every missed message rendered exactly once","nothing missing"]);
   s.log.write(t,"faulted");
  }finally{await closeAll();}
 });

 await test("NEG-S16-DUP","S16 checker fails when a delivered message is shown twice",["S16"],async t=>{
  try{
   const s=await openSession("n1"),peer=await openSession("n2");
   await sleep(2000);const cursorBefore=(await storedCursor(s))??0;
   const tags=[1,2].map(n=>`${tag("dup16")} #${n}`);
   for(const x of tags){await post(peer,x);await sleep(1500);}
   await until(async()=>(await s.page.locator("article.message",{hasText:tags[1]!}).count())===1,20000);
   await s.page.evaluate(text=>{const el=Array.from(document.querySelectorAll("article.message")).find(e=>e.textContent?.includes(text));
    if(el)el.after(el.cloneNode(true));},tags[0]!);
   const db=await authoritativeEvents(pool,s.tenant,s.uid,s.room,cursorBefore);
   const domA=after(await projection(s.page),cursorBefore),domB=after(await projection(peer.page),cursorBefore);
   const tagCounts=await Promise.all(tags.map(x=>s.page.locator("article.message",{hasText:x}).count()));
   recordControl(t,"DOM clone of one rendered transcript item in the test page",
    s16Checks({cursorBefore,db,domA,domB,tagCounts,subscribeAfter:cursorBefore,persistedCursor:await storedCursor(s)}),
    ["every missed message rendered exactly once","no rendered item appears twice"]);
   await shot(t,s,"duplicated.png","Test page after the injected duplicate");
  }finally{await closeAll();}
 });

 // Cloud Monitoring lags a few minutes; attach server-side request counts for the S17 window when available.
 if(monitoringWindows.S17){
  await sleep(Math.max(0,monitoringWindows.S17.end+240000-Date.now()));
  try{
   const token=execFileSync("gcloud",["auth","print-access-token"],{encoding:"utf8"}).trim();
   const {start,end}=monitoringWindows.S17;
   const filter=`metric.type="run.googleapis.com/request_count" AND resource.labels.service_name="${TARGET.apiService}"`;
   const url=`https://monitoring.googleapis.com/v3/projects/${TARGET.project}/timeSeries?filter=${encodeURIComponent(filter)}&interval.startTime=${new Date(start).toISOString()}&interval.endTime=${new Date(end).toISOString()}`;
   const res=await fetch(url,{headers:{authorization:`Bearer ${token}`}});const body=await res.json() as any;
   const total=(body.timeSeries??[]).flatMap((s:any)=>s.points??[]).reduce((n:number,p:any)=>n+Number(p.value?.int64Value??0),0);
   const s17=run.results.tests.find(x=>x.id==="S17");
   if(s17)s17.details.cloudMonitoringApiRequestsInWindow={total,note:`All clients of ${TARGET.apiService}, not only this browser; informational`,series:(body.timeSeries??[]).length};
  }catch(e){const s17=run.results.tests.find(x=>x.id==="S17");if(s17)s17.details.cloudMonitoringError=String(e);}
 }
}finally{
 await closeAll();await browser.close();await pool.end();
 fs.writeFileSync(path.join(run.dir,"navigation.json"),JSON.stringify({retried:navigations.filter(n=>n.attempts.length>1).length,sessions:navigations},null,1)+"\n");
 run.finish();
}
