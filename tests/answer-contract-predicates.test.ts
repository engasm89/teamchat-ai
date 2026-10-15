import test from "node:test";
import assert from "node:assert/strict";
import {TurnSources,WorkspaceVocabulary,checkSegment,type HistoryMessage} from "../src/answer-contract.ts";

const TURN="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",OTHER_TURN="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const T="northside-outfitters",V="valley-home-goods";
const ref=(kind:string,id:string,turn=TURN,tenant=T)=>`${turn}:${tenant}:${kind}:${id}`;
const vocabulary=new WorkspaceVocabulary({tenantId:T,catalogText:[],phrases:[]});
const messages:HistoryMessage[]=[];
const MONEY=/[$€£]|\b(usd|eur|gbp|dollars?|euros?|pounds?|revenue|sales of)\b/i;

const product={catalog_code:"APP-100.19",description:"Portable air conditioner, low-noise",product_family:"Climate",department:"Appliances",margin_class:"318",margin_class_label:"Seasonal"};
const store={store_id:"ST-4007",store_name:"Riverside Outlet",store_format:"outlet",channel:"brick_and_mortar",segment:"standard",
 carried_categories_2026:["APP-100.19"],suspected_gaps:[{catalog_code:"APP-169.16",description:"Fan",last_carried:"2024",evidence:"Sold through each summer"}]};
const memory={key:"fans_energy_accessories",value:{decision:"expand",owner_team:"buying"},created_by:"uid-sarah",created_at:"2026-09-30T10:00:00Z",source_room_id:"supply-planning"};
const uplift={result:{delta:"0.319000",scenarioValue:"12500.00"},before:{score:"0.984775",codes:["APP-100.19"]},after:{score:"1.303775",codes:["APP-100.19","APP-169.16"],retained:["318"],removed:["506"]}};
const alternatives={store_id:"ST-4007",codes_a:["APP-169.16"],codes_b:["APP-192.17"],comparison:{option_a:{score:"1.1"},option_b:{score:"1.2"},difference_b_minus_a:"0.100000",
 caveat:"Dimensionless assortment coefficient scores only. B minus A is not monetary sales or a percentage."}};

function build(turn=TURN,tenant=T){
 const s=new TurnSources(TURN,T,new Map([["uid-sarah","Sarah Lindqvist"]]));
 s.ingest("get_catalog_code",{ref:ref("catalog","APP-100.19",turn,tenant),product});
 s.ingest("get_store_assortment",{ref:ref("store","ST-4007",turn,tenant),store});
 s.ingest("search_memory",[{ref:ref("memory","m1",turn,tenant),memory}]);
 s.ingest("calculate_uplift",{ref:ref("calculation","ST-4007",turn,tenant),...uplift});
 s.ingest("compare_assortment_options",{ref:ref("calculation","ST-4007:alternatives",turn,tenant),...alternatives});
 s.ingest("save_memory",{saved:false,validation_errors:[{field:"roster",issue:"nested objects are not allowed"}]});
 return s;
}
const fact=(raw:Record<string,unknown>,s=build())=>checkSegment({kind:"fact",...raw},{sources:s,messages,vocabulary});
const rendered=(raw:Record<string,unknown>)=>{const r=fact(raw);assert.ok(r.ok,JSON.stringify(raw));return r.ok?r.segment.rendered:"";};

test("each source predicate renders from this turn's record and only fits its own record type",()=>{
 const cases:Array<[string,string,RegExp]>=[
  ["product_info","S1",/APP-100\.19 is “Portable air conditioner, low-noise”.*margin class 318 \(Seasonal\)/],
  ["product_margin_class","S1",/^APP-100\.19 has margin class 318 \(Seasonal\)\.$/],
  ["store_summary","S2",/ST-4007 \(Riverside Outlet\).*carries 1 catalog codes and has 1 suspected assortment gap \(suspected, not confirmed demand\)/],
  ["store_gap","S2",/Suspected gaps at ST-4007 \(not confirmed demand\): APP-169\.16/],
  ["memory_recorded","S3",/Recorded by Sarah Lindqvist on 2026-09-30 in #supply-planning/],
  ["score_change","S4",/from 0\.984775 to 1\.303775 \(difference 0\.319000\).*superseded classes: 506.*not a sales forecast/],
  ["option_difference","S5",/B minus A is 0\.100000\. Dimensionless/],
  ["memory_save_result","S6",/Not saved — .*roster \(nested objects are not allowed\)/],
 ];
 for(const [predicate,src,expected] of cases)assert.match(rendered({predicate,ref:src}),expected,predicate);
 const wrong:Array<[string,string]>=[["product_info","S2"],["product_margin_class","S4"],["store_summary","S1"],["store_gap","S3"],
  ["memory_recorded","S6"],["score_change","S5"],["option_difference","S4"],["memory_save_result","S3"]];
 for(const [predicate,src] of wrong)assert.deepEqual(fact({predicate,ref:src}),{ok:false,reason:"predicate does not fit source"},`${predicate} on ${src}`);
});

test("rendered numbers are dimensionless scores; no money appears even when the tool result carries a scenario value",()=>{
 for(const [predicate,src] of [["score_change","S4"],["option_difference","S5"],["store_summary","S2"],["product_info","S1"]]){
  const text=rendered({predicate,ref:src});
  assert.doesNotMatch(text,MONEY,predicate);
  assert.doesNotMatch(text,/12500/,predicate);
 }
});

test("a model cannot supply values, codes where none belong, or a different relation",()=>{
 assert.deepEqual(fact({predicate:"score_change",ref:"S4",text:"Up by 30%."}),{ok:false,reason:"fact with model text"});
 assert.deepEqual(fact({predicate:"product_info",ref:"S1",code:"APP-100.19"}),{ok:false,reason:"unexpected code"});
 assert.deepEqual(fact({predicate:"memory_recorded",ref:"S3",code:"APP-100.19"}),{ok:false,reason:"unexpected code"});
 assert.match(rendered({predicate:"store_gap",ref:"S2",code:"APP-100.19"}),/APP-100\.19 is not listed as a suspected gap at ST-4007\./);
 assert.match(rendered({predicate:"store_carries_code",ref:"S2",code:"APP-169.16"}),/APP-169\.16 is not among the codes ST-4007/);
 assert.deepEqual(fact({predicate:"store_gap",ref:"S2",code:"fans"}),{ok:false,reason:"malformed code"});
});

test("records from another turn or another tenant are never citable by any predicate",()=>{
 for(const s of [build(OTHER_TURN,T),build(TURN,V)]){
  assert.equal(s.list().filter(x=>x.ref!==null).length,0);
  for(const predicate of ["product_info","store_summary","memory_recorded","score_change","option_difference"]){
   const r=fact({predicate,ref:"S1"},s);
   assert.equal(r.ok&&r.segment.refs.length>0,false,predicate);
  }
 }
});

test("assistant_capabilities and no_match take no source ref; capabilities never promise sales or money",()=>{
 assert.deepEqual(fact({predicate:"assistant_capabilities",ref:"S1"}),{ok:false,reason:"unexpected ref"});
 const caps=rendered({predicate:"assistant_capabilities"});
 assert.match(caps,/search the product catalog/);
 assert.doesNotMatch(caps,MONEY);
 assert.deepEqual(fact({predicate:"no_match",no_match_kind:"product"}),{ok:false,reason:"no-match not observed in this turn"});
 assert.deepEqual(fact({predicate:"no_match",no_match_kind:"forecast"}),{ok:false,reason:"unknown no-match kind"});
});
