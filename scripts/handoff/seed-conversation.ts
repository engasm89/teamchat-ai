/** Seeds the reviewer room (assortment-review) of any tenant that lacks a three-person conversation
 * with a tool-backed AI exchange. Everything goes through the deployed WebSocket API as the real
 * users; nothing is written with SQL. Idempotent: tenants that already qualify are skipped.
 * Usage: node --experimental-strip-types scripts/handoff/seed-conversation.ts */
import fs from "node:fs";
import path from "node:path";
import {ACCOUNTS,bindDeployment,openDb,authoritativeEvents,firebaseSignIn,type AccountKey} from "../acceptance/common.ts";
import {LiveClient} from "../acceptance/live-client.ts";

const ROOM="assortment-review";
const SCRIPT:Record<string,Array<{account:AccountKey;body:string}>>={
 "northside-outfitters":[
  {account:"n1",body:"Before Thursday's range review, can we check what the catalog says about portable air conditioners?"},
  {account:"n2",body:"Agreed. I'd rather see the actual codes and margin classes than last season's spreadsheet."},
  {account:"n3",body:"@AI Which portable air conditioner codes are in the catalog, and what margin class does each carry?"}],
 "valley-home-goods":[
  {account:"v1",body:"Before Thursday's range review, can we check what the catalog says about portable air conditioners?"},
  {account:"v2",body:"Agreed. I'd rather see the actual codes and margin classes than last season's spreadsheet."},
  {account:"v3",body:"@AI Which portable air conditioner codes are in the catalog, and what margin class does each carry?"}]};

const {sourceSha,deployment}=bindDeployment();
const pool=await openDb();
const log:Record<string,unknown>={sourceSha,deployment,room:ROOM,startedAt:new Date().toISOString(),tenants:{}};
try{
 for(const [tenant,lines] of Object.entries(SCRIPT)){
  const accounts=(Object.keys(ACCOUNTS) as AccountKey[]).filter(k=>ACCOUNTS[k].tenant===tenant);
  const identities=await Promise.all(accounts.map(async k=>({account:k,...await firebaseSignIn(k)})));
  const db=await authoritativeEvents(pool,tenant,identities[0]!.uid,ROOM,0);
  const uids=new Set(identities.map(i=>i.uid));
  const authors=new Set(db.filter(e=>e.type==="message"&&uids.has(String(e.payload.author_uid))).map(e=>String(e.payload.author_uid)));
  const toolBacked=db.some(e=>e.type==="ai_tool"&&Array.isArray(e.payload.result)&&(e.payload.result as unknown[]).length>0&&
   db.some(x=>x.turn_id===e.turn_id&&x.type==="ai_complete"));
  if(authors.size>=3&&toolBacked){(log.tenants as Record<string,unknown>)[tenant]={skipped:"already has three human authors and a tool-backed AI exchange"};continue;}
  const sent:Array<Record<string,unknown>>=[];
  for(const line of lines){
   const who=identities.find(i=>i.account===line.account)!;
   const client=await new LiveClient(line.account).connect(who);
   try{
    await client.subscribe(ROOM);
    const ack=await client.post(ROOM,line.body);
    const record:Record<string,unknown>={account:line.account,uid:who.uid,body:line.body,sequence:ack.sequence};
    if(ack.turnId){
     const turn=await client.waitTurn(ROOM,ack.turnId);
     record.turn={turnId:ack.turnId,terminal:turn.terminal?.type,tools:turn.tools.map(t=>({name:t.name,arguments:t.arguments,resultCount:Array.isArray(t.result)?t.result.length:null}))};
     if(turn.terminal?.type!=="ai_complete"||!turn.tools.some(t=>Array.isArray(t.result)&&t.result.length>0))throw Error(`AI turn ${ack.turnId} did not complete with a fetched result`);
    }
    sent.push(record);
   }finally{client.close();}
  }
  (log.tenants as Record<string,unknown>)[tenant]={authorsBefore:authors.size,toolBackedBefore:toolBacked,sent};
 }
}finally{
 await pool.end();
 log.finishedAt=new Date().toISOString();
 const dir="qa_evidence/handoff";fs.mkdirSync(dir,{recursive:true});
 const file=path.join(dir,`seed-conversation-${String(log.startedAt).replace(/[-:]/g,"").replace(/\.\d+Z$/,"Z")}.json`);
 fs.writeFileSync(file,JSON.stringify(log,null,1)+"\n");console.log(`Seed log: ${file}`);
 console.log(JSON.stringify(log.tenants,null,1));
}
