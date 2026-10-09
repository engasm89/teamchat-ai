import test from "node:test";
import assert from "node:assert/strict";
import {TeamSocket} from "../apps/web/src/socket.ts";

class FakeWS {
 static OPEN=1;static CONNECTING=0;static instances:FakeWS[]=[];
 readyState=0;
 listeners=new Map<string,Array<(p:any)=>void>>();
 sent:any[]=[];
 url:string;
 constructor(url:string){this.url=url;FakeWS.instances.push(this);}
 addEventListener(k:string,f:(p:any)=>void){this.listeners.set(k,[...(this.listeners.get(k)??[]),f]);}
 emit(k:string,p:any={}){for(const f of this.listeners.get(k)??[])f(p);}
 send(v:string){this.sent.push(JSON.parse(v));}
 open(){this.readyState=1;this.emit("open");}
 frame(p:any){this.emit("message",{data:JSON.stringify(p)});}
 close(){this.readyState=3;this.emit("close");}
}

test("ignore events for unsubscribed rooms and malformed replay envelopes",()=>{
 const prior=(globalThis as any).WebSocket;
 (globalThis as any).WebSocket=FakeWS;
 try{
  FakeWS.instances=[];const events:any[]=[];
  const client=new TeamSocket("wss://example.invalid/ws", e=>events.push(e),()=>{},()=>{});
  client.connect("valid-token");client.setExpectedTenant("northside-outfitters");client.subscribe("assortment-review");
  const ws=FakeWS.instances.at(-1)!;ws.open();ws.frame({v:1,type:"auth_ok"});
  const valid=(roomId:string,eventId:string)=>({v:1,type:"event",event:{eventId,roomId,tenantId:"northside-outfitters",sequence:1,type:"message",payload:{body:"test"}}});
  ws.frame(valid("category-strategy","foreign-room"));
  ws.frame({...valid("assortment-review","foreign-tenant"),event:{...valid("assortment-review","foreign-tenant").event,tenantId:"valley-home-goods"}});
  ws.frame({...valid("assortment-review",""),event:{...valid("assortment-review","").event,eventId:""}});
  ws.frame(valid("assortment-review","real"));
  assert.deepEqual(events.map(e=>e.eventId),["real"]);
  client.unsubscribe("assortment-review");
  ws.frame({...valid("assortment-review","late"),event:{...valid("assortment-review","late").event,sequence:2}});
  assert.equal(events.length,1);
  client.close();
 }finally{(globalThis as any).WebSocket=prior;}
});

test("closing a session clears pending sends from account storage by default",()=>{
 const original=(globalThis as any).sessionStorage;
 const store=new Map<string,string>();
 (globalThis as any).sessionStorage={setItem:(k:string,v:string)=>store.set(k,v),getItem:(k:string)=>store.get(k)??null,removeItem:(k:string)=>store.delete(k)};
 try{
  const client=new TeamSocket("wss://example.invalid/ws",()=>{},()=>{},()=>{},"uid-1");
  client.sendMessage("assortment-review","unsent private message");
  assert.equal(store.size,1);
  client.close();
  assert.equal(store.size,0);
  const next=new TeamSocket("wss://example.invalid/ws",()=>{},()=>{},()=>{},"uid-1");
  assert.equal((next as any).outbound.size,0);
  next.close();
 }finally{(globalThis as any).sessionStorage=original;}
});
