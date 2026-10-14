/** Backward compatibility of migration 008: the previous release's code runs
 * against a database migrated to 008 (with a tenant chat already created by the
 * new code) and must still sign in, send, answer @AI with Vertex Gemini, list
 * rooms and replay. Throwaway local cluster; staging Firebase accounts.
 *   TEAMCHAT_TARGET=staging node --experimental-strip-types scripts/compat/old-release-vs-008.ts --old <worktree of the old release>
 * The old release hard-codes the runtime role name teamchat_api, which is why
 * this runs locally rather than against the staging database's own role. */
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import {spawn,execFileSync} from "node:child_process";
import {randomUUID} from "node:crypto";
import {startLocalCluster,PG_BIN} from "../integration/local-pg.ts";
import {createPgPool} from "../../src/server/database.ts";
import {inTenantTransaction,createTenantChat,replayRoom,type SqlClient,type PersistedEvent} from "../../src/persistence/postgres.ts";
import {resolvedContext} from "../../src/tenant.ts";
import {RunRecorder,git} from "../evidence/lib.ts";
import {TARGET,APP_URL,firebaseSignIn,runsDir,sleep,tag} from "../acceptance/common.ts";
import {LiveClient} from "../acceptance/live-client.ts";

const arg=(name:string)=>{const i=process.argv.indexOf(name);if(i<0||!process.argv[i+1])throw Error(`${name} is required`);return path.resolve(process.argv[i+1]!);};
const OLD=arg("--old"),ROOT=path.resolve(import.meta.dirname,"../..");
const oldSha=git(["rev-parse","HEAD"],OLD);
if(git(["status","--porcelain","--untracked-files=no"],OLD))throw Error("Old worktree has tracked modifications");
const N="northside-outfitters",V="valley-home-goods";
const freePort=()=>new Promise<number>(r=>{const s=net.createServer().listen(0,()=>{const p=(s.address() as net.AddressInfo).port;s.close(()=>r(p));});});

const run=new RunRecorder({suite:"compat-old-release",environment:`old release ${oldSha} (local process) against a local PostgreSQL migrated 001-008; ${TARGET.name} Firebase accounts; Vertex ${TARGET.project}`,
 sourceSha:git(["rev-parse","HEAD"],ROOT),deployment:null,harnessFiles:["scripts/compat/old-release-vs-008.ts","scripts/integration/local-pg.ts","scripts/acceptance/live-client.ts","scripts/acceptance/common.ts"],
 runsDir:runsDir(process.argv.includes("--scratch"))});
const cluster=await startLocalCluster();
let proc:ReturnType<typeof spawn>|undefined;
try{
 await run.run("COMPAT-008","Previous release on a 008 database: sign-in, send, @AI answer, room list, replay, and a new tenant chat",["D02"],async t=>{
  cluster.createDatabase("teamchat");
  const env=(extra:Record<string,string>)=>({...process.env,...extra});
  const node=(script:string,extra:Record<string,string>)=>execFileSync(process.execPath,["--experimental-strip-types",path.join(ROOT,script)],{cwd:ROOT,env:env(extra),encoding:"utf8"});
  const migrate=node("scripts/db/migrate.ts",{MIGRATION_DATABASE_URL:cluster.url("teamchat_owner","teamchat")});
  node("scripts/db/provision-runtime-role.ts",{MIGRATION_DATABASE_URL:cluster.url("teamchat_owner","teamchat"),DB_RUNTIME_ROLE:"teamchat_api"});
  execFileSync(`${PG_BIN}/psql`,["-X","-q","-v","ON_ERROR_STOP=1","-d",cluster.url("teamchat_owner","teamchat"),"-f",path.join(ROOT,"db/generated/seed.sql")],{stdio:"ignore"});
  t.detail("migrations",migrate.trim().split("\n").map(l=>JSON.parse(l)));
  const [n1,n2,v1]=[await firebaseSignIn("n1"),await firebaseSignIn("n2"),await firebaseSignIn("v1")];
  const owner=await createPgPool(cluster.url("teamchat_owner","teamchat"));
  const asOwner=(tenant:string,fn:(c:SqlClient)=>Promise<unknown>)=>inTenantTransaction(owner,resolvedContext("provisioning-admin",tenant),fn);
  for(const [who,tenant,name,rooms] of [[n1,N,"Northside Buyer One",["assortment-review","supply-planning"]],[n2,N,"Northside Buyer Two",["assortment-review","supply-planning"]],[v1,V,"Valley Buyer One",["assortment-review","range-planning"]]] as const)
   await asOwner(tenant,async c=>{
    await c.query("INSERT INTO teamchat.auth_directory(firebase_uid,tenant_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[who.uid,tenant]);
    await c.query("INSERT INTO teamchat.user_memberships(tenant_id,firebase_uid,display_name,role,active) VALUES($1,$2,$3,'member',true) ON CONFLICT DO NOTHING",[tenant,who.uid,name]);
    for(const r of rooms)await c.query("INSERT INTO teamchat.room_memberships(tenant_id,room_id,firebase_uid) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",[tenant,r,who.uid]);
   });
  await owner.end();
  const runtime=await createPgPool(cluster.url("teamchat_api","teamchat"));
  const chat=await createTenantChat(runtime,resolvedContext(n1.uid,N),{title:"Created by the new release",aiChat:true,clientRequestId:randomUUID()},()=>`chat-${randomUUID().slice(0,13)}`);
  if(!("room" in chat))throw Error("Tenant chat not created");
  const chatId=chat.room.room_id;

  const port=await freePort(),logFile=path.join(t.dir,"old-api.log"),out=fs.openSync(logFile,"w");
  const childEnv=env({DATABASE_URL:cluster.url("teamchat_api","teamchat"),FIREBASE_PROJECT_ID:TARGET.project,ALLOWED_ORIGINS:APP_URL,LOCAL_TASK_WORKER:"1",PORT:String(port),PG_POOL_MAX:"4",
   GCP_PROJECT_ID:TARGET.project,GOOGLE_CLOUD_PROJECT:TARGET.project,GOOGLE_CLOUD_REGION:TARGET.region,VERTEX_MODEL_ID:"gemini-2.5-flash",VERTEX_EMBEDDING_MODEL_ID:"text-embedding-004"});
  delete childEnv.GEMINI_API_KEY;delete childEnv.GOOGLE_API_KEY;delete childEnv.DB_RUNTIME_ROLE;
  proc=spawn(process.execPath,["--experimental-strip-types","src/server/start.ts"],{cwd:OLD,env:childEnv,stdio:["ignore",out,out]});
  let up=false;for(let i=0;i<60&&!up;i++){try{up=(await fetch(`http://127.0.0.1:${port}/health`)).ok;}catch{}if(!up)await sleep(500);}
  if(!up)throw Error("Old API did not become healthy; see old-api.log");
  const ws=`ws://127.0.0.1:${port}/ws`;
  const a=await new LiveClient("n1",ws).connect(n1),b=await new LiveClient("n2",ws).connect(n2);
  try{
   const rooms=await (await fetch(`http://127.0.0.1:${port}/api/rooms`,{headers:{authorization:`Bearer ${n2.idToken}`,origin:APP_URL}})).json() as {rooms:Array<{room_id:string}>};
   await a.subscribe("supply-planning");await b.subscribe("supply-planning");
   const plain=`${tag("compat")} plain message`;
   const sent=await a.post("supply-planning",plain);
   await b.until(()=>(b.events.get("supply-planning")??[]).some(e=>e.type==="message"&&e.payload.body===plain),15000,"peer delivery");
   const ask=await a.post("supply-planning","@AI what's the catalog code for portable air conditioning units?");
   const turn=ask.turnId?await a.waitTurn("supply-planning",ask.turnId,180000):undefined;
   await a.subscribe(chatId);
   const inChat=await a.post(chatId,`${tag("compat")} hello from the old release`);
   const c=await new LiveClient("n1",ws).connect(n1);
   await c.subscribe("supply-planning",sent.sequence-1);
   const replayed=(c.events.get("supply-planning")??[]).filter(e=>e.sequence>=sent.sequence);
   const db=((await replayRoom(runtime,resolvedContext(n1.uid,N),"supply-planning",sent.sequence-1,500)) as PersistedEvent[]);
   c.close();
   const roomIds=rooms.rooms.map(r=>r.room_id);
   t.detail("oldRelease",oldSha).detail("roomsListedForN2",roomIds).detail("turnEvents",turn?.events.map(e=>e.type)).detail("tools",turn?.tools.map(x=>x.name))
    .detail("replayed",replayed.length).detail("databaseEvents",db.length);
   t.assert("old API signs in a Firebase user over the socket",a.frames.some(f=>f.frame.type==="auth_ok"),true,true);
   t.assert("old API lists rooms, including the tenant chat the new release created",roomIds.includes(chatId)&&roomIds.includes("supply-planning"),chatId,roomIds);
   t.assert("plain message acknowledged and delivered to the second user",sent.sequence>0,">0",sent.sequence);
   t.assert("@AI message starts a turn that completes with a catalog fetch",turn?.terminal?.type==="ai_complete"&&turn.tools.some(x=>x.name==="search_catalog"),"ai_complete + search_catalog",turn&&{terminal:turn.terminal?.type,tools:turn.tools.map(x=>x.name)});
   t.assert("old API posts into the new tenant chat",inChat.sequence>0,">0",inChat.sequence);
   t.assert("replay after reconnect equals the database",replayed.length===db.length&&replayed.every((e,i)=>e.eventId===db[i]!.event_id),db.length,replayed.length);
  }finally{a.close();b.close();await runtime.end();proc.kill("SIGTERM");await sleep(1500);fs.closeSync(out);t.artifact("old-api.log","Old release API output");}
 });
}finally{proc?.kill("SIGKILL");cluster.stop();run.finish();}
