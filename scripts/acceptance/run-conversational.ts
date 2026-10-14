/** Conversation, names and tenant-wide chats on a deployed stack.
 *   TEAMCHAT_TARGET=staging node --experimental-strip-types scripts/acceptance/run-conversational.ts
 *   ... --replay audit/gonzalo-2026-10-14/REPLAY_FIXTURES_PRIVATE.json   (private prompts; output stays under audit/)
 * Creates chats, so it refuses the production target unless --allow-production-chats is given. */
import fs from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {RunRecorder,type TestRecorder} from "../evidence/lib.ts";
import {API_URL,APP_URL,ACCOUNTS,TARGET,runsDir,bindDeployment,openDb,authoritativeEvents,firebaseSignIn,sleep,tag,type AccountKey} from "./common.ts";
import {LiveClient,type Turn} from "./live-client.ts";
import * as oracle from "./oracle.ts";

const args=process.argv.slice(2);
const REPLAY=args.includes("--replay")?args[args.indexOf("--replay")+1]!:null;
if(TARGET.name==="production"&&!args.includes("--allow-production-chats"))throw Error("This suite creates chats; it does not run against production without --allow-production-chats");
const N="northside-outfitters",V="valley-home-goods";
const NAMES:Record<AccountKey,string>={n1:"Northside Buyer One",n2:"Northside Buyer Two",n3:"Northside Analyst Three",v1:"Valley Buyer One",v2:"Valley Buyer Two",v3:"Valley Analyst Three"};
const HARNESS=["scripts/acceptance/run-conversational.ts","scripts/acceptance/live-client.ts","scripts/acceptance/common.ts","scripts/acceptance/target.ts","scripts/evidence/lib.ts"];

const {sourceSha,deployment}=bindDeployment();
const pool=await openDb();
const run=new RunRecorder({suite:REPLAY?"reviewer-replay":"conversational",environment:`${TARGET.name}: ${APP_URL} + ${API_URL}`,sourceSha,deployment,harnessFiles:HARNESS,
 runsDir:REPLAY?path.join(path.dirname(REPLAY),`${TARGET.name}-runs`):runsDir(args.includes("--scratch"))});
const clients:LiveClient[]=[];
const identities=new Map<AccountKey,Awaited<ReturnType<typeof firebaseSignIn>>>();
const who=async(k:AccountKey)=>{if(!identities.has(k))identities.set(k,await firebaseSignIn(k));return identities.get(k)!;};
async function client(k:AccountKey,room?:string){const c=await new LiveClient(k).connect(await who(k));clients.push(c);if(room)await c.subscribe(room);return c;}
const closeClients=()=>{for(const c of clients.splice(0))c.close();};

async function rooms(k:AccountKey,init:{method?:string;body?:unknown;origin?:string|null}={}){
 const headers:Record<string,string>={authorization:`Bearer ${(await who(k)).idToken}`};
 if(init.origin!==null)headers.origin=init.origin??APP_URL;
 if(init.body!==undefined)headers["content-type"]="application/json";
 const res=await fetch(`${API_URL}/api/rooms`,{method:init.method??"GET",headers,...(init.body!==undefined?{body:JSON.stringify(init.body)}:{})});
 const text=await res.text();let json:any;try{json=JSON.parse(text);}catch{json=text;}
 return {status:res.status,json};
}
const newChat=(k:AccountKey,title:string,aiChat=true,clientRequestId:string=randomUUID())=>rooms(k,{method:"POST",body:{title,aiChat,clientRequestId}});
/** A fresh team chat (AI only on @AI), so scenarios never share a room with other runs. */
async function teamChat(k:AccountKey,label:string){const r=await newChat(k,`${label} ${tag(label.toLowerCase())}`,false);if(r.status!==201)throw Error(`create ${r.status}`);return r.json.room.room_id as string;}

const segments=(turn:Turn)=>turn.segments.map(s=>String(s.rendered??""));
const shown=(turn:Turn)=>segments(turn).join("\n");
const uids=async()=>Promise.all((Object.keys(ACCOUNTS) as AccountKey[]).map(async k=>(await who(k)).uid));
/** Seconds from the message's persisted time to the turn's first segment and terminal event (room_events.created_at). */
async function latency(k:AccountKey,room:string,sequence:number,turnId:string){
 const id=await who(k);
 const ev=await authoritativeEvents(pool,id.tenant,id.uid,room,sequence-1);
 const at=(e:{created_at?:unknown}|undefined)=>e?.created_at?new Date(String(e.created_at)).getTime():NaN;
 const msg=ev.find(e=>Number(e.sequence)===sequence),first=ev.find(e=>e.turn_id===turnId&&e.type==="ai_answer_segment"),end=ev.find(e=>e.turn_id===turnId&&["ai_complete","ai_failed"].includes(e.type));
 const s=(x:number)=>Number.isFinite(x)?Math.round(x)/1000:null;
 return {firstSegmentS:s(at(first)-at(msg)),terminalS:s(at(end)-at(msg))};
}
async function ask(t:TestRecorder,c:LiveClient,room:string,prompt:string,label:string){
 const sent=await c.post(room,prompt);
 if(!sent.turnId)throw Error(`No AI turn for: ${prompt}`);
 const turn=await c.waitTurn(room,sent.turnId,180000);
 const timing=await latency(c.account,room,sent.sequence,turn.turnId);
 t.writeJson(`${label}.json`,{label,user:NAMES[c.account],room,prompt,turnId:turn.turnId,terminal:turn.terminal?.type,timing,
  tools:turn.tools.map(x=>({name:x.name,arguments:x.arguments})),segments:turn.segments.map(s=>({kind:s.kind,rendered:s.rendered})),
  events:turn.events.map(e=>e.type)},`${label}: prompt, tools, shown segments, latency`);
 return {turn,timing,sent};
}
const noUid=async(turn:Turn)=>{const text=shown(turn);const ids=await uids();return ids.filter(u=>text.includes(u));};
const digitsGrounded=(turn:Turn)=>{
 const fetched=JSON.stringify(turn.tools.map(x=>x.result));
 const numbers=(shown(turn).replace(/\b[A-Z]{2,4}-[\d.]+\b/g,"").match(/\d[\d,.]*/g)??[]).map(n=>n.replace(/[.,]$/,""));
 return numbers.filter(n=>!fetched.includes(n)&&!fetched.includes(n.replace(/,/g,"")));
};

type Scenario=[string,string,(t:TestRecorder)=>Promise<void>];
const scenarios:Scenario[]=[
 ["C01","Small talk in an AI chat is answered in Gemini's own words, without tools, quickly",async t=>{
  const chat=await newChat("n1",`Small talk ${tag("c01")}`);if(chat.status!==201)throw Error(`create ${chat.status}`);
  const room=chat.json.room.room_id;const c=await client("n1",room);
  const {turn,timing}=await ask(t,c,room,"hi! how are you doing today?","c01");
  t.detail("timing",timing);
  t.assert("turn completed",turn.terminal?.type==="ai_complete","ai_complete",turn.terminal?.type);
  t.assert("no tool was called",turn.tools.length===0,0,turn.tools.map(x=>x.name));
  t.assert("at least one conversational segment shown",turn.segments.length>0&&turn.segments.every(s=>s.kind==="say"),"say segments",turn.segments.map(s=>s.kind));
  t.assert("no canned no-record reply",!/I have no record of that/.test(shown(turn)),"absent",shown(turn));
 }],
 ["C02","The assistant knows who said what in the room, by display name",async t=>{
  const chat=await newChat("n1",`Who said what ${tag("c02")}`,false);if(chat.status!==201)throw Error(`create ${chat.status}`);
  const room=chat.json.room.room_id;const a=await client("n1",room),b=await client("n2",room);
  const line=`I'll draft the supplier email for the hiking range ${tag("x")}`;
  await a.post(room,"Morning! Can someone own the supplier follow-up?");await b.post(room,line);await sleep(800);
  const {turn,timing}=await ask(t,a,room,"@AI what did my colleague just say they'd do?","c02");
  const leaked=await noUid(turn);
  t.detail("timing",timing);
  t.assert("turn completed",turn.terminal?.type==="ai_complete","ai_complete",turn.terminal?.type);
  t.assert("answer attributes the message to Northside Buyer Two by name",shown(turn).includes(NAMES.n2),NAMES.n2,shown(turn));
  t.assert("answer quotes the colleague's words",shown(turn).includes(line),line,shown(turn));
  t.assert("no Firebase UID shown",leaked.length===0,[],leaked.length);
 }],
 ["C03","A follow-up question is understood from the conversation, and every code shown was fetched",async t=>{
  const room=await teamChat("n2","Follow-up");const c=await client("n2",room);
  const first=await ask(t,c,room,"@AI what's the catalog code for portable air conditioners?","c03-first");
  const second=await ask(t,c,room,"@AI which one of those is the low-noise model?","c03-follow-up");
  const codes=[...new Set(shown(second.turn).match(oracle.CODE_PATTERN)??[])];
  const fetched=JSON.stringify([...first.turn.tools,...second.turn.tools].map(x=>x.result));
  t.detail("timing",{first:first.timing,followUp:second.timing});
  t.assert("both turns completed",first.turn.terminal?.type==="ai_complete"&&second.turn.terminal?.type==="ai_complete","ai_complete",[first.turn.terminal?.type,second.turn.terminal?.type]);
  t.assert("the follow-up answer names the low-noise code APP-100.19",codes.includes("APP-100.19"),"APP-100.19",shown(second.turn));
  t.assert("every code shown was fetched by a tool in this conversation",codes.every(x=>fetched.includes(x)),"all fetched",codes.filter(x=>!fetched.includes(x)));
 }],
 ["C04","A question the data cannot answer gets no invented figures",async t=>{
  const room=await teamChat("n2","Unanswerable");const c=await client("n2",room);
  const {turn}=await ask(t,c,room,"@AI how many tents did ST-4007 sell last week?","c04");
  const invented=digitsGrounded(turn);
  t.assert("turn completed",turn.terminal?.type==="ai_complete","ai_complete",turn.terminal?.type);
  t.assert("every number shown appears in this turn's tool results",invented.length===0,[],invented);
  t.assert("no sales figure claimed",!/\bsold\b|\bunits\b/i.test(shown(turn).replace(/no sales|sales data/gi,"")),"no sales claim",shown(turn));
 }],
 ["C05","Asking what the assistant can do lists its capabilities and never fails",async t=>{
  const room=await teamChat("n2","Capabilities");const c=await client("n2",room);
  const {turn,timing}=await ask(t,c,room,"@AI which are your tools?","c05");
  t.detail("timing",timing);
  t.assert("turn completed (not failed, not retried)",turn.terminal?.type==="ai_complete"&&!turn.events.some(e=>e.type==="ai_retrying"),"ai_complete",turn.events.map(e=>e.type));
  t.assert("capabilities shown",/I can: search the product catalog/.test(shown(turn)),"capabilities",shown(turn));
 }],
 ["N01","A new chat appears live for every active teammate, never for another tenant; AI chats answer without @AI",async t=>{
  const n2=await client("n2"),v1=await client("v1");
  const before=n2.frames.length,vBefore=v1.frames.length;
  const requestId=randomUUID(),title=`Team chat ${tag("n01")}`;
  const created=await newChat("n1",title,true,requestId);
  if(created.status!==201)throw Error(`create ${created.status} ${JSON.stringify(created.json)}`);
  const room=created.json.room;
  const pushed=await n2.until(()=>n2.frames.slice(before).some(f=>f.dir==="in"&&f.frame.type==="rooms_changed"),10000,"rooms_changed").then(()=>true,()=>false);
  await sleep(2000);
  const vPushed=v1.frames.slice(vBefore).some(f=>f.dir==="in"&&f.frame.type==="rooms_changed");
  const n2List=await rooms("n2"),v1List=await rooms("v1"),again=await newChat("n1",title,true,requestId);
  const listed=(n2List.json.rooms??[]).find((r:any)=>r.room_id===room.room_id);
  await n2.subscribe(room.room_id);
  const a=await client("n1",room.room_id);
  const sent=await a.post(room.room_id,"hello team, anyone around?");
  const seen=await n2.until(()=>(n2.events.get(room.room_id)??[]).some(e=>e.type==="message"&&e.sequence===sent.sequence),10000,"live message").then(()=>true,()=>false);
  const turn=sent.turnId?await a.waitTurn(room.room_id,sent.turnId,180000):undefined;
  v1.send({type:"subscribe",roomId:room.room_id,after:0});await sleep(3000);
  const vEvents=v1.events.get(room.room_id)??[];
  const vFrames=v1.frames.filter(f=>f.dir==="in"&&JSON.stringify(f.frame).includes(room.room_id));
  t.detail("room",room).detail("membersListedForN2",(n2List.json.members??[]).map((m:any)=>m.display_name));
  t.assert("POST /api/rooms creates the chat (201)",created.status===201,201,created.status);
  t.assert("repeating the request returns the same chat (200)",again.status===200&&again.json.room?.room_id===room.room_id,{status:200,room:room.room_id},{status:again.status,room:again.json.room?.room_id});
  t.assert("teammate's socket got rooms_changed within 10 s",pushed,true,pushed);
  t.assert("teammate's room list includes the chat, marked as an AI chat",!!listed&&listed.ai_chat===true,true,listed);
  t.assert("teammate sees the creator's message live",seen,true,seen);
  t.assert("a plain message in an AI chat gets an answer",turn?.terminal?.type==="ai_complete","ai_complete",turn?.terminal?.type??"no turn");
  t.assert("Valley's room list does not include it",!(v1List.json.rooms??[]).some((r:any)=>r.room_id===room.room_id),"absent",v1List.status);
  t.assert("Valley's socket got no rooms_changed",!vPushed,false,vPushed);
  t.assert("Valley cannot subscribe to it: no events and no frame carrying its content",vEvents.length===0&&!vFrames.some(f=>f.frame.type==="event"),0,{events:vEvents.length,frames:vFrames.map(f=>f.frame.type)});
 }],
 ["N02","Chat creation rejects bad input, missing origin and missing auth",async t=>{
  const bad=await newChat("n1","");const long=await newChat("n1","x".repeat(81));const extra=await rooms("n1",{method:"POST",body:{title:"ok",aiChat:true,clientRequestId:randomUUID(),tenantId:V}});
  const noOrigin=await rooms("n1",{method:"POST",body:{title:"ok",aiChat:true,clientRequestId:randomUUID()},origin:null});
  const anon=await fetch(`${API_URL}/api/rooms`,{method:"POST",headers:{origin:APP_URL,"content-type":"application/json"},body:JSON.stringify({title:"ok",aiChat:true,clientRequestId:randomUUID()})});
  const foreign=await rooms("n1",{method:"POST",body:{title:"ok",aiChat:true,clientRequestId:randomUUID()},origin:"https://evil.example"});
  t.assert("empty title rejected (400)",bad.status===400,400,bad.status);
  t.assert("81-character title rejected (400)",long.status===400,400,long.status);
  t.assert("unknown field (tenantId) rejected (400)",extra.status===400,400,extra.status);
  t.assert("POST without Origin rejected",noOrigin.status===403,403,noOrigin.status);
  t.assert("POST from a foreign Origin rejected",foreign.status===403,403,foreign.status);
  t.assert("POST without a token rejected (401)",anon.status===401,401,anon.status);
 }],
];

async function replay(t:TestRecorder,fixture:string){
 const prompts=(JSON.parse(fs.readFileSync(fixture,"utf8")) as {prompts:Array<{seq:number;text:string}>}).prompts;
 const chat=await newChat("n2",`Replay ${tag("r")}`);if(chat.status!==201)throw Error(`create ${chat.status}`);
 const room=chat.json.room.room_id;const a=await client("n1",room),b=await client("n2",room);
 await b.post(room,"Let's use this chat to plan the outerwear review for next week.");
 await a.post(room,"Sounds good. I'll pull the store list tomorrow.");
 const results=[];
 for(const p of prompts){
  const {turn,timing}=await ask(t,a,room,p.text,`replay-${p.seq}`);
  results.push({seq:p.seq,terminal:turn.terminal?.type,tools:turn.tools.map(x=>x.name),kinds:turn.segments.map(s=>s.kind),timing,
   uidShown:(await noUid(turn)).length>0,cannedNoRecord:/I have no record of that/.test(shown(turn)),retried:turn.events.some(e=>e.type==="ai_retrying")});
 }
 t.writeJson("summary.json",results,"Per prompt: terminal event, tools, segment kinds, latency, UID/canned/retry flags");
 t.assert("every replayed prompt completed",results.every(r=>r.terminal==="ai_complete"),"all ai_complete",results.map(r=>r.terminal));
 t.assert("no answer shows a Firebase UID",results.every(r=>!r.uidShown),false,results.map(r=>r.uidShown));
 t.assert("no canned 'no record' reply",results.every(r=>!r.cannedNoRecord),false,results.map(r=>r.cannedNoRecord));
 t.assert("no turn retried",results.every(r=>!r.retried),false,results.map(r=>r.retried));
 t.assert("every prompt got a real reply, not only the generic fallback",results.every(r=>r.kinds.some(k=>k!=="fallback")),"say or fact segments",results.map(r=>r.kinds));
}

try{
 if(REPLAY)await run.run("REPLAY","Reviewer-account prompts replayed in an AI chat",["GONZALO"],async t=>{try{await replay(t,REPLAY);}finally{closeClients();}});
 else for(const [id,title,body] of scenarios){
  if(args.includes("--only")&&!args[args.indexOf("--only")+1]!.split(",").includes(id))continue;
  await run.run(id,title,["GONZALO"],async t=>{try{await body(t);}finally{closeClients();}});
 }
}finally{closeClients();await pool.end();run.finish();}
