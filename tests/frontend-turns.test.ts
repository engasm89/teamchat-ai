import test from "node:test";
import assert from "node:assert/strict";
import {summariseTurn,displayName,initials,isNearBottom,FOLLOW_THRESHOLD_PX} from "../apps/web/src/turns.ts";
import {visibleTranscript} from "../apps/web/src/transcript.ts";
import type {LiveEvent} from "../apps/web/src/socket.ts";

const T="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
let seq=0;
const ev=(type:string,payload:Record<string,unknown>={},turnId:string|undefined=T):LiveEvent=>({eventId:`e${++seq}`,tenantId:"northside-outfitters",roomId:"r",sequence:seq,type,turnId,payload});

test("members are shown by display name, never by raw user ID",()=>{
 const members=new Map([["uid-7f3a","Maya Chen"]]);
 assert.equal(displayName("uid-7f3a",members),"Maya Chen");
 assert.equal(displayName("uid-gone",members),"Unknown member");
 assert.equal(displayName(undefined,members),"Unknown member");
 assert.equal(initials("Maya Chen"),"MC");assert.equal(initials("Sam"),"S");assert.equal(initials(""),"?");
});

test("a turn reports what the assistant is doing, then its answer, sources and outcome",()=>{
 const started=ev("ai_turn_started",{attempt:1});
 assert.equal(summariseTurn(T,[]).state,"waiting");
 assert.deepEqual([summariseTurn(T,[started]).state,summariseTurn(T,[started]).activity],["working","Thinking…"]);
 const retry=ev("ai_retrying",{attempt:2,delaySeconds:2});
 assert.equal(summariseTurn(T,[started,retry]).activity,"The AI service is busy; trying again in 2 s (attempt 2 of 3)…");
 const tool=ev("ai_tool_start",{name:"get_store_assortment"});
 assert.equal(summariseTurn(T,[started,tool]).activity,"Checking a store's assortment…");
 const block=ev("ai_answer_block",{blockIndex:0,verified:{template:"get_store_assortment"}});
 const second=ev("ai_answer_segment",{index:1,kind:"fact",rendered:"ST-4007 (Riverside) …",sources:["Store ST-4007"]});
 const first=ev("ai_answer_segment",{index:0,kind:"say",rendered:"Here is what I found:",sources:[]});
 const done=summariseTurn(T,[started,tool,block,second,first,ev("ai_complete",{status:"completed"})]);
 assert.equal(done.state,"complete");
 assert.deepEqual(done.segments.map(s=>s.rendered),["Here is what I found:","ST-4007 (Riverside) …"]);
 assert.deepEqual(done.segments[1]!.sources,["Store ST-4007"]);
 assert.equal(done.sources.length,1);
 const failed=summariseTurn(T,[started,ev("ai_failed",{reason:"The AI service is busy right now. Please try again in a minute."})]);
 assert.deepEqual([failed.state,failed.failedReason],["failed","The AI service is busy right now. Please try again in a minute."]);
});

test("segments and blocks from an interrupted attempt are hidden after the reset",()=>{
 const stale=ev("ai_answer_segment",{index:0,kind:"say",rendered:"stale"});
 const staleBlock=ev("ai_answer_block",{blockIndex:0});
 const reset=ev("ai_answer_reset",{turnId:T,attempt:2});
 const fresh=ev("ai_answer_segment",{index:0,kind:"say",rendered:"fresh"});
 const visible=visibleTranscript([stale,staleBlock,reset,fresh]).map(e=>e.eventId);
 assert.deepEqual(visible,[reset.eventId,fresh.eventId]);
});

test("auto-follow only when the reader is near the bottom",()=>{
 assert.equal(isNearBottom({scrollHeight:2000,clientHeight:600,scrollTop:1400}),true);
 assert.equal(isNearBottom({scrollHeight:2000,clientHeight:600,scrollTop:1400-FOLLOW_THRESHOLD_PX}),true);
 assert.equal(isNearBottom({scrollHeight:2000,clientHeight:600,scrollTop:1400-FOLLOW_THRESHOLD_PX-1}),false);
});

test("the client fetches only the authenticated room directory, never on a timer, and renders names",async()=>{
 const fs=await import("node:fs");
 const app=fs.readFileSync(new URL("../apps/web/src/App.tsx",import.meta.url),"utf8");
 const fetches=app.split("\n").filter(l=>/fetch\s*\(/.test(l));
 assert.equal(fetches.length,1);assert.match(fetches[0]!,/\/api\/rooms/);
 assert.doesNotMatch(app,/setInterval\s*\(/);
 assert.doesNotMatch(app,/String\(e\.payload\.author_uid/,"raw author IDs must not be rendered");
 assert.match(app,/Jump to latest/);
 assert.match(app,/rooms_changed|loadRooms/);
 const socket=fs.readFileSync(new URL("../apps/web/src/socket.ts",import.meta.url),"utf8");
 assert.match(socket,/frame\.type==="rooms_changed"/);
});
