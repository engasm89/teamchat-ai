import {useEffect,useMemo,useRef,useState} from "react";
import {initializeApp} from "firebase/app";
import {getAuth,signInWithEmailAndPassword,onAuthStateChanged,signOut,type User} from "firebase/auth";
import {TeamSocket,type SocketStatus,type LiveEvent} from "./socket";
import "./styles.css";
const app=initializeApp({apiKey:import.meta.env.VITE_FIREBASE_API_KEY,authDomain:import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,projectId:import.meta.env.VITE_FIREBASE_PROJECT_ID});
const auth=getAuth(app);
export function App(){
 const [user,setUser]=useState<User|null>(null),[email,setEmail]=useState(""),[password,setPassword]=useState(""),[body,setBody]=useState(""),[error,setError]=useState(""),[status,setStatus]=useState<SocketStatus>("offline");
 const [room,setRoom]=useState("assortment-review"),[events,setEvents]=useState<Record<string,LiveEvent[]>>({});
 const [allowMemory,setAllowMemory]=useState(false),[channels,setChannels]=useState<string[]>(["assortment-review","category-strategy"]);
 const socketRef=useRef<TeamSocket|null>(null);
 const [presence,setPresence]=useState<Record<string,Array<{firebase_uid:string;expires_at:string}>>>({});
 const [typing,setTyping]=useState<Record<string,Array<{firebase_uid:string;expires_at:string}>>>({});
 const [now,setNow]=useState(Date.now());
 useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),3000);return()=>clearInterval(timer);},[]);
 useEffect(()=>onAuthStateChanged(auth,setUser),[]);
 useEffect(()=>{
  if(!user)return;
  const wsUrl=import.meta.env.VITE_WEBSOCKET_URL;
  if(!wsUrl){setError("Missing WebSocket configuration");return;}
  const socket=new TeamSocket(wsUrl,ev=>setEvents(p=>({...p,[ev.roomId]:[...(p[ev.roomId]??[]),ev]})),setStatus,setError,user.uid,(r,users)=>setPresence(p=>({...p,[r]:users})),(r,users)=>setTyping(p=>({...p,[r]:users})));
  socketRef.current=socket;
  socket.connect(()=>user.getIdToken());socket.subscribe(room);
  user.getIdToken().then(token=>fetch(`${import.meta.env.VITE_API_URL}/api/rooms`,{headers:{Authorization:`Bearer ${token}`}}))
   .then(r=>r.ok?r.json():Promise.reject()).then(data=>{if(Array.isArray(data.rooms)&&data.rooms.length){setChannels(data.rooms.map((r:{room_id:string})=>r.room_id));}})
   .catch(()=>setError("Cannot load workspace rooms"));
  return ()=>{socket.close();socketRef.current=null;};
 },[user]);
 useEffect(()=>{if(user)socketRef.current?.subscribe(room);},[room,user]);
 const online=(presence[room]??[]).filter(x=>new Date(x.expires_at).getTime()>now);
 const activeTyping=(typing[room]??[]).filter(x=>x.firebase_uid!==user?.uid&&new Date(x.expires_at).getTime()>now);
 const transcript=useMemo(()=>[...(events[room]??[])].sort((a,b)=>a.sequence-b.sequence),[events,room]);
 async function login(e:React.FormEvent){e.preventDefault();setError("");try{await signInWithEmailAndPassword(auth,email,password);}catch{setError("Sign-in failed");}}
 function send(e:React.FormEvent){e.preventDefault();if(!body.trim())return;socketRef.current?.sendMessage(room,body.trim(),allowMemory);setBody("");setAllowMemory(false);}
 if(!user)return <main className="auth"><section className="authcard"><div className="brand">◈ TeamChat AI</div><h1>Welcome back</h1><p>Sign in with an assessment account to continue.</p><form onSubmit={login}><label>Email<input autoComplete="username" type="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label>Password<input autoComplete="current-password" type="password" value={password} onChange={e=>setPassword(e.target.value)} required/></label><button>Sign in</button></form>{error&&<p role="alert">{error}</p>}</section></main>;
 return <div className="shell"><aside className="sidebar"><div className="brand">◈ TeamChat AI</div><div className="navlabel">CHANNELS</div>{channels.map(r=><button key={r} className={`channel ${room===r?"active":""}`} onClick={()=>setRoom(r)}># {r}</button>)}<div className="sidebarfooter"><small>{user.email}</small><button className="signout" onClick={()=>{socketRef.current?.close(true);void signOut(auth);}}>Sign out</button></div></aside><main className="chat"><header><div><strong># {room}</strong><p>Team workspace · {online.length} online {activeTyping.length?`· ${activeTyping.length} typing`:""}</p></div><span className={`status ${status}`}>{status}</span></header><section className="messages" aria-live="polite">{transcript.length===0&&<div className="empty">No messages in this channel yet.</div>}{transcript.map(e=><article className="message" key={e.eventId}><span className="avatar">{String(e.payload.author_uid??"A").slice(0,1).toUpperCase()}</span><div><strong>{String(e.payload.author_uid??"AI Assistant")}</strong><small> #{e.sequence}</small>{e.type==="message"?<p>{String(e.payload.body??"")}</p>:
 <pre className="structured">{e.type==="ai_tool"?`Tool: ${String(e.payload.name)}\n${JSON.stringify(e.payload.arguments,null,2)}\n${JSON.stringify(e.payload.result,null,2)}`:
 e.type==="ai_answer_block"?JSON.stringify(e.payload.verified,null,2):e.type==="ai_complete"?"Answer completed":"AI processing update"}</pre>}</div></article>)}</section>{error&&<p role="alert" className="error">{error}</p>}<form onSubmit={send} className="compose"><input value={body} onChange={e=>{setBody(e.target.value);socketRef.current?.typing(room);}} placeholder={`Message #${room} (mention @AI to ask the assistant)`} aria-label="Message"/><label title="Allow the assistant to save decisions in shared company memory"><input type="checkbox" checked={allowMemory} onChange={e=>setAllowMemory(e.target.checked)}/>Save shared memory</label><button disabled={status!=="online"}>Send</button></form></main></div>;
}
