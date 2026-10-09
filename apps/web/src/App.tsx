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
 const socketRef=useRef<TeamSocket|null>(null);
 useEffect(()=>onAuthStateChanged(auth,setUser),[]);
 useEffect(()=>{
  if(!user)return;
  const wsUrl=import.meta.env.VITE_WEBSOCKET_URL;
  if(!wsUrl){setError("Missing WebSocket configuration");return;}
  const socket=new TeamSocket(wsUrl,ev=>setEvents(p=>({...p,[ev.roomId]:[...(p[ev.roomId]??[]),ev]})),setStatus,setError);
  socketRef.current=socket;
  user.getIdToken().then(token=>{socket.connect(token);socket.subscribe(room);}).catch(()=>setError("Authentication unavailable"));
  return ()=>{socket.close();socketRef.current=null;};
 },[user]);
 useEffect(()=>{if(user)socketRef.current?.subscribe(room);},[room,user]);
 const transcript=useMemo(()=>[...(events[room]??[])].sort((a,b)=>a.sequence-b.sequence),[events,room]);
 async function login(e:React.FormEvent){e.preventDefault();setError("");try{await signInWithEmailAndPassword(auth,email,password);}catch{setError("Sign-in failed");}}
 function send(e:React.FormEvent){e.preventDefault();if(!body.trim())return;socketRef.current?.sendMessage(room,body.trim());setBody("");}
 if(!user)return <main className="auth"><section className="authcard"><div className="brand">◈ TeamChat AI</div><h1>Welcome back</h1><p>Sign in with an assessment account to continue.</p><form onSubmit={login}><label>Email<input autoComplete="username" type="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label>Password<input autoComplete="current-password" type="password" value={password} onChange={e=>setPassword(e.target.value)} required/></label><button>Sign in</button></form>{error&&<p role="alert">{error}</p>}</section></main>;
 return <div className="shell"><aside className="sidebar"><div className="brand">◈ TeamChat AI</div><div className="navlabel">CHANNELS</div>{["assortment-review","category-strategy"].map(r=><button key={r} className={`channel ${room===r?"active":""}`} onClick={()=>setRoom(r)}># {r}</button>)}<div className="sidebarfooter"><small>{user.email}</small><button className="signout" onClick={()=>signOut(auth)}>Sign out</button></div></aside><main className="chat"><header><div><strong># {room}</strong><p>Team workspace</p></div><span className={`status ${status}`}>{status}</span></header><section className="messages" aria-live="polite">{transcript.length===0&&<div className="empty">No messages in this channel yet.</div>}{transcript.map(e=><article className="message" key={e.eventId}><span className="avatar">{String(e.payload.author_uid??"A").slice(0,1).toUpperCase()}</span><div><strong>{String(e.payload.author_uid??"AI Assistant")}</strong><small> #{e.sequence}</small><p>{String(e.payload.body??e.payload.text??JSON.stringify(e.payload))}</p></div></article>)}</section>{error&&<p role="alert" className="error">{error}</p>}<form onSubmit={send} className="compose"><input value={body} onChange={e=>setBody(e.target.value)} placeholder={`Message #${room} (mention @AI to ask the assistant)`} aria-label="Message"/><button disabled={status!=="online"}>Send</button></form></main></div>;
}
