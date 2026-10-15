/** Real PostgreSQL, real roles: tenant-wide chats, membership authorization
 * enforced by PostgreSQL itself for the runtime role, the migration runner,
 * and the AI worker loop with a scripted model. Runs on a throwaway local
 * cluster (scripts/integration/local-pg.ts); never on a shared database.
 *   npm run test:tenant-chats */
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {randomUUID} from "node:crypto";
import {startLocalCluster,PG_BIN,type LocalCluster} from "./local-pg.ts";
import {createPgPool,assertRuntimeDbRole} from "../../src/server/database.ts";
import {inTenantTransaction,sendDurableMessage,replayRoom,createTenantChat,listRoomDirectory,RoomCreationError,type SqlPool,type SqlClient,type PersistedEvent} from "../../src/persistence/postgres.ts";
import {resolvedContext,NO_MATCH} from "../../src/tenant.ts";
import {executeAiJob,GeminiUnavailableError,ESCALATION_NOTE,type GeminiProvider,type RoundResult} from "../../src/worker/gemini.ts";
import {loadFixtures} from "../../src/fixtures.ts";

const pgModule="pg";
const pg:{Client:new(config:{connectionString:string})=>any}=(await import(pgModule)).default;
const ROOT=path.resolve(import.meta.dirname,"../..");
const N="northside-outfitters",V="valley-home-goods";
const node=(script:string,env:Record<string,string>)=>execFileSync(process.execPath,["--experimental-strip-types",path.join(ROOT,script)],{cwd:ROOT,encoding:"utf8",env:{...process.env,...env},stdio:["ignore","pipe","pipe"]});
const DENIED=/row-level security|permission denied|violates foreign key|violates row-level/;
type Pool=SqlPool&{end():Promise<void>};

let cluster:LocalCluster,owner:Pool,api:Pool;
const northStore=loadFixtures().storesByTenant[N][0]!;

async function asOwner(tenant:string,fn:(c:SqlClient)=>Promise<unknown>){return inTenantTransaction(owner,resolvedContext("provisioning-admin",tenant),fn);}
async function addUser(tenant:string,uid:string,name:string,active=true,rooms:string[]=[]){
 await asOwner(tenant,async c=>{
  await c.query("INSERT INTO teamchat.auth_directory(firebase_uid,tenant_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[uid,tenant]);
  await c.query("INSERT INTO teamchat.user_memberships(tenant_id,firebase_uid,display_name,role,active) VALUES($1,$2,$3,'member',$4) ON CONFLICT (tenant_id,firebase_uid) DO UPDATE SET active=EXCLUDED.active",[tenant,uid,name,active]);
  for(const r of rooms)await c.query("INSERT INTO teamchat.room_memberships(tenant_id,room_id,firebase_uid) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",[tenant,r,uid]);
 });
}
const setActive=(tenant:string,uid:string,active:boolean)=>asOwner(tenant,c=>c.query("UPDATE teamchat.user_memberships SET active=$3 WHERE tenant_id=$1 AND firebase_uid=$2",[tenant,uid,active]));
const members=async(tenant:string,room:string)=>((await asOwner(tenant,c=>c.query<{firebase_uid:string}>("SELECT firebase_uid FROM teamchat.room_memberships WHERE tenant_id=$1 AND room_id=$2 ORDER BY 1",[tenant,room]))) as {rows:{firebase_uid:string}[]}).rows.map(r=>r.firebase_uid);
/** Raw SQL as the runtime role, with tenant context and app.uid like the server path. */
const asRuntime=(uid:string,fn:(c:SqlClient)=>Promise<unknown>,tenant=N)=>inTenantTransaction(api,resolvedContext(uid,tenant),async c=>{await c.query("SELECT set_config('app.uid',$1,true)",[uid]);return fn(c);});
const chat=(uid:string,title:string,aiChat=false,clientRequestId:string=randomUUID(),tenant=N)=>createTenantChat(api,resolvedContext(uid,tenant),{title,aiChat,clientRequestId},()=>`chat-${randomUUID().slice(0,13)}`);
const roomOf=(r:Awaited<ReturnType<typeof chat>>)=>{if("found" in r)throw Error("expected a room");return r;};

test.before(async()=>{
 cluster=await startLocalCluster();
 cluster.createDatabase("teamchat");
 const migrated=node("scripts/db/migrate.ts",{MIGRATION_DATABASE_URL:cluster.url("teamchat_owner")});
 assert.match(migrated,/"applied":"008_tenant_chats"/);
 node("scripts/db/provision-runtime-role.ts",{MIGRATION_DATABASE_URL:cluster.url("teamchat_owner"),DB_RUNTIME_ROLE:"teamchat_api"});
 execFileSync(path.join(PG_BIN,"psql"),["-X","-q","-v","ON_ERROR_STOP=1","-h","127.0.0.1","-p",String(cluster.port),"-U","teamchat_owner","-d","teamchat","-f",path.join(ROOT,"db/generated/seed.sql")],
  {env:{...process.env,PGPASSWORD:cluster.ownerPassword},stdio:"ignore"});
 owner=await createPgPool(cluster.url("teamchat_owner"));
 api=await createPgPool(cluster.url("teamchat_api"));
 await addUser(N,"u-maya","Maya Chen",true,["assortment-review"]);
 await addUser(N,"u-sam","Sam Ortiz",true,["assortment-review"]);
 await addUser(N,"u-ivy","Ivy Inactive",false,[]);
 await addUser(V,"u-val","Val Valley",true,["assortment-review"]);
});
test.after(async()=>{await owner?.end();await api?.end();cluster?.stop();});

test("the runtime role is restricted and the schema owner is not a superuser",async()=>{
 await assertRuntimeDbRole(api);
 const c=await api.connect();
 try{const r=await c.query<{s:boolean;b:boolean}>("SELECT rolsuper AS s,rolbypassrls AS b FROM pg_roles WHERE rolname='teamchat_owner'");assert.deepEqual(r.rows[0],{s:false,b:false});}
 finally{c.release();}
});

test("the migration runner records hashes, is a no-op when current and refuses a changed file",async()=>{
 const again=JSON.parse(node("scripts/db/migrate.ts",{MIGRATION_DATABASE_URL:cluster.url("teamchat_owner")}).trim().split("\n")[0]!);
 assert.deepEqual(again.pending,[]);
 assert.equal(again.applied.length,8);
 const c=await owner.connect();
 try{
  await c.query("UPDATE teamchat.schema_migrations SET sha256=repeat('0',64) WHERE version='008_tenant_chats'");
  assert.throws(()=>node("scripts/db/migrate.ts",{MIGRATION_DATABASE_URL:cluster.url("teamchat_owner")}),/008_tenant_chats changed after it was applied/);
  await c.query("UPDATE teamchat.schema_migrations SET sha256=$1 WHERE version='008_tenant_chats'",[(await import("node:crypto")).createHash("sha256").update((await import("node:fs")).readFileSync(path.join(ROOT,"db/migrations/008_tenant_chats.sql"))).digest("hex")]);
 }finally{c.release();}
 assert.throws(()=>node("scripts/db/migrate.ts",{MIGRATION_DATABASE_URL:cluster.url("teamchat_api")}),/runtime role/);
});

test("a database migrated by hand before tracking is baselined, then only 008 is applied",async()=>{
 cluster.createDatabase("legacy");
 for(const f of ["001_schema","002_notifications","003_auth_grants","004_ai_consent","005_job_lookup","006_ephemeral","007_semantic_memory"])
  execFileSync(path.join(PG_BIN,"psql"),["-X","-q","-v","ON_ERROR_STOP=1","-h","127.0.0.1","-p",String(cluster.port),"-U","teamchat_owner","-d","legacy","-f",path.join(ROOT,`db/migrations/${f}.sql`)],{env:{...process.env,PGPASSWORD:cluster.ownerPassword},stdio:"ignore"});
 const out=node("scripts/db/migrate.ts",{MIGRATION_DATABASE_URL:cluster.url("teamchat_owner","legacy")}).trim().split("\n");
 const plan=JSON.parse(out[0]!);
 assert.equal(plan.baseline.length,7);assert.deepEqual(plan.pending,["008_tenant_chats"]);
 const recorded=cluster.superuser("SELECT count(*) FROM teamchat.schema_migrations","legacy");
 assert.equal(recorded,"8");
});

test("POST-equivalent: a tenant chat enrols every ACTIVE member of the creator's tenant, and nobody else",async()=>{
 const r=roomOf(await chat("u-maya","Spring planning",true));
 assert.equal(r.created,true);assert.equal(r.room.visibility,"tenant");assert.equal(r.room.ai_chat,true);
 assert.deepEqual(await members(N,r.room.room_id),["u-maya","u-sam"]);
 const dir=await listRoomDirectory(api,resolvedContext("u-sam",N));
 assert.ok(!("found" in dir)&&dir.rooms.some(x=>x.room_id===r.room.room_id));
 assert.ok(!("found" in dir)&&dir.members.every(m=>m.firebase_uid!=="u-val"&&m.firebase_uid!=="u-ivy"));
 const valley=await listRoomDirectory(api,resolvedContext("u-val",V));
 assert.ok(!("found" in valley)&&!valley.rooms.some(x=>x.room_id===r.room.room_id));
 assert.deepEqual(await replayRoom(api,resolvedContext("u-val",V),r.room.room_id,0),NO_MATCH);
});

test("creation is idempotent per client request and rejects a conflicting duplicate",async()=>{
 const id=randomUUID();
 const a=roomOf(await chat("u-maya","Weekly sync",false,id));
 const b=roomOf(await chat("u-maya","Weekly sync",false,id));
 assert.equal(a.created,true);assert.equal(b.created,false);assert.equal(b.room.room_id,a.room.room_id);
 await assert.rejects(chat("u-maya","Different title",false,id),(e:unknown)=>e instanceof RoomCreationError&&e.status===409);
 // The same request ID from another user is a different request.
 const other=roomOf(await chat("u-sam","Weekly sync",false,id));
 assert.notEqual(other.room.room_id,a.room.room_id);
 // Concurrent duplicates still produce exactly one room.
 const id2=randomUUID();
 const both=await Promise.all([chat("u-maya","Race",false,id2),chat("u-maya","Race",false,id2)]);
 const rooms=both.map(roomOf);
 assert.equal(rooms[0]!.room.room_id,rooms[1]!.room.room_id);
 assert.deepEqual(rooms.map(x=>x.created).sort(),[false,true]);
});

test("input validation and inactive creators",async()=>{
 for(const bad of [{title:"",aiChat:false,clientRequestId:randomUUID()},{title:"x".repeat(81),aiChat:false,clientRequestId:randomUUID()},
  {title:"ok",aiChat:"yes",clientRequestId:randomUUID()},{title:"ok",aiChat:false,clientRequestId:"not-a-uuid"},{title:"ok",aiChat:false,clientRequestId:randomUUID(),room_id:"chosen"},{title:"a\u0007b",aiChat:false,clientRequestId:randomUUID()}])
  await assert.rejects(createTenantChat(api,resolvedContext("u-maya",N),bad,()=>"chat-x"),(e:unknown)=>e instanceof RoomCreationError&&e.status===400,JSON.stringify(bad));
 assert.deepEqual(await chat("u-ivy","Sneaky"),NO_MATCH);
});

test("PostgreSQL itself (as teamchat_api) refuses membership writes outside the server path",async t=>{
 const existing=roomOf(await chat("u-maya","Existing chat")).room.room_id;
 const attempts:Array<[string,(c:SqlClient)=>Promise<unknown>,string?]>=[
  ["add self to an existing legacy room",c=>c.query("INSERT INTO teamchat.room_memberships(tenant_id,room_id,firebase_uid) VALUES($1,'category-strategy','u-maya')",[N])],
  ["add another member to an existing legacy room",c=>c.query("INSERT INTO teamchat.room_memberships(tenant_id,room_id,firebase_uid) VALUES($1,'category-strategy','u-sam')",[N])],
  ["add a member to a tenant chat created in an earlier transaction",c=>c.query("INSERT INTO teamchat.room_memberships(tenant_id,room_id,firebase_uid) VALUES($1,$2,'u-ivy')",[N,existing])],
  ["add a user from another tenant",c=>c.query("INSERT INTO teamchat.room_memberships(tenant_id,room_id,firebase_uid) VALUES($1,$2,'u-val')",[N,existing])],
  ["write a membership row for another tenant",c=>c.query("INSERT INTO teamchat.room_memberships(tenant_id,room_id,firebase_uid) VALUES($1,'assortment-review','u-maya')",[V])],
  ["create a members-only (invite) room",c=>c.query("INSERT INTO teamchat.rooms(tenant_id,room_id,title,visibility,created_by,client_request_id,created_at) VALUES($1,'x-members','x','members','u-maya',gen_random_uuid(),now())",[N])],
  ["create a room in someone else's name",c=>c.query("INSERT INTO teamchat.rooms(tenant_id,room_id,title,visibility,created_by,client_request_id,created_at) VALUES($1,'x-forged','x','tenant','u-sam',gen_random_uuid(),now())",[N])],
  ["back-date a room",c=>c.query("INSERT INTO teamchat.rooms(tenant_id,room_id,title,visibility,created_by,client_request_id,created_at) VALUES($1,'x-old','x','tenant','u-maya',gen_random_uuid(),now()-interval '1 day')",[N])],
  ["create a room in another tenant",c=>c.query("INSERT INTO teamchat.rooms(tenant_id,room_id,title,visibility,created_by,client_request_id,created_at) VALUES($1,'x-foreign','x','tenant','u-maya',gen_random_uuid(),now())",[V])],
  ["re-date an existing room to reopen enrolment",c=>c.query("UPDATE teamchat.rooms SET created_at=now() WHERE tenant_id=$1 AND room_id=$2",[N,existing])],
  ["turn a legacy room into a tenant chat",c=>c.query("UPDATE teamchat.rooms SET visibility='tenant',created_by='u-maya' WHERE tenant_id=$1 AND room_id='category-strategy'",[N])],
  ["rewrite a membership",c=>c.query("UPDATE teamchat.room_memberships SET firebase_uid='u-maya' WHERE tenant_id=$1",[N])],
  ["delete a membership",c=>c.query("DELETE FROM teamchat.room_memberships WHERE tenant_id=$1",[N])],
  ["reactivate a user directly",c=>c.query("UPDATE teamchat.user_memberships SET active=true WHERE tenant_id=$1 AND firebase_uid='u-ivy'",[N])],
 ];
 for(const [label,fn] of attempts){
  const error=await asRuntime("u-maya",fn).then(()=>null,(e:unknown)=>e instanceof Error?e.message:String(e));
  assert.match(String(error),DENIED,label);
  t.diagnostic(`${label}: ${error}`);
 }
 // In the same transaction as a valid tenant chat, only ACTIVE members of the tenant may be added.
 await assert.rejects(asRuntime("u-maya",async c=>{
  await c.query("INSERT INTO teamchat.rooms(tenant_id,room_id,title,visibility,created_by,client_request_id,created_at) VALUES($1,'x-ok','x','tenant','u-maya',gen_random_uuid(),now())",[N]);
  await c.query("INSERT INTO teamchat.room_memberships(tenant_id,room_id,firebase_uid) VALUES($1,'x-ok','u-ivy')",[N]);
 }),DENIED,"inactive member into a new chat");
 // Without app.uid the runtime cannot create a room at all.
 await assert.rejects(inTenantTransaction(api,resolvedContext("u-maya",N),c=>c.query("INSERT INTO teamchat.rooms(tenant_id,room_id,title,visibility,created_by,client_request_id,created_at) VALUES($1,'x-nouid','x','tenant','u-maya',gen_random_uuid(),now())",[N])),DENIED);
 // Inactive creator, even with app.uid set to themselves.
 await assert.rejects(asRuntime("u-ivy",c=>c.query("INSERT INTO teamchat.rooms(tenant_id,room_id,title,visibility,created_by,client_request_id,created_at) VALUES($1,'x-ivy','x','tenant','u-ivy',gen_random_uuid(),now())",[N])),DENIED);
 assert.deepEqual(await members(N,"category-strategy"),[]);
});

test("members added or reactivated later join tenant chats (not legacy rooms), repeatably",async()=>{
 const r=roomOf(await chat("u-maya","Everyone")).room.room_id;
 assert.equal((await members(N,r)).includes("u-ivy"),false);
 await setActive(N,"u-ivy",true);
 assert.ok((await members(N,r)).includes("u-ivy"));
 assert.equal((await members(N,"category-strategy")).includes("u-ivy"),false);
 await setActive(N,"u-ivy",false);await setActive(N,"u-ivy",true);
 assert.ok((await members(N,r)).includes("u-ivy"));
 await addUser(N,"u-new","New Hire");
 assert.ok((await members(N,r)).includes("u-new"));
 assert.equal((await members(V,"assortment-review")).includes("u-new"),false);
 await setActive(N,"u-ivy",false);
 // Deactivation keeps the row but every read path rechecks active membership.
 assert.deepEqual(await replayRoom(api,resolvedContext("u-ivy",N),r,0),NO_MATCH);
});

test("concurrent creation and enrolment cannot miss a member, in either order",async()=>{
 const ownerRaw=new pg.Client({connectionString:cluster.url("teamchat_owner")});
 const apiRaw=new pg.Client({connectionString:cluster.url("teamchat_api")});
 await ownerRaw.connect();await apiRaw.connect();
 try{
  // Order 1: the chat is being created (lock held) when a member is added.
  await apiRaw.query("BEGIN");
  await apiRaw.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.uid','u-maya',true)",[N]);
  await apiRaw.query("SELECT pg_advisory_xact_lock(teamchat.tenant_rooms_lock_key($1))",[N]);
  await apiRaw.query("INSERT INTO teamchat.rooms(tenant_id,room_id,title,ai_chat,visibility,created_by,client_request_id,created_at) VALUES($1,'race-1','Race 1',false,'tenant','u-maya',gen_random_uuid(),now())",[N]);
  await apiRaw.query("INSERT INTO teamchat.room_memberships(tenant_id,room_id,firebase_uid) SELECT tenant_id,'race-1',firebase_uid FROM teamchat.user_memberships WHERE tenant_id=$1 AND active",[N]);
  await ownerRaw.query("BEGIN");
  await ownerRaw.query("SELECT set_config('app.tenant_id',$1,true)",[N]);
  const adding=ownerRaw.query("INSERT INTO teamchat.user_memberships(tenant_id,firebase_uid,display_name) VALUES($1,'u-race1','Race One')",[N]);
  await new Promise(r=>setTimeout(r,300));
  await apiRaw.query("COMMIT");
  await adding;await ownerRaw.query("COMMIT");
  assert.ok((await members(N,"race-1")).includes("u-race1"),"member added during creation joins");
  // Order 2: a member is being added (lock held) when a chat is created.
  await ownerRaw.query("BEGIN");
  await ownerRaw.query("SELECT set_config('app.tenant_id',$1,true)",[N]);
  await ownerRaw.query("INSERT INTO teamchat.user_memberships(tenant_id,firebase_uid,display_name) VALUES($1,'u-race2','Race Two')",[N]);
  const creating=chat("u-maya","Race 2");
  await new Promise(r=>setTimeout(r,300));
  await ownerRaw.query("COMMIT");
  const created=roomOf(await creating).room.room_id;
  assert.ok((await members(N,created)).includes("u-race2"),"member committed while creation waited joins");
 }finally{await ownerRaw.end();await apiRaw.end();}
});

test("room-list changes are announced on teamchat_rooms with only the tenant ID",async()=>{
 const listener=new pg.Client({connectionString:cluster.url("teamchat_api")});await listener.connect();
 try{
  const got=new Promise<string>(resolve=>listener.on("notification",(m:{channel:string;payload?:string})=>{if(m.channel==="teamchat_rooms")resolve(m.payload??"");}));
  await listener.query("LISTEN teamchat_rooms");
  await chat("u-maya","Announce");
  assert.deepEqual(JSON.parse(await got),{tenant:N});
 }finally{await listener.end();}
});

test("an AI chat creates exactly one AI job per message, with or without @AI",async()=>{
 const room=roomOf(await chat("u-maya","Ask the assistant",true)).room.room_id;
 const ctx=resolvedContext("u-maya",N);
 const send=(body:string,r=room)=>sendDurableMessage(api,ctx,{roomId:r,clientMessageId:randomUUID(),body});
 const plain=await send("hello");const mention=await send("@AI hello");const legacy=await send("hello","assortment-review");
 assert.ok(!("found" in plain)&&plain.aiTurnId);assert.ok(!("found" in mention)&&mention.aiTurnId);
 assert.ok(!("found" in legacy)&&!legacy.aiTurnId);
 const jobs=await asOwner(N,c=>c.query<{n:string}>("SELECT count(*)::text AS n FROM teamchat.ai_jobs WHERE tenant_id=$1 AND room_id=$2",[N,room])) as {rows:{n:string}[]};
 assert.equal(jobs.rows[0]!.n,"2");
});

// ---------- AI worker with a scripted model ----------
interface Script {rounds:Array<RoundResult|Error>;compose?:()=>AsyncIterable<string>;reviews?:string[]}
function scripted(s:Script){
 const seen:{rounds:Array<Array<Record<string,unknown>>>;composed:number;reviews:Array<Array<Record<string,unknown>>>}={rounds:[],composed:0,reviews:[]};
 const provider:GeminiProvider={
  async round(contents){seen.rounds.push(structuredClone(contents));const next=s.rounds.shift();if(!next)throw Error("unexpected round");if(next instanceof Error)throw next;return next;},
  compose(){seen.composed++;if(!s.compose)throw Error("unexpected compose");return s.compose();},
  ...(s.reviews?{async review(contents:Array<Record<string,unknown>>){seen.reviews.push(structuredClone(contents));const next=s.reviews!.shift();if(next===undefined)throw Error("unexpected review");return next;}}:{}),
 };
 return {provider,seen};
}
const reply=(text:string):RoundResult=>({text,functionCalls:[],content:{role:"model",parts:[{text}]}});
const call=(name:string,args:Record<string,unknown>):RoundResult=>({text:"",functionCalls:[{id:`c-${name}`,name,args}],content:{role:"model",parts:[{functionCall:{id:`c-${name}`,name,args}}]}});
const embeddings={modelId:"test-embedding",embed:async()=>Array.from({length:768},(_,i)=>i===0?1:0)};
async function turn(body:string,earlier?:{uid:string;body:string}){
 const room=roomOf(await chat("u-maya",`AI ${randomUUID().slice(0,6)}`,true)).room.room_id;
 const ctx=resolvedContext("u-maya",N);
 if(earlier)await sendDurableMessage(api,resolvedContext(earlier.uid,N),{roomId:room,clientMessageId:randomUUID(),body:earlier.body});
 const sent=await sendDurableMessage(api,ctx,{roomId:room,clientMessageId:randomUUID(),body});
 if("found" in sent||!sent.aiTurnId)throw Error("no AI turn");
 const events=async()=>((await replayRoom(api,ctx,room,0,500)) as PersistedEvent[]).filter(e=>e.turn_id===sent.aiTurnId);
 return {room,turnId:sent.aiTurnId,events};
}
const shownText=(events:PersistedEvent[])=>events.filter(e=>e.type==="ai_answer_segment").map(e=>String(e.payload.rendered));

test("small talk is answered directly by Gemini's own words, in one call, without tools",async()=>{
 const t=await turn("hi");
 const {provider,seen}=scripted({rounds:[reply("Hi Maya! I'm doing well, thanks for asking. How can I help you today?")]});
 const r=await executeAiJob(api,provider,t.turnId,embeddings);
 assert.equal(r.status,"completed");
 const ev=await t.events();
 assert.deepEqual(ev.map(e=>e.type),["ai_turn_started","ai_answer_segment","ai_complete"]);
 assert.deepEqual(shownText(ev),["Hi Maya! I'm doing well, thanks for asking. How can I help you today?"]);
 assert.equal(seen.rounds.length,1);assert.equal(seen.composed,0);
 assert.equal(JSON.stringify(seen.rounds[0]).includes("u-maya"),false,"no raw UID reaches the model");
 assert.match(JSON.stringify(seen.rounds[0]),/from Maya Chen/);
 const again=await executeAiJob(api,provider,t.turnId,embeddings);
 assert.equal(again.status,"completed");assert.equal((await t.events()).length,ev.length);
});

test("an ungrounded workspace claim is never shown: the model is sent back to its tools, and forged facts are dropped",async()=>{
 const t=await turn("what does the outlet need?");
 const {provider,seen}=scripted({
  rounds:[reply("That store sells 500 tents a week and is missing hiking boots."),call("get_store_assortment",{store_id:northStore.store_id}),reply("Here is what I found.")],
  compose:async function*(){
   yield `[{"kind":"say","text":"Here is what I found:"},{"kind":"fact","predicate":"store_summary","ref":"S1"},`;
   yield `{"kind":"fact","predicate":"score_change","ref":"S1","text":"up 40%"},{"kind":"say","text":"It sells 500 units a week."},{"kind":"fact","predicate":"product_info","ref":"S7"}]`;
  }});
 const r=await executeAiJob(api,provider,t.turnId,embeddings);
 assert.equal(r.status,"completed");
 assert.equal(seen.rounds.length,3,"the reply after the tool round ends the turn; nothing asks the model to continue");
 assert.ok(JSON.stringify(seen.rounds[1]).includes(ESCALATION_NOTE));
 const ev=await t.events();const shown=shownText(ev);
 assert.equal(shown[0],"Here is what I found:");
 assert.match(shown[1]!,new RegExp(`^${northStore.store_id} \\(`));
 assert.equal(shown.at(-1),"I left out part of my reply because I couldn't confirm it against this workspace's records.");
 const all=shown.join("\n");
 for(const forged of ["500","40%","missing hiking boots"])assert.equal(all.includes(forged),false,forged);
 assert.equal(ev.filter(e=>e.type==="ai_answer_block").length,1,"the tool result is kept as a source block");
});

test("a turn that stops after its first tool round is reviewed against the requester's own message and completed",async()=>{
 const gaps=northStore.suspected_gaps.map(g=>g.catalog_code);
 const t=await turn("@AI which gaps does the store have, and what is the score change from adding them?",{uid:"u-sam",body:"@AI which SSD codes do we stock?"});
 const {provider,seen}=scripted({
  rounds:[call("get_store_assortment",{store_id:northStore.store_id}),reply("Here are the gaps. I will now calculate the score change."),
   call("calculate_uplift",{store_id:northStore.store_id,add_codes:gaps}),reply("Here are the gaps and the score change.")],
  reviews:['{"missing":"the score change from adding the gap codes"}'],
  compose:async function*(){yield `[{"kind":"fact","predicate":"store_gap","ref":"S1"},{"kind":"fact","predicate":"score_change","ref":"S2"}]`;}});
 assert.equal((await executeAiJob(api,provider,t.turnId,embeddings)).status,"completed");
 assert.equal(seen.reviews.length,1,"one review, after the first no-call reply");
 const reviewed=JSON.stringify(seen.reviews[0]);
 assert.match(reviewed,/score change from adding them/);
 assert.match(reviewed,/get_store_assortment/);
 assert.equal(reviewed.includes("SSD"),false,"the review never sees a colleague's message");
 assert.equal(seen.rounds.length,4);
 assert.match(JSON.stringify(seen.rounds[2]),/Missing part of that request: \\"the score change from adding the gap codes\\"/);
 const tools=(await t.events()).filter(e=>e.type==="ai_tool").map(e=>e.payload.name);
 assert.deepEqual(tools,["get_store_assortment","calculate_uplift"]);
 assert.match(shownText(await t.events()).join("\n"),/score/i);
});

test("a complete turn passes the review and ends as before: no note, no extra round",async()=>{
 const t=await turn("@AI tell me about the store");
 const {provider,seen}=scripted({rounds:[call("get_store_assortment",{store_id:northStore.store_id}),reply("Here it is.")],
  reviews:['{"missing":""}'],
  compose:async function*(){yield `[{"kind":"fact","predicate":"store_summary","ref":"S1"}]`;}});
 assert.equal((await executeAiJob(api,provider,t.turnId,embeddings)).status,"completed");
 assert.equal(seen.reviews.length,1);assert.equal(seen.rounds.length,2);
 assert.equal(JSON.stringify(seen.rounds).includes("Server note (trusted): Maya"),false);
});

test("a bad tool argument goes back to Gemini as a tool error; the turn is neither retried nor failed",async()=>{
 const t=await turn("which are your tools?");
 const {provider}=scripted({rounds:[call("search_catalog",{query:""}),reply("I can help with products, stores and decisions.")],
  compose:async function*(){yield `[{"kind":"fact","predicate":"assistant_capabilities"}]`;}});
 const r=await executeAiJob(api,provider,t.turnId,embeddings);
 assert.equal(r.status,"completed");
 const ev=await t.events();
 const tool=ev.find(e=>e.type==="ai_tool");
 assert.match(String((tool?.payload.result as {error?:string})?.error),/^Invalid query/);
 assert.equal(ev.some(e=>e.type==="ai_failed"),false);
 assert.match(shownText(ev)[0]!,/^I can: search the product catalog/);
 const job=await asOwner(N,c=>c.query<{attempts:number;state:string}>("SELECT attempts,state FROM teamchat.ai_jobs WHERE tenant_id=$1 AND turn_id=$2::uuid",[N,t.turnId])) as {rows:{attempts:number;state:string}[]};
 assert.deepEqual(job.rows[0],{attempts:1,state:"completed"});
});

test("a reply stream cut off mid-element shows only complete, valid segments, then the server's own rendering",async()=>{
 const t=await turn("tell me about the store");
 const {provider}=scripted({rounds:[call("get_store_assortment",{store_id:northStore.store_id}),reply("Sure.")],
  compose:async function*(){yield `[{"kind":"say","text":"Sure, here it is:"},{"kind":"fact","predicate":"store_su`;throw Error("socket hang up");}});
 assert.equal((await executeAiJob(api,provider,t.turnId,embeddings)).status,"completed");
 const shown=shownText(await t.events());
 assert.equal(shown[0],"Sure, here it is:");
 assert.match(shown[1]!,new RegExp(`^${northStore.store_id} \\(`));
 assert.match(shown[2]!,/suspected gap|no documented suspected gaps/i);
});

test("Gemini outages retry the turn later; other errors fail it once, visibly, without a retry storm",async()=>{
 const t=await turn("hello there");
 const first=scripted({rounds:[new GeminiUnavailableError()]});
 await assert.rejects(executeAiJob(api,first.provider,t.turnId,embeddings),GeminiUnavailableError);
 const second=scripted({rounds:[reply("Hello Maya! How can I help?")]});
 assert.equal((await executeAiJob(api,second.provider,t.turnId,embeddings)).status,"completed");
 const ev=await t.events();
 assert.equal(ev.filter(e=>e.type==="ai_turn_started").length,2);
 assert.deepEqual(shownText(ev),["Hello Maya! How can I help?"]);

 const u=await turn("hello again");
 const broken=scripted({rounds:[new Error("model returned garbage")]});
 assert.deepEqual(await executeAiJob(api,broken.provider,u.turnId,embeddings),{status:"failed"});
 const failed=(await u.events()).find(e=>e.type==="ai_failed");
 assert.equal(failed?.payload.reason,"AI processing failed");
});

test("memory search puts a decision naming the asked-for identifier ahead of closer look-alikes",async()=>{
 const {SqlToolExecutor}=await import("../../src/server/sql-tools.ts");
 const {SourceLedger}=await import("../../src/grounding.ts");
 const vector=(second:number)=>`[${Array.from({length:768},(_,i)=>i===0?1:i===1?second:0).join(",")}]`;
 await asOwner(N,async c=>{
  for(let i=0;i<6;i++)await c.query("INSERT INTO teamchat.memories(tenant_id,memory_id,key,value,created_by,created_at,source_room_id,embedding,embedding_model) VALUES($1,$2,$3,$4::jsonb,'u-maya',now(),'assortment-review',$5::vector,'test-embedding')",
   [N,`look-alike-${i}`,`escalation_contact_case-a${i}q7`,JSON.stringify({case:`case-a${i}q7`,contact:"Dana"}),vector(0)]);
  await c.query("INSERT INTO teamchat.memories(tenant_id,memory_id,key,value,created_by,created_at,source_room_id,embedding,embedding_model) VALUES($1,'asked-for','escalation_contact_case-x9k2',$2::jsonb,'u-maya',now(),'assortment-review',$3::vector,'test-embedding')",
   [N,JSON.stringify({case:"case-x9k2",contact:"Dana Ruiz"}),vector(0.3)]);
 });
 const ctx=resolvedContext("u-sam",N),search=(query:string)=>new SqlToolExecutor(api,embeddings).execute(ctx,"assortment-review","search_memory",{query},new SourceLedger(ctx,randomUUID())) as Promise<Array<{memory:{memory_id:string}}>>;
 const exact=await search("Who is the escalation contact for the CASE-X9K2 supplier dispute?");
 assert.equal(exact[0]?.memory.memory_id,"asked-for");
 assert.ok(exact.length<=5);
 const vague=await search("Who is the escalation contact for the supplier dispute?");
 assert.ok(!vague.some(m=>m.memory.memory_id==="asked-for"),"without an identifier, plain semantic distance still decides");
});

test("a stale worker cannot write after its turn was reclaimed",async()=>{
 const {persistSegment,claimJob}=await import("../../src/server/ai-jobs.ts");
 const t=await turn("anyone there?");
 const ctx=resolvedContext("u-maya",N);
 const claim=await claimJob(api,ctx,t.turnId,"worker-a");assert.ok(claim);
 await asOwner(N,c=>c.query("UPDATE teamchat.ai_jobs SET lease_expires_at=now()-interval '1 second' WHERE tenant_id=$1 AND turn_id=$2::uuid",[N,t.turnId]));
 const reclaimed=await claimJob(api,ctx,t.turnId,"worker-b");assert.ok(reclaimed&&reclaimed.fence>claim!.fence);
 await assert.rejects(persistSegment(api,ctx,t.room,t.turnId,claim!.fence,0,{kind:"say",rendered:"stale",refs:[],sources:[]}),/lease lost/);
 assert.equal(shownText(await t.events()).length,0);
});
