/** A single browser-native WebSocket per authenticated session. Never polls for data. */
export interface LiveEvent {eventId:string;tenantId:string;roomId:string;sequence:number;type:string;payload:Record<string,unknown>;}
export type SocketStatus="offline"|"connecting"|"online"|"reconnecting";
export class TeamSocket {
  private ws:WebSocket|null=null;private retries=0;private retryTimer:number|undefined;
  private authToken="";private deliberatelyClosed=false;
  private readonly cursor=new Map<string,number>();private readonly seen=new Set<string>();
  private readonly outbound=new Map<string,{roomId:string;clientMessageId:string;body:string}>();
  constructor(private readonly url:string,
    private readonly onEvent:(event:LiveEvent)=>void,
    private readonly onStatus:(status:SocketStatus)=>void,
    private readonly onError:(message:string)=>void){}
  connect(token:string):void {
    this.authToken=token;this.deliberatelyClosed=false;this.open(false);
  }
  private open(reconnect:boolean):void {
    if(this.deliberatelyClosed||this.ws&&(this.ws.readyState===WebSocket.OPEN||this.ws.readyState===WebSocket.CONNECTING))return;
    this.onStatus(reconnect?"reconnecting":"connecting");
    const sock=new WebSocket(this.url);this.ws=sock;
    sock.addEventListener("open",()=>{
      // Do not put identity tokens into URL/query strings.
      sock.send(JSON.stringify({v:1,type:"auth",token:this.authToken}));
    });
    sock.addEventListener("message",(m)=>{
      let payload:unknown;try{payload=JSON.parse(String(m.data));}catch{this.onError("Invalid server frame");return;}
      if(!payload||typeof payload!=="object")return;
      const frame=payload as Record<string,unknown>;
      if(frame.type==="auth_ok"){
        this.retries=0;this.onStatus("online");
        for(const [roomId,after] of this.cursor)sock.send(JSON.stringify({v:1,type:"subscribe",roomId,after}));
        for(const send of this.outbound.values())sock.send(JSON.stringify({v:1,type:"send_message",...send}));
      } else if(frame.type==="message_ack"){
        if(typeof frame.clientMessageId==="string")this.outbound.delete(frame.clientMessageId);
      } else if(frame.type==="event"){
        const event=frame.event as LiveEvent;
        if(!event||typeof event.roomId!=="string"||!Number.isSafeInteger(event.sequence))return;
        const last=this.cursor.get(event.roomId)??0;
        if(event.sequence<=last||this.seen.has(event.eventId))return;
        if(event.sequence!==last+1){
          sock.send(JSON.stringify({v:1,type:"replay",roomId:event.roomId,after:last}));return;
        }
        this.cursor.set(event.roomId,event.sequence);this.seen.add(event.eventId);
        if(this.seen.size>2000)this.seen.clear(); // cursor remains source of dedupe
        this.onEvent(event);
      } else if(frame.type==="error") this.onError(String(frame.message??"Request failed"));
    });
    sock.addEventListener("close",()=>{
      if(this.ws===sock)this.ws=null;
      if(this.deliberatelyClosed){this.onStatus("offline");return;}
      this.onStatus("reconnecting");this.scheduleReconnect();
    });
    sock.addEventListener("error",()=>this.onError("WebSocket transport error"));
  }
  private scheduleReconnect():void{
    if(this.retryTimer!==undefined)clearTimeout(this.retryTimer);
    const backoff=Math.min(250*2**Math.min(this.retries++,6),15000);
    this.retryTimer=window.setTimeout(()=>{this.retryTimer=undefined;this.open(true);},backoff*(.7+Math.random()*.6));
  }
  subscribe(roomId:string):void {
    if(!this.cursor.has(roomId))this.cursor.set(roomId,0);
    if(this.ws?.readyState===WebSocket.OPEN)this.ws.send(JSON.stringify({v:1,type:"subscribe",roomId,after:this.cursor.get(roomId)??0}));
  }
  sendMessage(roomId:string,body:string):string {
    const clientMessageId=crypto.randomUUID();const message={roomId,clientMessageId,body};
    this.outbound.set(clientMessageId,message);
    if(this.ws?.readyState===WebSocket.OPEN)this.ws.send(JSON.stringify({v:1,type:"send_message",...message}));
    return clientMessageId;
  }
  close():void {
    this.deliberatelyClosed=true;this.authToken="";
    if(this.retryTimer!==undefined){clearTimeout(this.retryTimer);this.retryTimer=undefined;}
    this.ws?.close();this.ws=null;this.outbound.clear();this.cursor.clear();this.seen.clear();this.onStatus("offline");
  }
}
