/** A protocol-level client for the deployed WebSocket API: real Firebase ID
 * token, real Origin header, the same frames the browser sends. */
import {randomUUID} from "node:crypto";
import WebSocket from "ws";
import {APP_URL,WS_URL,firebaseSignIn,sleep,type AccountKey} from "./common.ts";

export interface LiveEvent {eventId:string;tenantId:string;roomId:string;sequence:number;type:string;turnId?:string;payload:Record<string,any>}
export interface Turn {turnId:string;events:LiveEvent[];tools:Array<{operationId:string;name:string;arguments:any;result:any;sequence:number}>;
 blocks:any[];terminal:LiveEvent|undefined}

export class LiveClient {
 readonly frames:Array<{t:number;dir:"in"|"out";frame:any}>=[];
 readonly events=new Map<string,LiveEvent[]>();
 uid="";tenant="";email="";
 private ws!:WebSocket;
 private waiters=new Set<()=>void>();
 readonly account:AccountKey;
 private readonly url:string;
 constructor(account:AccountKey,url=WS_URL){this.account=account;this.url=url;}

 async connect(identity?:Awaited<ReturnType<typeof firebaseSignIn>>){
  const who=identity??await firebaseSignIn(this.account);this.uid=who.uid;this.tenant=who.tenant;this.email=who.email;
  this.ws=new WebSocket(this.url,{origin:APP_URL});
  this.ws.on("message",(data:Buffer)=>{
   const frame=JSON.parse(String(data));this.frames.push({t:Date.now(),dir:"in",frame});
   if(frame.type==="event"){const list=this.events.get(frame.event.roomId)??[];
    if(!list.some(e=>e.eventId===frame.event.eventId))list.push({...frame.event,sequence:Number(frame.event.sequence)});
    this.events.set(frame.event.roomId,list);}
   for(const w of this.waiters)w();
  });
  this.ws.on("close",()=>{for(const w of this.waiters)w();});
  await new Promise<void>((resolve,reject)=>{this.ws.once("open",()=>resolve());this.ws.once("error",reject);});
  this.send({type:"auth",token:who.idToken});
  await this.until(()=>this.frames.some(f=>f.frame.type==="auth_ok"),15000,"auth_ok");
  return this;
 }
 get open(){return this.ws?.readyState===WebSocket.OPEN;}
 send(frame:Record<string,unknown>){
  const out:Record<string,unknown>={v:1,...frame};this.frames.push({t:Date.now(),dir:"out",frame:out.type==="auth"?{...out,token:"[redacted]"}:out});
  this.ws.send(JSON.stringify(out));
 }
 async until(test:()=>boolean,ms:number,what:string){
  if(test())return;
  await new Promise<void>((resolve,reject)=>{
   const timer=setTimeout(()=>{this.waiters.delete(check);reject(Error(`Timed out after ${ms} ms waiting for ${what}`));},ms);
   const check=()=>{if(test()){clearTimeout(timer);this.waiters.delete(check);resolve();}};
   this.waiters.add(check);
  });
 }
 async subscribe(room:string,after?:number){
  this.send({type:"subscribe",roomId:room,after:after??0});
  await sleep(1500);
 }
 lastSequence(room:string){return Math.max(0,...(this.events.get(room)??[]).map(e=>e.sequence));}
 /** Send a message; resolves with its sequence and AI turn ID (if any). */
 async post(room:string,body:string,allowSharedMemorySave=false,clientMessageId=randomUUID()){
  this.send({type:"send_message",roomId:room,clientMessageId,body,allowSharedMemorySave});
  await this.until(()=>this.frames.some(f=>f.dir==="in"&&["message_ack","message_rejected"].includes(f.frame.type)&&f.frame.clientMessageId===clientMessageId),30000,"message_ack");
  const ack=this.frames.filter(f=>f.dir==="in"&&f.frame.clientMessageId===clientMessageId).at(-1)!.frame;
  if(ack.type==="message_rejected")throw Error(`Message rejected: ${ack.message}`);
  return {clientMessageId,sequence:Number(ack.sequence),turnId:ack.aiTurnId as string|undefined};
 }
 turn(room:string,turnId:string):Turn{
  const events=(this.events.get(room)??[]).filter(e=>e.turnId===turnId).sort((a,b)=>a.sequence-b.sequence);
  return {turnId,events,
   tools:events.filter(e=>e.type==="ai_tool").map(e=>({operationId:e.payload.operationId,name:e.payload.name,arguments:e.payload.arguments,result:e.payload.result,sequence:e.sequence})),
   blocks:events.filter(e=>e.type==="ai_answer_block").map(e=>e.payload.verified),
   terminal:events.find(e=>e.type==="ai_complete"||e.type==="ai_failed")};
 }
 async waitTurn(room:string,turnId:string,ms=240000):Promise<Turn>{
  await this.until(()=>!!this.turn(room,turnId).terminal,ms,`terminal event for turn ${turnId}`);
  return this.turn(room,turnId);
 }
 close(){try{this.ws.close();}catch{}}
}
