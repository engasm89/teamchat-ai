import test from "node:test";
import assert from "node:assert/strict";
import {invokeTaskWithClient} from "../src/server/task-dispatch.ts";

test("Cloud Tasks client closes after a successful dispatch",async()=>{
 let closes=0,calls=0;
 const result=await invokeTaskWithClient(async()=>({
  async createTask(_request){calls++;return {name:"task"};},
  async close(){closes++;}
 }),{name:"sample"});
 assert.deepEqual(result,{name:"task"});assert.equal(calls,1);assert.equal(closes,1);
});

test("Cloud Tasks client closes after an API rejection without altering the error",async()=>{
 let closes=0;const failure=Error("remote unavailable");
 await assert.rejects(invokeTaskWithClient(async()=>({
  async createTask(){throw failure;},async close(){closes++;}
 }),{}),e=>e===failure);
 assert.equal(closes,1);
});

test("client cleanup failures never turn a confirmed task creation into a retry",async()=>{
 const previous=console.error;let reports=0;
 console.error=()=>{reports++;};
 try{
  assert.deepEqual(await invokeTaskWithClient(async()=>({
   async createTask(){return {name:"already-created"};},async close(){throw Error("cleanup error");}
  }),{}),{name:"already-created"});
  assert.equal(reports,1);
 }finally{console.error=previous;}
});
