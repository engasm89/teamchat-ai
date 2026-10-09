import test from "node:test";
import assert from "node:assert/strict";
import {dispatchJob,reserveDispatchAttempt} from "../src/server/task-dispatch.ts";
import {resolvedContext} from "../src/tenant.ts";
import type {SqlClient,SqlPool,QueryResult} from "../src/persistence/postgres.ts";

const context=resolvedContext("buyer-north","northside-outfitters");
const turnId="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const env={
 CLOUD_TASKS_QUEUE_PATH:"projects/test/locations/us-central1/queues/teamchat",
 CLOUD_TASKS_WORKER_URL:"https://worker.test",
 CLOUD_TASKS_AUDIENCE:"https://worker.test",
 CLOUD_TASKS_INVOKER_EMAIL:"worker@test.iam.gserviceaccount.com"
};
function mockPool(){
 let attempts=0,state="pending",available=true,marked=0;
 const client:SqlClient={release(){},async query<T>(sql:string,args?:unknown[]):Promise<QueryResult<T>>{
  if(sql.includes("UPDATE teamchat.task_outbox o")){
   if(!available||attempts>=12)return {rows:[],rowCount:0};
   attempts++;available=false;
   return {rows:[{dispatch_attempts:attempts}] as T[],rowCount:1};
  }
  if(sql.includes("SET state='dispatched'")){
   assert.equal(args?.[2],attempts);state="dispatched";marked++;
  }
  return {rows:[],rowCount:0};
 }};
 const pool:SqlPool={connect:async()=>client};
 return {pool,stats:()=>({attempts,state,marked}),ready(){available=true;}};
}

test("failed Cloud Tasks attempts are durable and exhaust the twelve-attempt budget",async()=>{
 const {pool,stats,ready}=mockPool();
 const prior={...process.env};Object.assign(process.env,env);
 try{
  for(let i=1;i<=12;i++){
   ready();
   await assert.rejects(dispatchJob(pool,context,turnId,async()=>{throw Error("Cloud Tasks unavailable");}),/Cloud Tasks unavailable/);
   assert.deepEqual(stats(),{attempts:i,state:"pending",marked:0});
  }
  ready();
  assert.equal(await dispatchJob(pool,context,turnId,async()=>{throw Error("should not run");}),false);
  assert.equal(stats().attempts,12);
 }finally{process.env=prior;}
});

test("competing dispatchers reserve only one remote attempt until retry window",async()=>{
 const {pool,stats,ready}=mockPool();const prior={...process.env};Object.assign(process.env,env);
 try{
  let calls=0;const sender=async()=>{calls++;return {ok:true};};
  const [first,second]=await Promise.all([dispatchJob(pool,context,turnId,sender),dispatchJob(pool,context,turnId,sender)]);
  assert.deepEqual([first,second],[true,false]);
  assert.equal(calls,1);assert.deepEqual(stats(),{attempts:1,state:"dispatched",marked:1});
  ready();assert.equal(await reserveDispatchAttempt(pool,context,turnId),2);
 }finally{process.env=prior;}
});

test("Cloud Tasks ALREADY_EXISTS is acknowledged but ambiguous failures are retried",async()=>{
 const {pool,stats}=mockPool();const prior={...process.env};Object.assign(process.env,env);
 try{
  assert.equal(await dispatchJob(pool,context,turnId,async()=>{throw {code:6};}),true);
  assert.deepEqual(stats(),{attempts:1,state:"dispatched",marked:1});
 }finally{process.env=prior;}
});
