import test from "node:test";
import assert from "node:assert/strict";
import {TeamSocket} from "../apps/web/src/socket.ts";

class FakeSocket {
 static OPEN=1;
 static CONNECTING=0;
 static instances:FakeSocket[]=[];
 readyState=0;
 sent:Record<string,unknown>[]=[];
 listeners=new Map<string,Array<(data:any)=>void>>();
 url:string;
 constructor(url:string){this.url=url;FakeSocket.instances.push(this);}
 addEventListener(type:string,fn:(data:any)=>void){const list=this.listeners.get(type)??[];list.push(fn);this.listeners.set(type,list);}
 emit(type:string,data:any={}){for(const fn of this.listeners.get(type)??[])fn(data);}
 send(data:string){this.sent.push(JSON.parse(data));}
 close(){this.readyState=3;this.emit("close");}
 open(){this.readyState=1;this.emit("open");}
 frame(frame:Record<string,unknown>){this.emit("message",{data:JSON.stringify(frame)});}
}

test("browser does not send room commands before Firebase authentication succeeds",async()=>{
 const original=(globalThis as any).WebSocket;
 const originalStorage=(globalThis as any).sessionStorage;
 const saved=new Map<string,string>();
 (globalThis as any).WebSocket=FakeSocket;
 (globalThis as any).sessionStorage={getItem:(key:string)=>saved.get(key)??null,setItem:(key:string,value:string)=>saved.set(key,value),removeItem:(key:string)=>saved.delete(key)};
 try{
  FakeSocket.instances=[];
  const events:any[]=[];
  const socket=new TeamSocket("wss://test.invalid/ws",ev=>events.push(ev),()=>{},()=>{},"user-1");
  socket.connect(async()=>"signed-token");
  socket.subscribe("assortment-review");
  socket.sendMessage("assortment-review","first message");
  const fake=FakeSocket.instances[0]!;
  fake.open();await Promise.resolve();await Promise.resolve();
  assert.deepEqual(fake.sent.map(m=>m.type),["auth"]);
  fake.frame({v:1,type:"auth_ok"});
  assert.deepEqual(fake.sent.map(m=>m.type),["auth","subscribe","send_message"]);
  fake.frame({v:1,type:"event",event:{eventId:"ev1",tenantId:"northside-outfitters",roomId:"assortment-review",sequence:1,type:"message",payload:{body:"first message"}}});
  assert.equal(events.length,1);
  socket.close(true);
  assert.equal(saved.size,0);
 }finally{(globalThis as any).WebSocket=original;(globalThis as any).sessionStorage=originalStorage;}
});

test("switching rooms unsubscribes the old room and replays only active subscriptions on reconnect",async()=>{
 const original=(globalThis as any).WebSocket;
 const originalStorage=(globalThis as any).sessionStorage;
 (globalThis as any).WebSocket=FakeSocket;
 (globalThis as any).sessionStorage={getItem:()=>null,setItem(){},removeItem(){}};
 try{
  FakeSocket.instances=[];
  const socket=new TeamSocket("wss://test.invalid/ws",()=>{},()=>{},()=>{},"user-2");
  socket.connect("verified-token");socket.subscribe("assortment-review");
  const first=FakeSocket.instances.at(-1)!;first.open();first.frame({type:"auth_ok"});
  socket.unsubscribe("assortment-review");socket.subscribe("category-strategy");
  assert.deepEqual(first.sent.map(x=>x.type),["auth","subscribe","unsubscribe","subscribe"]);
  first.close();
  // Reconnect immediately using the private open method to avoid time waits.
  (socket as any).open(true);
  const next=FakeSocket.instances.at(-1)!;next.open();next.frame({type:"auth_ok"});
  assert.deepEqual(next.sent.filter(x=>x.type==="subscribe").map(x=>x.roomId),["category-strategy"]);
  socket.close(true);
 }finally{(globalThis as any).WebSocket=original;(globalThis as any).sessionStorage=originalStorage;}
});

test("late frames from a logged-out or replaced socket cannot restore session state",async()=>{
 const orig=(globalThis as any).WebSocket;
 const origStorage=(globalThis as any).sessionStorage;
 (globalThis as any).WebSocket=FakeSocket;
 (globalThis as any).sessionStorage={getItem:()=>null,setItem(){},removeItem(){}};
 try{
  FakeSocket.instances=[];
  const seen:unknown[]=[];const states:string[]=[];
  const socket=new TeamSocket("wss://test.invalid/ws",event=>seen.push(event),s=>states.push(s),()=>{},"member-a");
  socket.connect("token");socket.subscribe("assortment-review");
  const first=FakeSocket.instances.at(-1)!;first.open();
  socket.close(true);
  first.frame({type:"auth_ok"});
  first.frame({type:"event",event:{eventId:"late",roomId:"assortment-review",sequence:1,payload:{secret:"old"}}});
  assert.equal(seen.length,0);
  assert.equal(states.at(-1),"offline");
 }finally{(globalThis as any).WebSocket=orig;(globalThis as any).sessionStorage=origStorage;}
});
