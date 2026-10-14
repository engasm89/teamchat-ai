import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from "react";
import {initializeApp} from "firebase/app";
import {getAuth,signInWithEmailAndPassword,onAuthStateChanged,signOut,type User} from "firebase/auth";
import {TeamSocket,type SocketStatus,type LiveEvent} from "./socket";
import {renderVerifiedBlock} from "./verified";
import {visibleTranscript} from "./transcript";
import {summariseTurn,displayName,initials,isNearBottom,type AiTurn} from "./turns";
import "./styles.css";
import {canSendInRoom} from "./room-access";
const app=initializeApp({apiKey:import.meta.env.VITE_FIREBASE_API_KEY,authDomain:import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,projectId:import.meta.env.VITE_FIREBASE_PROJECT_ID});
const auth=getAuth(app);
interface RoomInfo {room_id:string;title:string;ai_chat:boolean;visibility:string}
const ROOM_ID=/^[-a-z0-9_]{1,128}$/i;
const AI_MENTION=/(?:^|[^\p{L}\p{N}_])@AI(?![\p{L}\p{N}_])/iu;
/** The only HTTP call the client makes: the authenticated room directory (GET) and chat creation (POST). */
const roomsRequest=(token:string,init:RequestInit={})=>fetch(`${import.meta.env.VITE_API_URL}/api/rooms`,{...init,headers:{...init.headers as Record<string,string>,Authorization:`Bearer ${token}`}});
const TERMINAL=new Set(["ai_complete","ai_failed"]);
const ACTIVITY=new Set(["ai_turn_started","ai_retrying","ai_tool_start","ai_tool","ai_answer_reset","ai_complete"]);

export function App(){
 const [user,setUser]=useState<User|null>(null),[email,setEmail]=useState(""),[password,setPassword]=useState(""),[body,setBody]=useState(""),[error,setError]=useState(""),[status,setStatus]=useState<SocketStatus>("offline");
 const [room,setRoom]=useState(""),[events,setEvents]=useState<Record<string,LiveEvent[]>>({});
 const [dataOwnerUid,setDataOwnerUid]=useState<string|null>(null);
 const [allowMemory,setAllowMemory]=useState(false),[rooms,setRooms]=useState<RoomInfo[]>([]);
 const [members,setMembers]=useState<Map<string,string>>(new Map());
 const socketRef=useRef<TeamSocket|null>(null);
 const [presence,setPresence]=useState<Record<string,Array<{firebase_uid:string;expires_at:string}>>>({});
 const [typing,setTyping]=useState<Record<string,Array<{firebase_uid:string;expires_at:string}>>>({});
 const [now,setNow]=useState(Date.now());
 const [creating,setCreating]=useState<{title:string;aiChat:boolean;requestId:string;pending:boolean}|null>(null);
 const listRef=useRef<HTMLElement|null>(null);const pinnedRef=useRef(true);
 const [unseen,setUnseen]=useState(0);
 const loadRoomsRef=useRef<(()=>Promise<void>)|null>(null);
 // Expire typing indicators only when one is actually active. No perpetual
 // three-second React re-render loop on an idle chat tab.
 useEffect(()=>{
  const current=Date.now();const dates=Object.values(typing).flat().map(x=>Date.parse(x.expires_at)).filter(x=>Number.isFinite(x)&&x>current);
  if(!dates.length)return;
  const timer=window.setTimeout(()=>setNow(Date.now()),Math.max(100,Math.min(...dates)-current+60));
  return()=>clearTimeout(timer);
 },[typing,now]);
 useEffect(()=>onAuthStateChanged(auth,setUser),[]);
 // A different Firebase identity must never inherit the prior user's room
 // transcript, presence, typing state, selection or shared-memory consent.
 useEffect(()=>{
  setDataOwnerUid(user?.uid??null);setEvents({});setPresence({});setTyping({});setRoom("");
  setAllowMemory(false);setBody("");setRooms([]);setMembers(new Map());setCreating(null);setError("");
 },[user?.uid]);
 useEffect(()=>{
  if(!user)return;
  const wsUrl=import.meta.env.VITE_WEBSOCKET_URL;
  if(!wsUrl){setError("Missing WebSocket configuration");return;}
  let active=true;const controller=new AbortController();
  // Called once at sign-in, then only when the server announces a change or
  // the socket reconnects. Never on a timer.
  const loadRooms=async()=>{
   try{
    const token=await user.getIdToken();if(!active)return;
    const r=await roomsRequest(token,{signal:controller.signal});if(!r.ok)throw Error();
    const data=await r.json();if(!active||!Array.isArray(data.rooms))return;
    // This comes from the authenticated room-list API, never from a chat frame.
    socket.setExpectedTenant(data.tenantId);
    const allowed=(data.rooms as RoomInfo[]).filter(x=>ROOM_ID.test(x.room_id));
    setRooms(allowed);
    setMembers(new Map(Array.isArray(data.members)?data.members.map((m:{firebase_uid:string;display_name:string})=>[m.firebase_uid,m.display_name]):[]));
    setRoom(current=>allowed.some(x=>x.room_id===current)?current:(allowed[0]?.room_id??""));
   }catch{if(active)setError("Cannot load workspace rooms");}
  };
  const socket=new TeamSocket(wsUrl,ev=>{if(active)setEvents(p=>({...p,[ev.roomId]:[...(p[ev.roomId]??[]),ev].slice(-500)}));},
   state=>{if(active)setStatus(state);},message=>{if(active)setError(message);},user.uid,
   (r,users)=>{if(active)setPresence(p=>({...p,[r]:users}));},
   (r,users)=>{if(active){setNow(Date.now());setTyping(p=>({...p,[r]:users}));}},
   ()=>{if(active)void loadRooms();});
  socketRef.current=socket;loadRoomsRef.current=loadRooms;
  socket.connect(()=>user.getIdToken());
  void loadRooms();
  return ()=>{active=false;controller.abort();socket.close();if(socketRef.current===socket)socketRef.current=null;loadRoomsRef.current=null;};
 },[user]);
 useEffect(()=>{
  if(!user||!room)return;
  const socket=socketRef.current;
  socket?.subscribe(room);
  return ()=>socket?.unsubscribe(room);
 },[room,user]);
 const safeOwner=dataOwnerUid!==null&&dataOwnerUid===user?.uid;
 const channels=useMemo(()=>rooms.map(r=>r.room_id),[rooms]);
 const current=rooms.find(r=>r.room_id===room);
 // Server sends an authoritative deduplicated set; online users are removed
 // when expired leases are observed by a surviving peer heartbeat.
 const online=(safeOwner?presence[room]??[]:[]);
 const activeTyping=(safeOwner?typing[room]??[]:[]).filter(x=>x.firebase_uid!==user?.uid&&new Date(x.expires_at).getTime()>now);
 const transcript=useMemo(()=>safeOwner?visibleTranscript(events[room]??[]):[],[safeOwner,events,room]);
 const turns=useMemo(()=>{
  const by=new Map<string,LiveEvent[]>();
  for(const e of transcript){if(e.type==="message")continue;const t=e.turnId??(typeof e.payload.turnId==="string"?e.payload.turnId:undefined);if(!t)continue;if(!by.has(t))by.set(t,[]);by.get(t)!.push(e);}
  const out=new Map<string,AiTurn&{first:string;latestActivity?:string}>();
  for(const [t,list] of by){const latest=[...list].reverse().find(e=>ACTIVITY.has(e.type));out.set(t,{...summariseTurn(t,list),first:list[0]!.eventId,latestActivity:latest?.eventId});}
  return out;
 },[transcript]);
 // Follow new messages only while the reader is at (or near) the bottom.
 useLayoutEffect(()=>{pinnedRef.current=true;setUnseen(0);const el=listRef.current;if(el)el.scrollTop=el.scrollHeight;},[room]);
 const lastKey=transcript.at(-1)?.eventId;
 useLayoutEffect(()=>{
  const el=listRef.current;if(!el||!lastKey)return;
  if(pinnedRef.current){el.scrollTop=el.scrollHeight;setUnseen(0);}else setUnseen(n=>n+1);
 },[lastKey]);
 const onScroll=useCallback(()=>{const el=listRef.current;if(!el)return;pinnedRef.current=isNearBottom(el);if(pinnedRef.current)setUnseen(0);},[]);
 const jumpToLatest=()=>{const el=listRef.current;if(!el)return;pinnedRef.current=true;setUnseen(0);el.scrollTo({top:el.scrollHeight,behavior:"smooth"});};
 async function login(e:React.FormEvent){e.preventDefault();setError("");try{await signInWithEmailAndPassword(auth,email,password);}catch{setError("Sign-in failed");}}
 function sendText(text:string){
  if(!canSendInRoom(channels,room,status)||!text.trim())return;
  try{pinnedRef.current=true;socketRef.current?.sendMessage(room,text.trim(),allowMemory);setError("");setBody("");setAllowMemory(false);}
  catch(reason){setError(reason instanceof Error?reason.message:"Unable to queue message");}
 }
 function send(e:React.FormEvent){e.preventDefault();sendText(body);}
 function askAi(){if(!body.trim())return;sendText(AI_MENTION.test(body)?body:`@AI ${body.trim()}`);}
 async function createChat(e:React.FormEvent){
  e.preventDefault();if(!user||!creating||creating.pending)return;
  const title=creating.title.replace(/\s+/g," ").trim();if(!title)return;
  setCreating({...creating,pending:true});setError("");
  try{
   const token=await user.getIdToken();
   const r=await roomsRequest(token,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title,aiChat:creating.aiChat,clientRequestId:creating.requestId})});
   const data=await r.json().catch(()=>({}));
   if(!r.ok)throw Error(typeof data.error==="string"?data.error:"Could not create the chat");
   await loadRoomsRef.current?.();
   if(typeof data.room?.room_id==="string")setRoom(data.room.room_id);
   setCreating(null);
  }catch(reason){setError(reason instanceof Error?reason.message:"Could not create the chat");setCreating(c=>c?{...c,pending:false}:c);}
 }
 const nameOf=(uid:unknown)=>displayName(uid,members);
 function renderEvent(e:LiveEvent){
  const attrs={"data-event-id":e.eventId,"data-seq":e.sequence,"data-turn-id":e.turnId,"data-event-type":e.type};
  if(e.type==="message"){
   const name=nameOf(e.payload.author_uid);const pendingTurn=typeof e.payload.ai_turn_id==="string"&&!turns.has(e.payload.ai_turn_id);
   return <article className="message" key={e.eventId} {...attrs}><span className="avatar" aria-hidden>{initials(name)}</span><div className="bubble">
    <strong>{name}{e.payload.author_uid===user?.uid&&<span className="you"> (you)</span>}</strong><small> #{e.sequence}</small><p>{String(e.payload.body??"")}</p>
    {pendingTurn&&<p className="activity live" role="status">AI Assistant is reading this…</p>}</div></article>;
  }
  const turnId=e.turnId??(typeof e.payload.turnId==="string"?e.payload.turnId:undefined);
  const turn=turnId?turns.get(turnId):undefined;
  const settled=!turn||turn.state==="complete"||turn.state==="failed";
  const header=turn?.first===e.eventId;
  let content:React.ReactNode=null;
  if(ACTIVITY.has(e.type)){
   if(!settled&&turn?.latestActivity===e.eventId)content=<p className="activity live" role="status">{e.type==="ai_answer_reset"?"Restarting the answer after an interruption…":turn.activity}</p>;
  }else if(e.type==="ai_answer_segment"){
   const sources=Array.isArray(e.payload.sources)?e.payload.sources.map(String):[];
   content=<p className={`segment ${String(e.payload.kind)}`}>{String(e.payload.rendered??"")}{sources.map(s=><span className="chip" key={s}>{s}</span>)}</p>;
  }else if(e.type==="ai_answer_block"){
   const text=renderVerifiedBlock(e.payload.verified,members);
   const template=String((e.payload.verified as Record<string,unknown>|undefined)?.template??"result").replace(/_/g," ");
   content=turn&&turn.segments.length?<details className="source"><summary>Source: {template}</summary><pre className="structured">{text}</pre></details>:<pre className="structured">{text}</pre>;
  }else if(e.type==="ai_failed")content=<p className="failed" role="alert">I couldn't finish this answer: {String(e.payload.reason??"Processing failed")}. You can ask again.</p>;
  else content=<p className="activity">AI processing update</p>;
  const visible=header||content!==null;
  return <article className={`message ai${visible?"":" silent"}${TERMINAL.has(e.type)?" terminal":""}`} key={e.eventId} {...attrs} aria-hidden={visible?undefined:true}>
   {header?<span className="avatar ai" aria-hidden>AI</span>:<span className="avatar spacer" aria-hidden/>}
   <div className="bubble">{header&&<><strong>AI Assistant</strong><small> #{e.sequence}</small></>}{content}
    {header&&!content&&!settled&&<p className="activity live" role="status">{turn?.activity}</p>}</div></article>;
 }
 if(!user)return <main className="auth"><section className="authcard"><div className="brand">◈ TeamChat AI</div><h1>Welcome back</h1><p>Sign in with an assessment account to continue.</p><form onSubmit={login}><label>Email<input autoComplete="username" type="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label>Password<input autoComplete="current-password" type="password" value={password} onChange={e=>setPassword(e.target.value)} required/></label><button>Sign in</button></form>{error&&<p role="alert">{error}</p>}</section></main>;
 const typingNames=activeTyping.map(x=>nameOf(x.firebase_uid));
 return <div className="shell"><aside className="sidebar"><div className="brand">◈ TeamChat AI</div>
  <div className="navlabel">CHANNELS</div>
  {(safeOwner?rooms:[]).map(r=><button key={r.room_id} className={`channel ${room===r.room_id?"active":""}`} onClick={()=>setRoom(r.room_id)} title={r.title}># {r.room_id===r.title?r.room_id:r.title}{r.ai_chat&&<span className="badge">AI</span>}</button>)}
  {creating?<form className="newchat" onSubmit={createChat}>
    <label>Chat name<input autoFocus maxLength={80} value={creating.title} onChange={e=>setCreating({...creating,title:e.target.value})} disabled={creating.pending}/></label>
    <label className="check"><input type="checkbox" checked={creating.aiChat} onChange={e=>setCreating({...creating,aiChat:e.target.checked})} disabled={creating.pending}/>AI chat: the assistant answers every message</label>
    <p className="hint">Everyone in your workspace can see this chat.</p>
    <div className="row"><button disabled={creating.pending||!creating.title.trim()}>{creating.pending?"Creating…":"Create"}</button><button type="button" className="ghost" onClick={()=>setCreating(null)} disabled={creating.pending}>Cancel</button></div>
   </form>:<button className="channel newchat-open" onClick={()=>setCreating({title:"",aiChat:true,requestId:crypto.randomUUID(),pending:false})}>+ New chat</button>}
  <div className="sidebarfooter"><small>{members.get(user.uid)??user.email}</small><button className="signout" onClick={()=>{socketRef.current?.close(true);void signOut(auth);}}>Sign out</button></div></aside>
 <main className="chat"><header><div><strong># {current?.title??room}</strong>{current?.ai_chat&&<span className="badge">AI chat</span>}<p>{current?.visibility==="tenant"?"Everyone in your workspace":"Team workspace"} · {online.length} online{typingNames.length?` · ${typingNames.join(", ")} ${typingNames.length===1?"is":"are"} typing…`:""}</p></div><span className={`status ${status}`}>{status}</span></header>
  <section className="messages" aria-live="polite" ref={listRef} onScroll={onScroll}>{transcript.length===0&&<div className="empty">No messages in this channel yet.</div>}{transcript.map(renderEvent)}</section>
  {unseen>0&&<button className="jump" onClick={jumpToLatest}>↓ Jump to latest</button>}
  {error&&<p role="alert" className="error">{error}</p>}
  <form onSubmit={send} className="compose"><input value={body} onChange={e=>{setBody(e.target.value);socketRef.current?.typing(room);}} placeholder={!room?"Select an authorized channel to start":current?.ai_chat?"Message the assistant…":`Message #${current?.title??room} (mention @AI to ask the assistant)`} aria-label="Message"/>
   <label title="Allow the assistant to save decisions in shared company memory"><input type="checkbox" checked={allowMemory} onChange={e=>setAllowMemory(e.target.checked)}/>Save shared memory</label>
   {!current?.ai_chat&&<button type="button" className="ghost" onClick={askAi} disabled={!canSendInRoom(channels,room,status)||!body.trim()}>Ask AI</button>}
   <button disabled={!canSendInRoom(channels,room,status)}>Send</button></form></main></div>;
}
