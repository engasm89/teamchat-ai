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

test("a browser offline event disconnects, holds reconnects, and resumes from the cursor when online",async()=>{
 const original=(globalThis as any).WebSocket;
 const originalStorage=(globalThis as any).sessionStorage;
 const originalAdd=(globalThis as any).addEventListener,originalRemove=(globalThis as any).removeEventListener;
 const network=new EventTarget();
 (globalThis as any).WebSocket=FakeSocket;
 (globalThis as any).sessionStorage={getItem:()=>null,setItem(){},removeItem(){}};
 (globalThis as any).addEventListener=network.addEventListener.bind(network);
 (globalThis as any).removeEventListener=network.removeEventListener.bind(network);
 try{
  FakeSocket.instances=[];
  const states:string[]=[];const seen:string[]=[];
  const socket=new TeamSocket("wss://test.invalid/ws",ev=>seen.push(ev.eventId),s=>states.push(s),()=>{},"member-offline");
  socket.connect("token");socket.subscribe("assortment-review");
  const first=FakeSocket.instances.at(-1)!;first.open();first.frame({type:"auth_ok"});
  first.frame({type:"event",event:{eventId:"e1",tenantId:"t",roomId:"assortment-review",sequence:1,type:"message",payload:{}}});
  first.frame({type:"event",event:{eventId:"e2",tenantId:"t",roomId:"assortment-review",sequence:2,type:"message",payload:{}}});
  network.dispatchEvent(new Event("offline"));
  assert.equal(first.readyState,3);
  assert.equal(states.at(-1),"offline");
  first.frame({type:"event",event:{eventId:"late",tenantId:"t",roomId:"assortment-review",sequence:3,type:"message",payload:{}}});
  assert.deepEqual(seen,["e1","e2"],"frames from the detached socket are ignored");
  (socket as any).open(true);
  assert.equal(FakeSocket.instances.length,1,"no reconnect while offline");
  network.dispatchEvent(new Event("online"));
  assert.equal(FakeSocket.instances.length,2);
  const next=FakeSocket.instances.at(-1)!;next.open();await Promise.resolve();next.frame({type:"auth_ok"});
  assert.deepEqual(next.sent.find(x=>x.type==="subscribe"),{v:1,type:"subscribe",roomId:"assortment-review",after:2});
  assert.equal(states.at(-1),"online");
  socket.close(true);
  network.dispatchEvent(new Event("online"));
  assert.equal(FakeSocket.instances.length,2,"listeners are removed on close");
 }finally{(globalThis as any).WebSocket=original;(globalThis as any).sessionStorage=originalStorage;
  (globalThis as any).addEventListener=originalAdd;(globalThis as any).removeEventListener=originalRemove;}
});

test("presence and typing frames from a departed room cannot reappear",async()=>{
 const original=(globalThis as any).WebSocket;
 const originalStorage=(globalThis as any).sessionStorage;
 (globalThis as any).WebSocket=FakeSocket;
 (globalThis as any).sessionStorage={getItem:()=>null,setItem(){},removeItem(){}};
 try{
  FakeSocket.instances=[];
  const present:string[]=[];const typing:string[]=[];
  const client=new TeamSocket("wss://test.invalid/ws",()=>{},()=>{},()=>{},"member-ephemeral",
    room=>present.push(room),room=>typing.push(room));
  client.connect("token");client.subscribe("assortment-review");
  const fake=FakeSocket.instances.at(-1)!;fake.open();fake.frame({type:"auth_ok"});
  fake.frame({type:"presence",roomId:"assortment-review",users:[]});
  client.unsubscribe("assortment-review");client.subscribe("category-strategy");
  fake.frame({type:"presence",roomId:"assortment-review",users:[]});
  fake.frame({type:"typing",roomId:"assortment-review",users:[]});
  fake.frame({type:"presence",roomId:"category-strategy",users:[]});
  fake.frame({type:"typing",roomId:"category-strategy",users:[]});
  assert.deepEqual(present,["assortment-review","category-strategy"]);
  assert.deepEqual(typing,["category-strategy"]);
  client.close(true);
 }finally{(globalThis as any).WebSocket=original;(globalThis as any).sessionStorage=originalStorage;}
});
