/** Non-disruptive smoke test of a deployed target, in its Northside QA room only:
 * health, room list, a plain message delivered to a teammate, an @AI catalog
 * question answered with a fetch, and replay after reconnect equal to the
 * database. Creates no chats and saves no memories. Used to show the previous
 * production release still works on the migrated schema, and after a rollout.
 *   TEAMCHAT_TARGET=production node --experimental-strip-types scripts/compat/live-smoke.ts [--label <text>] */
import {RunRecorder} from "../evidence/lib.ts";
import {API_URL,APP_URL,QA_ROOM,TARGET,runsDir,bindDeployment,openDb,authoritativeEvents,firebaseSignIn,tag} from "../acceptance/common.ts";
import {LiveClient} from "../acceptance/live-client.ts";

const label=process.argv.includes("--label")?process.argv[process.argv.indexOf("--label")+1]!:"live";
const N="northside-outfitters",ROOM=QA_ROOM[N];
const {sourceSha,deployment}=bindDeployment();
const run=new RunRecorder({suite:"live-smoke",environment:`${TARGET.name}: ${APP_URL} + ${API_URL} (${label})`,sourceSha,deployment,
 harnessFiles:["scripts/compat/live-smoke.ts","scripts/acceptance/live-client.ts","scripts/acceptance/common.ts"],runsDir:runsDir(process.argv.includes("--scratch"))});

await run.run("SMOKE","Health, room list, delivery, an @AI answer with a fetch, and replay equal to the database, in the QA room",["D02"],async t=>{
 const health=await fetch(`${API_URL}/health`);
 const [n1,n2]=[await firebaseSignIn("n1"),await firebaseSignIn("n2")];
 const rooms=await (await fetch(`${API_URL}/api/rooms`,{headers:{authorization:`Bearer ${n2.idToken}`,origin:APP_URL}})).json() as {rooms:Array<{room_id:string}>};
 const a=await new LiveClient("n1").connect(n1),b=await new LiveClient("n2").connect(n2);
 const pool=await openDb();
 try{
  await a.subscribe(ROOM);await b.subscribe(ROOM);
  const plain=`${tag("smoke")} plain message`;
  const sent=await a.post(ROOM,plain);
  await b.until(()=>(b.events.get(ROOM)??[]).some(e=>e.type==="message"&&e.payload.body===plain),15000,"peer delivery");
  const ask=await a.post(ROOM,"@AI what's the catalog code for portable air conditioning units?");
  const turn=ask.turnId?await a.waitTurn(ROOM,ask.turnId,180000):undefined;
  const c=await new LiveClient("n1").connect(n1);
  await c.subscribe(ROOM,sent.sequence-1);
  const replayed=(c.events.get(ROOM)??[]).filter(e=>e.sequence>=sent.sequence);
  const db=await authoritativeEvents(pool,N,n1.uid,ROOM,sent.sequence-1);
  c.close();
  const roomIds=rooms.rooms.map(r=>r.room_id);
  t.detail("accounts",[n1.email,n2.email]).detail("turnEvents",turn?.events.map(e=>e.type)).detail("tools",turn?.tools.map(x=>x.name))
   .detail("replayed",replayed.length).detail("databaseEvents",db.length);
  t.assert("API health is 200",health.status===200,200,health.status);
  t.assert("the room list includes the QA room",roomIds.includes(ROOM),ROOM,roomIds);
  t.assert("plain message acknowledged and delivered to the second user",sent.sequence>0,">0",sent.sequence);
  t.assert("@AI message starts a turn that completes with a catalog fetch",turn?.terminal?.type==="ai_complete"&&turn.tools.some(x=>x.name==="search_catalog"),"ai_complete + search_catalog",turn&&{terminal:turn.terminal?.type,tools:turn.tools.map(x=>x.name)});
  t.assert("replay after reconnect equals the database",replayed.length===db.length&&replayed.every((e,i)=>e.eventId===db[i]!.event_id),db.length,replayed.length);
 }finally{a.close();b.close();await pool.end();}
});
run.finish();
