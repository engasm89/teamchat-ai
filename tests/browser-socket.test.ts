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
