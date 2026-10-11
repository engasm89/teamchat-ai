/** Reviewer handoff checks against the deployed stack: the six accounts sign in with the
 * Keychain passwords, map to the right tenant through the API, belong to the reviewer rooms,
 * and each tenant's reviewer room holds a three-person conversation with a tool-backed AI turn.
 * Usage: node --experimental-strip-types scripts/handoff/run-handoff.ts */
import {RunRecorder} from "../evidence/lib.ts";
import {ACCOUNTS,API_URL,APP_URL,QA_ROOM,bindDeployment,openDb,authoritativeEvents,firebaseApiKey,firebaseSignIn,sleep,type AccountKey} from "../acceptance/common.ts";
import {LiveClient} from "../acceptance/live-client.ts";

const HARNESS=["scripts/handoff/run-handoff.ts","scripts/acceptance/common.ts","scripts/acceptance/live-client.ts","scripts/evidence/lib.ts"];
const REVIEWER_ROOMS=["assortment-review","category-strategy"];
const {sourceSha,deployment}=bindDeployment();
const run=new RunRecorder({suite:"handoff",environment:`production: ${APP_URL} + ${API_URL}`,sourceSha,deployment,harnessFiles:HARNESS});
const keys=Object.keys(ACCOUNTS) as AccountKey[];
const tenants=[...new Set(keys.map(k=>ACCOUNTS[k].tenant))].sort();
const api=async(pathName:string,token:string)=>{
 const res=await fetch(API_URL+pathName,{headers:{Authorization:`Bearer ${token}`,Origin:APP_URL}});
 return {status:res.status,body:res.ok?await res.json() as any:null};
};
const identities=new Map<AccountKey,Awaited<ReturnType<typeof firebaseSignIn>>>();
const pool=await openDb();

try{
 await run.run("ACCOUNTS","Six enabled Firebase accounts, three per tenant, sign in successfully",["D04","D09","A15"],async t=>{
  const rows:Array<Record<string,unknown>>=[];
  for(const k of keys){
   let signedIn=false,disabled:boolean|null=null,me:{status:number;body:any}={status:0,body:null},error:string|undefined;
   try{
    const who=await firebaseSignIn(k);identities.set(k,who);signedIn=true;
    const lookup=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseApiKey()}`,
     {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({idToken:who.idToken})});
    disabled=lookup.ok?Boolean(((await lookup.json()) as any).users?.[0]?.disabled):null;
    me=await api("/api/me",who.idToken);
   }catch(e){error=String(e);}
   rows.push({account:k,email:ACCOUNTS[k].email,expectedTenant:ACCOUNTS[k].tenant,signedIn,disabled,apiStatus:me.status,apiTenant:me.body?.tenantId??null,uid:me.body?.uid??null,...(error?{error}:{})});
  }
  t.detail("accounts",rows).detail("passwordSource","macOS Keychain service teamchat-ai-reviewer (never written to evidence)");
  t.assert("all six accounts sign in with their Keychain passwords",rows.every(r=>r.signedIn),6,rows.filter(r=>r.signedIn).length);
  t.assert("no account is disabled",rows.every(r=>r.disabled===false),"none disabled",rows.map(r=>[r.account,r.disabled]));
  t.assert("the deployed API maps every account to its expected tenant",rows.every(r=>r.apiStatus===200&&r.apiTenant===r.expectedTenant),"expected tenants",rows.map(r=>[r.account,r.apiStatus,r.apiTenant]));
  t.assert("three distinct users per tenant",tenants.every(tn=>new Set(rows.filter(r=>r.apiTenant===tn).map(r=>r.uid)).size===3),"3 per tenant",
   Object.fromEntries(tenants.map(tn=>[tn,rows.filter(r=>r.apiTenant===tn).length])));
 });

 await run.run("MEMBERSHIPS","Room memberships per tenant are populated",["D09"],async t=>{
  const lists:Record<string,string[]>={};
  for(const k of keys){const who=identities.get(k);if(!who)continue;const r=await api("/api/rooms",who.idToken);
   lists[k]=r.status===200?(r.body.rooms as Array<{room_id:string}>).map(x=>x.room_id):[`HTTP ${r.status}`];}
  t.detail("roomsPerAccount",lists).detail("reviewerRooms",REVIEWER_ROOMS);
  t.assert("every account lists its rooms through the API",keys.every(k=>(lists[k]?.length??0)>0&&!lists[k]![0]!.startsWith("HTTP")),"6 lists",Object.keys(lists).length);
  t.assert("every account is a member of both reviewer rooms",keys.every(k=>REVIEWER_ROOMS.every(r=>lists[k]?.includes(r))),REVIEWER_ROOMS,lists);
 });

 await run.run("BOUNDARIES","Each account sees only its own chain: API rejects missing or forged tokens; WebSocket replay holds only own-tenant events",["D04","G04"],async t=>{
  const anon=await fetch(API_URL+"/api/me",{headers:{Origin:APP_URL}});
  const forged=await fetch(API_URL+"/api/me",{headers:{Origin:APP_URL,Authorization:"Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.forged"}});
  t.detail("unauthenticated",{noToken:anon.status,forgedToken:forged.status});
  t.assert("the API rejects a request without a token",anon.status===401,401,anon.status);
  t.assert("the API rejects a forged token",forged.status===401,401,forged.status);
  const room="assortment-review";
  const dbIds=new Map<string,Set<string>>();
  for(const tenant of tenants){const k=keys.find(x=>ACCOUNTS[x].tenant===tenant&&identities.has(x))!;
   dbIds.set(tenant,new Set((await authoritativeEvents(pool,tenant,identities.get(k)!.uid,room,0)).map(e=>e.event_id)));}
  const foreignOnly:Record<string,string>={"northside-outfitters":QA_ROOM["valley-home-goods"],"valley-home-goods":QA_ROOM["northside-outfitters"]};
  const rows:Array<Record<string,unknown>>=[];
  for(const k of keys){
   const who=identities.get(k);if(!who){rows.push({account:k,error:"not signed in"});continue;}
   const own=ACCOUNTS[k].tenant,other=tenants.find(x=>x!==own)!;
   const c=await new LiveClient(k).connect(who);
   try{
    await c.subscribe(room,0);await sleep(2500);
    const got=c.events.get(room)??[];
    const probe=foreignOnly[own]!;c.send({type:"subscribe",roomId:probe,after:0});await sleep(2500);
    const probeEvents=(c.events.get(probe)??[]).length;
    const probeReply=c.frames.filter(f=>f.dir==="in"&&f.frame.roomId===probe).map(f=>f.frame.type);
    rows.push({account:k,tenant:own,replayed:got.length,
     wrongTenantLabel:got.filter(e=>e.tenantId!==own).length,
     notInOwnTenantDb:got.filter(e=>!dbIds.get(own)!.has(e.eventId)).length,
     inOtherTenantDb:got.filter(e=>dbIds.get(other)!.has(e.eventId)).length,
     foreignOnlyRoom:probe,foreignRoomEvents:probeEvents,foreignRoomReplies:[...new Set(probeReply)]});
   }finally{c.close();}
  }
  t.detail("replayRoom",room).detail("accounts",rows);
  t.assert("every account replays a populated reviewer room",rows.every(r=>Number(r.replayed)>0),">0 each",rows.map(r=>[r.account,r.replayed]));
  t.assert("every replayed event belongs to the account's own tenant (label and database)",rows.every(r=>r.wrongTenantLabel===0&&r.notInOwnTenantDb===0&&r.inOtherTenantDb===0),
   "0 foreign",rows.map(r=>[r.account,r.wrongTenantLabel,r.notInOwnTenantDb,r.inOtherTenantDb]));
  t.assert("subscribing to a room that exists only in the other chain yields no events",rows.every(r=>r.foreignRoomEvents===0),0,rows.map(r=>[r.account,r.foreignOnlyRoom,r.foreignRoomEvents,r.foreignRoomReplies]));
 });

 await run.run("SEEDED-HISTORY","Both tenants have human message history and at least one genuine tool-backed AI exchange",["D01","D08","A15"],async t=>{
  const summary:Record<string,unknown>={};
  for(const tenant of tenants){
   const members=keys.filter(k=>ACCOUNTS[k].tenant===tenant).map(k=>identities.get(k)).filter(Boolean);
   const uids=new Set(members.map(m=>m!.uid));
   const db=await authoritativeEvents(pool,tenant,members[0]!.uid,"assortment-review",0);
   const humans=db.filter(e=>e.type==="message"&&uids.has(String(e.payload.author_uid)));
   const exchanges=db.filter(e=>e.type==="ai_tool"&&Array.isArray(e.payload.result)&&(e.payload.result as unknown[]).length>0&&db.some(x=>x.turn_id===e.turn_id&&x.type==="ai_complete"));
   const example=exchanges[0];
   summary[tenant]={events:db.length,humanMessages:humans.length,distinctHumanAuthors:new Set(humans.map(e=>String(e.payload.author_uid))).size,
    toolBackedExchanges:new Set(exchanges.map(e=>e.turn_id)).size,
    example:example?{turnId:example.turn_id,tool:example.payload.name,arguments:example.payload.arguments,resultCount:(example.payload.result as unknown[]).length,
     question:db.filter(e=>e.type==="message"&&e.sequence<example.sequence&&/@AI/i.test(String(e.payload.body))).at(-1)?.payload.body}:null};
  }
  t.detail("assortmentReview",summary);
  for(const tenant of tenants){const s=summary[tenant] as {distinctHumanAuthors:number;toolBackedExchanges:number};
   t.assert(`${tenant}: three tenant users have posted in assortment-review`,s.distinctHumanAuthors>=3,">=3",s.distinctHumanAuthors);
   t.assert(`${tenant}: at least one completed AI turn fetched a non-empty tool result`,s.toolBackedExchanges>=1,">=1",s.toolBackedExchanges);}
 });
}finally{await pool.end();run.finish();}
