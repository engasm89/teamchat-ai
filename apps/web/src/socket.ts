/** A single browser-native WebSocket per authenticated session. Never polls for data. */
export interface LiveEvent {eventId:string;tenantId:string;roomId:string;sequence:number;type:string;payload:Record<string,unknown>;}
export type SocketStatus="offline"|"connecting"|"online"|"reconnecting";
export class TeamSocket {
  private ws:WebSocket|null=null;private retries=0;private retryTimer:ReturnType<typeof setTimeout>|undefined;
  private authenticated=false;
  private authToken="";private tokenProvider:(()=>Promise<string>)|null=null;private deliberatelyClosed=false;
  private readonly cursor=new Map<string,number>();private readonly seen=new Set<string>();
  private readonly rooms=new Set<string>();
  private readonly outbound=new Map<string,{roomId:string;clientMessageId:string;body:string;allowSharedMemorySave:boolean}>();
  private readonly url:string;
  private readonly onEvent:(event:LiveEvent)=>void;
  private readonly onStatus:(status:SocketStatus)=>void;
  private readonly onError:(message:string)=>void;
  private readonly accountUid:string;
  private readonly onPresence?: (roomId:string,users:Array<{firebase_uid:string;expires_at:string}>)=>void;
  private readonly onTyping?: (roomId:string,users:Array<{firebase_uid:string;expires_at:string}>)=>void;
  constructor(url:string,onEvent:(event:LiveEvent)=>void,onStatus:(status:SocketStatus)=>void,
    onError:(message:string)=>void,accountUid="",
    onPresence?:(roomId:string,users:Array<{firebase_uid:string;expires_at:string}>)=>void,
    onTyping?:(roomId:string,users:Array<{firebase_uid:string;expires_at:string}>)=>void){
      this.url=url;this.onEvent=onEvent;this.onStatus=onStatus;this.onError=onError;
      this.accountUid=accountUid;this.onPresence=onPresence;this.onTyping=onTyping;
      this.restoreState();
    }
  private get storageKey(){return `teamchat-pending-v1:${this.accountUid}`;}
  private persistState(){
    if(!this.accountUid)return;
    try{sessionStorage.setItem(this.storageKey,JSON.stringify({cursor:[...this.cursor],outbound:[...this.outbound.values()].slice(-100)}));}catch{}
  }
  private restoreState(){
    if(!this.accountUid)return;
    try{
      const raw=sessionStorage.getItem(this.storageKey);if(!raw)return;
      const saved=JSON.parse(raw);
      // Full refresh starts at cursor zero and reloads durable transcript.
      // A socket reconnect within the current page retains its in-memory cursor.
      if(Array.isArray(saved.outbound))for(const item of saved.outbound.slice(-100)){
        if(item&&typeof item.clientMessageId==="string"&&typeof item.roomId==="string"&&typeof item.body==="string"&&item.body.length<=8000)this.outbound.set(item.clientMessageId,item);
      }
    }catch{sessionStorage.removeItem(this.storageKey);}
  }
  connect(token:string|(()=>Promise<string>)):void {
    if(typeof token==="string"){this.authToken=token;this.tokenProvider=null;}
    else {this.authToken="";this.tokenProvider=token;}
    this.deliberatelyClosed=false;this.open(false);
  }
  private open(reconnect:boolean):void {
    if(this.deliberatelyClosed||this.ws&&(this.ws.readyState===WebSocket.OPEN||this.ws.readyState===WebSocket.CONNECTING))return;
    this.onStatus(reconnect?"reconnecting":"connecting");
    const sock=new WebSocket(this.url);this.ws=sock;this.authenticated=false;
    sock.addEventListener("open",()=>{
      // Do not put identity tokens into URL/query strings.
      const authenticate=async()=>{
        try{const token=this.tokenProvider?await this.tokenProvider():this.authToken;
          if(sock.readyState===WebSocket.OPEN)sock.send(JSON.stringify({v:1,type:"auth",token}));
        }catch{this.onError("Authentication token unavailable");sock.close();}
      };void authenticate();
    });
    sock.addEventListener("message",(m)=>{
      if(this.deliberatelyClosed||this.ws!==sock||sock.readyState!==WebSocket.OPEN)return;
      let payload:unknown;try{payload=JSON.parse(String(m.data));}catch{this.onError("Invalid server frame");return;}
      if(!payload||typeof payload!=="object")return;
      const frame=payload as Record<string,unknown>;
      if(frame.type==="auth_ok"){
        this.authenticated=true;
        this.retries=0;this.onStatus("online");
        for(const roomId of this.rooms)sock.send(JSON.stringify({v:1,type:"subscribe",roomId,after:this.cursor.get(roomId)??0}));
        for(const send of this.outbound.values())sock.send(JSON.stringify({v:1,type:"send_message",...send}));
      } else if(frame.type==="message_ack"){
        if(typeof frame.clientMessageId==="string"){this.outbound.delete(frame.clientMessageId);this.persistState();}
      } else if(frame.type==="event"){
        const event=frame.event as LiveEvent;
        if(!event||typeof event.roomId!=="string"||!Number.isSafeInteger(event.sequence))return;
        const last=this.cursor.get(event.roomId)??0;
        if(event.sequence<=last||this.seen.has(event.eventId))return;
        if(event.sequence!==last+1){
          sock.send(JSON.stringify({v:1,type:"replay",roomId:event.roomId,after:last}));return;
        }
        this.cursor.set(event.roomId,event.sequence);this.seen.add(event.eventId);this.persistState();
        if(this.seen.size>2000)this.seen.clear(); // cursor remains source of dedupe
        this.onEvent(event);
      } else if(frame.type==="presence"&&typeof frame.roomId==="string"&&Array.isArray(frame.users)){
        this.onPresence?.(frame.roomId,frame.users as Array<{firebase_uid:string;expires_at:string}>);
      } else if(frame.type==="typing"&&typeof frame.roomId==="string"&&Array.isArray(frame.users)){
        this.onTyping?.(frame.roomId,frame.users as Array<{firebase_uid:string;expires_at:string}>);
      } else if(frame.type==="error") this.onError(String(frame.message??"Request failed"));
    });
    sock.addEventListener("close",()=>{
      if(this.ws!==sock)return; // ignore delayed close from an older transport
      this.authenticated=false;
      this.ws=null;
      if(this.deliberatelyClosed){this.onStatus("offline");return;}
      this.onStatus("reconnecting");this.scheduleReconnect();
    });
    sock.addEventListener("error",()=>{if(this.ws===sock&&!this.deliberatelyClosed)this.onError("WebSocket transport error");});
  }
  private scheduleReconnect():void{
    if(this.retryTimer!==undefined)clearTimeout(this.retryTimer);
    const backoff=Math.min(250*2**Math.min(this.retries++,6),15000);
    this.retryTimer=setTimeout(()=>{this.retryTimer=undefined;this.open(true);},backoff*(.7+Math.random()*.6));
  }
  subscribe(roomId:string):void {
    if(this.rooms.has(roomId))return;
    this.rooms.add(roomId);
    if(!this.cursor.has(roomId)){this.cursor.set(roomId,0);this.persistState();}
    if(this.authenticated&&this.ws?.readyState===WebSocket.OPEN)this.ws.send(JSON.stringify({v:1,type:"subscribe",roomId,after:this.cursor.get(roomId)??0}));
  }
  unsubscribe(roomId:string):void {
    if(!this.rooms.delete(roomId))return;
    if(this.authenticated&&this.ws?.readyState===WebSocket.OPEN)this.ws.send(JSON.stringify({v:1,type:"unsubscribe",roomId}));
  }
  sendMessage(roomId:string,body:string,allowSharedMemorySave=false):string {
    const clientMessageId=crypto.randomUUID();const message={roomId,clientMessageId,body,allowSharedMemorySave};
    this.outbound.set(clientMessageId,message);this.persistState();
    if(this.authenticated&&this.ws?.readyState===WebSocket.OPEN)this.ws.send(JSON.stringify({v:1,type:"send_message",...message}));
    return clientMessageId;
  }
  private lastTypingSent=0;
  typing(roomId:string):void{
    if(!this.authenticated||this.ws?.readyState!==WebSocket.OPEN)return;
    if(Date.now()-this.lastTypingSent<2000)return;
    this.lastTypingSent=Date.now();
    this.ws.send(JSON.stringify({v:1,type:"typing",roomId}));
  }
  close(clearStored=false):void {
    this.deliberatelyClosed=true;this.authToken="";this.tokenProvider=null;this.authenticated=false;
    if(this.retryTimer!==undefined){clearTimeout(this.retryTimer);this.retryTimer=undefined;}
    this.ws?.close();this.ws=null;this.outbound.clear();this.rooms.clear();this.cursor.clear();this.seen.clear();if(clearStored&&this.accountUid)try{sessionStorage.removeItem(this.storageKey);}catch{}this.onStatus("offline");
  }
}
