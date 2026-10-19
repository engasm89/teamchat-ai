import test from "node:test";
import assert from "node:assert/strict";
import {TurnSources,WorkspaceVocabulary,JsonArrayStream,checkSegment,type VerifiedSegment} from "../src/answer-contract.ts";
import {buildConversationContents,toolLessRoute,sayCandidates,composeInstructions,type HistoryEvent} from "../src/worker/gemini.ts";

const TURN="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",N="northside-outfitters";
const names=new Map([["uid-n1","Northside Buyer One"],["uid-n2","Northside Buyer Two"],["uid-n3","Northside Analyst Three"]]);
const msg=(sequence:number,uid:string,body:string):HistoryEvent=>({type:"message",sequence,payload:{author_uid:uid,body}});
const SUPPLIER_EMAIL="I'll draft the supplier email for the hiking range";
const CONTACT="I'll contact the supplier about the tent delivery";
const LABELS="Also checking the shelf labels this afternoon";
const ROOM_A=[
 msg(1,"uid-n1","Morning! Can someone own the supplier follow-up?"),
 msg(2,"uid-n2",SUPPLIER_EMAIL),
 msg(3,"uid-n3",CONTACT),
 msg(4,"uid-n1","Thanks both"),
 msg(5,"uid-n2",LABELS),
];
/** As loadVocabulary builds it: member names and their parts, minus the requester's. */
function vocabularyFor(requester:string){
 const members=[...names.values()],own=requester.toLowerCase().split(/\s+/);
 return new WorkspaceVocabulary({tenantId:N,catalogText:["Waterproof hiking jacket","Outerwear","Apparel"],requesterName:requester,
  members,phrases:members.flatMap(n=>[n,...n.split(/\s+/).filter(x=>x.length>=3)]).filter(p=>!own.includes(p.toLowerCase())&&p!==requester),
  echoText:ROOM_A.map(e=>String(e.payload.body)).join("\n")});
}
/** The worker's compose loop with a scripted model: streamed chunks in, verified segments out. */
function composeWith(chunks:string[],history:HistoryEvent[],trigger:{uid:string;cutoff:number}){
 const conversation=buildConversationContents(history,names,trigger);
 const vocabulary=vocabularyFor(conversation.requesterName);
 const sources=new TurnSources(TURN,N,names);
 const stream=new JsonArrayStream();const shown:VerifiedSegment[]=[];const rejected:string[]=[];
 for(const chunk of chunks)for(const element of stream.push(chunk)){
  const check=checkSegment(JSON.parse(element),{sources,messages:conversation.messages,vocabulary});
  if(check.ok)shown.push(check.segment);else rejected.push(check.reason);
 }
 return {shown,rejected,conversation};
}
const quoteOf=(ref:string)=>JSON.stringify({kind:"fact",predicate:"message_quote",ref});

test("a tool-less draft that reports what someone said goes to compose, never straight to the room",()=>{
 const v=vocabularyFor("Northside Buyer One");
 const route=(draft:string)=>toolLessRoute(sayCandidates(draft),v);
 // The recorded staging failure: an unnamed paraphrase that passes every say check.
 const paraphrase="Your colleague said they'd draft the supplier email for the hiking range.";
 assert.equal(v.checkSay(paraphrase).ok,true);
 assert.equal(route(paraphrase),"compose");
 assert.equal(route("Northside Buyer Two is going to draft the supplier email."),"compose");
 assert.equal(route("They'll handle the supplier follow-up."),"compose");
 assert.equal(route("You said you'd pull the store list."),"compose");
 assert.equal(route("Here's what your colleague said:"),"compose");
 assert.equal(route("Your colleague said:"),"compose");
 // Small talk, including greeting the requester by name, is still shown directly.
 assert.equal(route("Hi! I'm doing well, thanks for asking. How can I help today?"),"direct");
 assert.equal(route("Hi Northside Buyer One! Let me know if you'd like anything."),"direct");
 // A draft citing identifiers still gets the escalation note so the model can fetch them.
 assert.equal(route("Northside Buyer Two asked about APP-100.12."),"escalate");
 assert.equal(route(""),"escalate");
});

test("message_quote renders the right speaker and their exact words, whoever is asking",()=>{
 const {shown,rejected,conversation}=composeWith(
  ['[{"kind":"say","text":"Here\'s who said that:"},',quoteOf("M3"),"]"],
  [...ROOM_A,msg(6,"uid-n1","@AI who said they would contact the supplier?")],{uid:"uid-n1",cutoff:6});
 assert.deepEqual(rejected,[]);
 assert.deepEqual(shown.map(s=>s.rendered),["Here's who said that:",`Northside Analyst Three (#3): “${CONTACT}”`]);
 assert.deepEqual(shown[1]!.sources,["Message M3"]);
 // Every alias resolves to this room's message with the server's display name.
 assert.deepEqual(conversation.messages.map(m=>[m.alias,m.author,m.sequence]),
  [["M1","Northside Buyer One",1],["M2","Northside Buyer Two",2],["M3","Northside Analyst Three",3],["M4","Northside Buyer One",4],["M5","Northside Buyer Two",5],["M6","Northside Buyer One",6]]);
 const second=composeWith([`[${quoteOf("M5")},${quoteOf("M2")}]`],[...ROOM_A,msg(6,"uid-n3","@AI what did Northside Buyer Two say?")],{uid:"uid-n3",cutoff:6});
 assert.deepEqual(second.shown.map(s=>s.rendered),[`Northside Buyer Two (#5): “${LABELS}”`,`Northside Buyer Two (#2): “${SUPPLIER_EMAIL}”`]);
});

test("the requester's own earlier messages are marked, so 'my colleague' can be told apart",()=>{
 const {contents}=buildConversationContents([...ROOM_A,msg(6,"uid-n1","@AI what did my colleague just say?")],names,{uid:"uid-n1",cutoff:6});
 const text=JSON.stringify(contents);
 assert.match(text,/\[M1\] Northside Buyer One \(the requester\): Morning!/);
 assert.match(text,/\[M5\] Northside Buyer Two: Also checking/);
 assert.match(text,/CURRENT REQUEST \[M6\] from Northside Buyer One/);
 assert.match(composeInstructions(),/message_quote fact for each message that answers it/);
 assert.match(composeInstructions(),/must never restate, paraphrase or attribute anyone's words itself/);
});

test("a model cannot attribute words in its own text, to the right speaker or the wrong one",()=>{
 const {shown,rejected}=composeWith([JSON.stringify([
  {kind:"say",text:"Northside Buyer One said she would contact the supplier."},
  {kind:"say",text:"Your colleague said they'd contact the supplier."},
  {kind:"say",text:"They'll contact the supplier tomorrow."},
  {kind:"fact",predicate:"message_quote",ref:"M3",text:"Northside Buyer One: I'll contact the supplier"},
  {kind:"say",text:"Here's what your colleague said:"},
 ])],[...ROOM_A,msg(6,"uid-n2","@AI who will contact the supplier?")],{uid:"uid-n2",cutoff:6});
 assert.deepEqual(rejected,["workspace name in say","unquoted attribution in say","unquoted attribution in say","fact with model text"]);
 assert.deepEqual(shown.map(s=>s.rendered),["Here's what your colleague said:"]);
});

test("forged message refs, and refs to other rooms or tenants, never render foreign words",()=>{
 const roomB=[msg(40,"uid-n2","Room B secret: the clearance plan"),msg(41,"uid-n1","@AI hi")];
 const foreign=[msg(1,"uid-v1","Valley private note"),msg(2,"uid-n1","@AI what did the last person say?")];
 const forged=composeWith([JSON.stringify([
  {kind:"fact",predicate:"message_quote",ref:"M99"},
  {kind:"fact",predicate:"message_quote",ref:"#3"},
  {kind:"fact",predicate:"message_quote",ref:"room-b:M1"},
  {kind:"fact",predicate:"message_quote",ref:"S1"},
  {kind:"fact",predicate:"message_quote"},
  {kind:"fact",predicate:"message_quote",ref:"M1000"},
 ])],[...ROOM_A,msg(6,"uid-n1","@AI who said what?")],{uid:"uid-n1",cutoff:6});
 assert.deepEqual(forged.rejected,["unknown message ref","bad message ref","bad message ref","bad message ref","bad message ref","bad message ref"]);
 assert.equal(forged.shown.length,0);
 // An alias only ever means a message in the transcript of THIS turn's room.
 const b=composeWith([`[${quoteOf("M1")},${quoteOf("M3")}]`],roomB,{uid:"uid-n1",cutoff:41});
 assert.deepEqual(b.shown.map(s=>s.rendered),["Northside Buyer Two (#40): “Room B secret: the clearance plan”"]);
 assert.deepEqual(b.rejected,["unknown message ref"]);
 const a=composeWith([`[${quoteOf("M1")}]`],[...ROOM_A,msg(6,"uid-n1","@AI hi")],{uid:"uid-n1",cutoff:6});
 assert.equal(a.shown.some(s=>/Room B secret/.test(s.rendered)),false);
 // A user outside this tenant's directory is never given a name, nor a raw ID.
 const t=composeWith([`[${quoteOf("M1")}]`],foreign,{uid:"uid-n1",cutoff:2});
 assert.deepEqual(t.shown.map(s=>s.rendered),["Unknown member (#1): “Valley private note”"]);
 assert.equal(JSON.stringify(t.conversation.contents).includes("uid-v1"),false);
});
