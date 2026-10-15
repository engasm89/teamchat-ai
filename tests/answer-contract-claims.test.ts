import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {TurnSources,WorkspaceVocabulary,JsonArrayStream,checkSegment,fallbackSegments,type HistoryMessage} from "../src/answer-contract.ts";

const TURN="9a610fd3-691c-4a22-aa10-f24cbd207e90",OTHER_TURN="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const T="northside-outfitters";
const ref=(kind:string,id:string,turn=TURN,tenant=T)=>`${turn}:${tenant}:${kind}:${id}`;
const vocabulary=new WorkspaceVocabulary({tenantId:T,requesterName:"Northside Analyst Three",
 catalogText:["Portable air conditioner","Climate control","Waterproof hiking jacket"],
 phrases:["Riverside Outlet","Sarah Lindqvist","Sarah"],
 echoText:"@AI For ST-4003, what coefficient score changes if we add APP-100.12? Show class supersession."});
const messages:HistoryMessage[]=[];

/** The S05 turn recorded in production Gate 5 (qa_evidence/runs/20261014T224119Z-acceptance-f823b5,
 * frames in qa_evidence/runs/20261014T224458Z-browser-b70bb3/S15): the verified score_change listed
 * superseded classes 1003 and 506, and the next say segment read "There is no class supersession." */
function s05Sources(){
 const s=new TurnSources(TURN,T);
 s.ingest("calculate_uplift",{ref:ref("calculation","ST-4003"),result:{delta:"0.000000"},
  before:{score:"1.047585",codes:["APP-100.11"]},
  after:{score:"1.047585",codes:["APP-100.11","APP-100.12"],retained:["1001","1101","318"],removed:["1003","506"]}});
 return s;
}
const say=(text:string,s=s05Sources())=>checkSegment({kind:"say",text},{sources:s,messages,vocabulary});

test("S05 regression: a say denying supersession is rejected when the verified score change lists superseded classes",()=>{
 const s=s05Sources();
 const fact=checkSegment({kind:"fact",predicate:"score_change",ref:"S1"},{sources:s,messages,vocabulary});
 assert.ok(fact.ok&&/superseded classes: 1003, 506/.test(fact.segment.rendered));
 const denial=say("There is no class supersession.",s);
 assert.equal(denial.ok,false,"the recorded production sentence must not pass");
});

test("supersession and replacement wording is a workspace claim in any form, including the common misspelling",()=>{
 for(const text of ["There is no class supersession.","No supersession happens here.","Supersession does not apply.",
  "Nothing gets superseded.","Nothing is superseded this time.","It will supersede the old class.",
  "There's no supercession to report.","No classes are overridden.","None of the classes are replaced.",
  "Nothing gets displaced by this addition.","The old class is replaced by the new one."])
  assert.equal(vocabulary.checkSay(text).ok,false,text);
});

test("negated availability, false ownership, made-up causes and money or forecasts never pass as a say",()=>{
 for(const text of ["There are no gaps.","There are no gaps at that store.","All products are available.",
  "Everything is in stock there.","Sarah owns that store.","Sarah is responsible for that store.",
  "Sales dropped because of the weather.","That happened as a result of the heatwave.",
  "This will bring in about five thousand dollars.","Expect roughly ten thousand euros of extra revenue.",
  "The forecast for next season looks strong.","This should boost turnover nicely.",
  "Nothing changes for the classes.","No classes change."])
  assert.equal(vocabulary.checkSay(text).ok,false,text);
});

test("cross-segment consistency: say wording that contradicts this turn's verified records fails closed",()=>{
 const store=new TurnSources(TURN,T);
 store.ingest("get_store_assortment",{ref:ref("store","ST-4007"),store:{store_id:"ST-4007",store_name:"Riverside Outlet",
  carried_categories_2026:["APP-100.19"],suspected_gaps:[{catalog_code:"APP-169.16",description:"x",last_carried:"2024",evidence:"y"}]}});
 assert.equal(say("Nothing is missing from the range.",store).ok,false);
 assert.equal(say("Everything checks out, nothing to add.",store).ok,false);
 assert.equal(say("I couldn't find anything.",store).ok,false);
 assert.equal(say("Nothing turned up.",store).ok,false);
});

test("negative controls: ordinary conversation still passes",()=>{
 for(const text of ["Hi! I'm doing well, thanks for asking. How can I help you today?","Here's what I found:",
  "Good question.","Here's the calculation you asked for:","Let me know if you'd like me to look at anything else.",
  "Sure, here are the details.","Happy to help with that.","Here's how that works:"]){
  const r=say(text);
  assert.ok(r.ok,`${text} -> ${!r.ok?r.reason:""}`);
 }
});

test("a record from another turn or tenant cannot be used to make a say consistent or a fact citable",()=>{
 const s=new TurnSources(TURN,T);
 s.ingest("calculate_uplift",{ref:ref("calculation","ST-4003",OTHER_TURN),result:{delta:"0"},before:{score:"1",codes:[]},after:{score:"1",codes:[],retained:[],removed:[]}});
 s.ingest("calculate_uplift",{ref:ref("calculation","ST-4003",TURN,"valley-home-goods"),result:{delta:"0"},before:{score:"1",codes:[]},after:{score:"1",codes:[],retained:[],removed:[]}});
 assert.equal(s.list().length,0);
 assert.deepEqual(checkSegment({kind:"fact",predicate:"score_change",ref:"S1"},{sources:s,messages,vocabulary}),{ok:false,reason:"unknown source ref"});
});

test("replaying the recorded S05 composition through the streamed pipeline: the denial is never emitted",()=>{
 const s=s05Sources();
 const composed=`[{"kind":"fact","predicate":"score_change","ref":"S1"},{"kind":"say","text":"There is no class supersession."}]`;
 const stream=new JsonArrayStream();const emitted:string[]=[];const shown=new Set<string>();let rejected=0;
 for(let i=0;i<composed.length;i+=5)for(const element of stream.push(composed.slice(i,i+5))){
  const check=checkSegment(JSON.parse(element),{sources:s,messages,vocabulary});
  if(!check.ok){rejected++;continue;}
  const r=JSON.parse(element).ref;if(typeof r==="string"&&r)shown.add(r);
  emitted.push(check.segment.rendered);
 }
 assert.equal(rejected,1);
 const replacement=fallbackSegments(s,shown,emitted.length>0);
 assert.deepEqual(replacement,[],"the fact was already shown, so nothing is re-rendered");
 assert.equal(emitted.length,1);
 assert.match(emitted[0]!,/superseded classes: 1003, 506/);
 assert.ok(emitted.every(t=>!/no class supersession/i.test(t)));
});

test("the worker emits only checked segments and skips rejected ones (source contract)",()=>{
 const worker=readFileSync(new URL("../src/worker/gemini.ts",import.meta.url),"utf8");
 assert.match(worker,/const check=checkSegment\(parsed,\{sources,messages:conversation\.messages,vocabulary\}\);\s*if\(!check\.ok\)\{rejected\+\+;[^\n]*continue;\}/);
 assert.match(worker,/await emit\(check\.segment\)/);
});

test("the fallback never contradicts a verified fact already shown, and never repeats rejected text",()=>{
 const s=s05Sources();
 const shown=new Set(["S1"]);
 const out=fallbackSegments(s,shown,true);
 assert.deepEqual(out,[]);
 const none=fallbackSegments(s,new Set(),false);
 assert.ok(none.length===1&&none[0]!.predicate==="score_change"&&/superseded classes: 1003, 506/.test(none[0]!.rendered));
 assert.ok(none.every(x=>!/no class supersession/i.test(x.rendered)));
});

test("a rejected segment is disclosed; the notice vouches for figures only when a verified fact was shown",()=>{
 const s=s05Sources();
 const afterFact=fallbackSegments(s,new Set(["S1"]),true,true);
 assert.deepEqual(afterFact.map(x=>[x.kind,x.rendered,x.refs.length]),
  [["fallback","Part of my answer couldn't be verified against this workspace's records, so I've left it out. The figures above are verified.",0]]);
 const afterSayOnly=fallbackSegments(new TurnSources(TURN,T),new Set(),true,true);
 assert.deepEqual(afterSayOnly.map(x=>x.rendered),["Part of my answer couldn't be verified against this workspace's records, so I've left it out."]);
 for(const x of [...afterFact,...afterSayOnly])assert.ok(!/complete|everything|all of/i.test(x.rendered),x.rendered);
 assert.deepEqual(fallbackSegments(s,new Set(["S1"]),true,false),[],"nothing was rejected, so there is nothing to disclose");
 assert.equal(fallbackSegments(s,new Set(),true,true)[0]!.predicate,"score_change","an unshown source is re-rendered instead of a bare notice");
});
