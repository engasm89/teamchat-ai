/** Server-side latency of every recorded turn in an acceptance run, read back as
 * the runtime role: from the stored question to the first answer segment and to
 * the terminal event. Writes <runs dir>/../latency/<run id>.json, outside the
 * run's manifest.
 *   TEAMCHAT_TARGET=staging node --experimental-strip-types scripts/evidence/turn-latency.ts <run dir> */
import fs from "node:fs";
import path from "node:path";
import {TARGET,openDb,authoritativeEvents,firebaseSignIn} from "../acceptance/common.ts";
import {ACCOUNT_KEYS} from "../acceptance/target.ts";

const dir=process.argv[2];
if(!dir||!fs.existsSync(`${dir}/results.json`))throw Error("usage: turn-latency.ts <run dir containing results.json>");

interface Recorded {label:string;user:string;tenant:string;room:string;turnId:string;messageSequence:number}
const recorded:Recorded[]=[];
const walk=(d:string)=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){
 const p=path.join(d,e.name);
 if(e.isDirectory())walk(p);
 else if(e.name.endsWith(".json")){const j=JSON.parse(fs.readFileSync(p,"utf8"));if(j?.turnId&&j?.messageSequence)recorded.push(j);}
}};
walk(dir);

const uids=new Map<string,string>();
const uidFor=async(email:string)=>{
 if(!uids.has(email)){
  const key=ACCOUNT_KEYS.find(k=>TARGET.accounts[k].email===email);
  if(!key)throw Error(`${email} is not an account of target ${TARGET.name}`);
  uids.set(email,(await firebaseSignIn(key)).uid);
 }
 return uids.get(email)!;
};

const pool=await openDb();
const ms=(a?:string,b?:string)=>a&&b?new Date(b).getTime()-new Date(a).getTime():null;
const turns=[];
try{
 for(const r of recorded.sort((a,b)=>a.label.localeCompare(b.label))){
  const events=await authoritativeEvents(pool,r.tenant,await uidFor(r.user),r.room,r.messageSequence-1);
  const question=events.find(e=>e.sequence===r.messageSequence)?.created_at;
  const own=events.filter(e=>e.turn_id===r.turnId);
  const firstSegment=own.find(e=>e.type==="ai_answer_segment")?.created_at;
  const terminal=own.find(e=>e.type==="ai_complete"||e.type==="ai_failed");
  turns.push({label:r.label,turnId:r.turnId,terminal:terminal?.type??null,
   toFirstSegmentMs:ms(question,firstSegment),toTerminalMs:ms(question,terminal?.created_at)});
 }
}finally{await pool.end();}

const done=turns.map(t=>t.toTerminalMs).filter((v):v is number=>v!==null).sort((a,b)=>a-b);
const pct=(p:number)=>done.length?done[Math.min(done.length-1,Math.ceil(p*done.length)-1)]:null;
const summary={target:TARGET.name,turns:turns.length,measured:done.length,p50TerminalMs:pct(0.5),p95TerminalMs:pct(0.95),maxTerminalMs:done.at(-1)??null};
const out=path.join(path.dirname(path.resolve(dir)),"..","latency",`${path.basename(path.resolve(dir))}.json`);
fs.mkdirSync(path.dirname(out),{recursive:true});
fs.writeFileSync(out,JSON.stringify({summary,turns},null,1)+"\n");
console.log(JSON.stringify({...summary,out:path.relative(process.cwd(),out)}));
