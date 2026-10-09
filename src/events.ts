import {assertContext, type TenantContext} from "./tenant.ts";
export interface RoomEvent {eventId:string;tenantId:string;roomId:string;sequence:number;type:string;turnId?:string;payload:Record<string,unknown>;}
/** Offline adapter demonstrating event IDs, payload-conflict rejection and replay. PostgreSQL transactions replace this in production. */
export class FixtureEventLog {
  private readonly rooms=new Map<string,RoomEvent[]>();
  private readonly messages=new Map<string,{digest:string,event:RoomEvent}>();
  send(ctx:TenantContext,roomId:string,clientMessageId:string,text:string):RoomEvent {
    assertContext(ctx);
    if(!roomId || !clientMessageId || !text.trim() || text.length>8000) throw new Error("Invalid message");
    const unique=`${ctx.tenantId}:${ctx.uid}:${clientMessageId}`;
    const existing=this.messages.get(unique);
    if(existing){if(existing.digest!==`${roomId}:${text}`)throw new Error("Conflicting duplicate message ID");return existing.event;}
    const key=`${ctx.tenantId}:${roomId}`;const events=this.rooms.get(key)??[];
    const event:RoomEvent={eventId:crypto.randomUUID(),tenantId:ctx.tenantId,roomId,sequence:events.length+1,
      type:"message",payload:{author:ctx.uid,text,clientMessageId}};
    events.push(event);this.rooms.set(key,events);this.messages.set(unique,{digest:`${roomId}:${text}`,event});return event;
  }
  replay(ctx:TenantContext,roomId:string,afterSeq=0,limit=100):RoomEvent[]{
    assertContext(ctx);if(!Number.isSafeInteger(afterSeq)||afterSeq<0)throw new Error("Invalid cursor");
    return (this.rooms.get(`${ctx.tenantId}:${roomId}`)??[]).filter(e=>e.sequence>afterSeq).slice(0,Math.min(Math.max(limit,1),1000));
  }
}
export class EventReducer {
  private last=0;private seen=new Set<string>();
  get cursor(){return this.last;}
  accept(event:RoomEvent):"applied"|"duplicate"|"gap"{
    if(this.seen.has(event.eventId)||event.sequence<=this.last)return "duplicate";
    if(event.sequence!==this.last+1)return "gap";
    this.last=event.sequence;this.seen.add(event.eventId);return "applied";
  }
}
