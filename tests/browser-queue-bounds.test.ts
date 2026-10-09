import test from "node:test";
import assert from "node:assert/strict";
import {TeamSocket} from "../apps/web/src/socket.ts";
const newClient=()=>new TeamSocket("wss://example.invalid/ws",()=>{},()=>{},()=>{});
test("outbound queue rejects invalid or oversized messages before storing",()=>{
 const client=newClient();
 assert.throws(()=>client.sendMessage("assortment-review",""),/Message must contain/);
 assert.throws(()=>client.sendMessage("assortment-review","x".repeat(8001)),/Message must contain/);
 assert.throws(()=>client.sendMessage("../../other","valid"),/Message must contain/);
 assert.equal((client as any).outbound.size,0);
});
test("offline pending sends are bounded to 100 rather than retaining unlimited messages",()=>{
 const client=newClient();
 for(let i=0;i<100;i++)client.sendMessage("assortment-review",`message ${i}`);
 assert.equal((client as any).outbound.size,100);
 assert.throws(()=>client.sendMessage("assortment-review","message 101"),/queue is full/);
 assert.equal((client as any).outbound.size,100);
 client.close();assert.equal((client as any).outbound.size,0);
});
