import test from "node:test";
import assert from "node:assert/strict";
import {TeamSocket} from "../apps/web/src/socket.ts";

class FakeSocket {
 static OPEN=1;static CONNECTING=0;
 readyState=0;sent:string[]=[];
 private listeners=new Map<string,Array<(e:any)=>void>>();
 constructor(_url:string){}
 addEventListener(name:string,fn:(event:any)=>void){const list=this.listeners.get(name)??[];list.push(fn);this.listeners.set(name,list);}
 emit(name:string,data?:any){for(const fn of this.listeners.get(name)??[])fn(data);}
 send(raw:string){this.sent.push(raw);}
 close(){this.readyState=3;this.emit("close");}
}

test("terminal send rejection removes pending message while a transient server error retains it",async()=>{
 const previous=(globalThis as any).WebSocket;
 (globalThis as any).WebSocket=FakeSocket;
 const errors:string[]=[];
 const client=new TeamSocket("wss://example.test/ws",()=>{},()=>{},x=>errors.push(x));
 try{
  client.connect("test-token");
  const socket=(client as any).ws as FakeSocket;
  socket.readyState=FakeSocket.OPEN;socket.emit("open");
  await Promise.resolve();
  socket.emit("message",{data:JSON.stringify({type:"auth_ok"})});
  const messageId=client.sendMessage("assortment-review","hello");
  assert.equal((client as any).outbound.size,1);
  socket.emit("message",{data:JSON.stringify({type:"error",message:"temporary outage"})});
  assert.equal((client as any).outbound.size,1);
  socket.emit("message",{data:JSON.stringify({type:"message_rejected",clientMessageId:messageId})});
  assert.equal((client as any).outbound.size,0);
  assert.equal(errors.some(m=>m.includes("will not be retried")),true);
 }finally{client.close();(globalThis as any).WebSocket=previous;}
});
