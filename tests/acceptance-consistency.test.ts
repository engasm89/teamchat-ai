import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {upliftContradictions,sentences,type UpliftResult} from "../scripts/acceptance/consistency.ts";

const S05:UpliftResult={before:{score:"1.047585"},
 after:{score:"1.047585",retained:["1001","1101","318","320","411","413","505","509","601","605","706","707","801"],removed:["1003","506"],multiplier:"0.231000"},
 result:{delta:"0.000000",baseline:"1.047585",proposed:"1.047585"}};
const S06:UpliftResult={before:{score:"0.984775"},after:{score:"1.303775",retained:["1101","310"],removed:[]},
 result:{delta:"0.319000",baseline:"0.984775",proposed:"1.303775"}};
const VERIFIED_S05="For ST-4003, adding APP-100.12 changes the assortment coefficient score from 1.047585 to 1.047585 (difference 0.000000). "+
 "Retained classes: 1001, 1101, 318, 320, 411, 413, 505, 509, 601, 605, 706, 707, 801; superseded classes: 1003, 506. "+
 "The score is a dimensionless coefficient, not a sales forecast.\n\n"+
 "Assortment coefficient score: 1.047585 → 1.047585\nDifference: 0.000000\n"+
 'Retained classes: ["1001","1101","318","320","411","413","505","509","601","605","706","707","801"]\nSuperseded classes: ["1003","506"]\n'+
 "Assumption: each distinct mapped class counts once; segment-specific coefficients, then channel/format factor. This is not a sales forecast.";
const rules=(text:string,calc:UpliftResult|UpliftResult[]=S05)=>upliftContradictions(text,calc).map(c=>c.rule);
const evidence=(path:string)=>{
 const d=JSON.parse(fs.readFileSync(path,"utf8"));
 return {text:String(d.renderedAnswer),calcs:d.toolTrace.filter((t:any)=>t.name==="calculate_uplift").map((t:any)=>t.result) as UpliftResult[]};
};

test("the verified S05 rendering is consistent with itself",()=>{
 assert.deepEqual(upliftContradictions(VERIFIED_S05,S05),[]);
});

test("sentences split on terminal punctuation and newlines but keep decimals and class lists whole",()=>{
 assert.deepEqual(sentences("Score 1.047585 stays. Next line\nRetained classes: 1001, 506; superseded classes: 1003."),
  ["Score 1.047585 stays.","Next line","Retained classes: 1001, 506;","superseded classes: 1003."]);
});

test("a denial of supersession beside superseded classes is flagged",()=>{
 for(const say of ["There is no class supersession.","No classes are superseded.","Nothing is superseded here.","Class supersession does not apply.",
  "None of the classes are superseded.","Superseded classes: none.","This happens without any supersession.","Those classes aren't superseded."])
  assert.ok(rules(`${VERIFIED_S05}\n\n${say}`).includes("denies supersession"),say);
});

test("statements that agree with the superseded classes are not flagged",()=>{
 for(const say of ["Regarding class supersession:","Classes 1003 and 506 are superseded.","Class 1003 is superseded by 1001, so it does not count.",
  "Here's the score change information you requested:","APP-100.12 is in margin class 318, which the store already has, so the score does not increase."])
  assert.deepEqual(rules(say),[],say);
});

test("wrong superseded or retained sets are flagged",()=>{
 assert.deepEqual(rules("Superseded classes: 1003."),["wrong superseded set"]);
 assert.deepEqual(rules("Superseded classes: 1003, 506, 318."),["wrong superseded set"]);
 assert.deepEqual(rules("Retained classes: 1001, 1101."),["wrong retained set"]);
 assert.deepEqual(rules("Class 318 is superseded."),["wrong superseded set"]);
 assert.deepEqual(rules("Classes 1003 and 318 are superseded."),["wrong superseded set"]);
 assert.deepEqual(rules("APP-100.12 has been superseded at ST-4003."),[]);
 assert.deepEqual(rules("Some classes are superseded.",S06),["claims supersession"]);
});

test("money and forecast claims are flagged; the forecast caveat is not",()=>{
 assert.deepEqual(rules("That is worth about $12,000 a month."),["money figure"]);
 assert.deepEqual(rules("Expect roughly 500 EUR more per week."),["money figure"]);
 assert.deepEqual(rules("This should lift revenue at the store."),["forecast claim"]);
 assert.deepEqual(rules("We forecast stronger summer sales."),["forecast claim"]);
 assert.deepEqual(rules("The score is not a sales forecast and carries no revenue meaning."),[]);
});

test("change claims must agree with the verified delta",()=>{
 assert.deepEqual(rules("The score increases with this code."),["claims a change"]);
 assert.deepEqual(rules("Adding it lowers the coefficient."),["claims a change"]);
 assert.deepEqual(rules("The score does not increase."),[]);
 assert.deepEqual(rules("There is no change to the score."),[]);
 assert.deepEqual(rules("There is no change to the score.",S06),["claims no change"]);
 assert.deepEqual(rules("The score stays the same.",S06),["claims no change"]);
 assert.deepEqual(rules("The score drops after closing the gaps.",S06),["wrong direction"]);
 assert.deepEqual(rules("The score rises from 0.984775 to 1.303775 (difference 0.319000).",S06),[]);
 assert.deepEqual(rules("Score after closing the gaps: 1.310000.",S06),["unverified figure"]);
 assert.deepEqual(rules("Difference: +0.319000",S06),[]);
});

test("with several calculations a sentence passes when it matches any of them",()=>{
 const other:UpliftResult={before:{score:"0.984775"},after:{score:"1.010625",retained:["1101"],removed:[]},result:{delta:"0.025850"}};
 assert.deepEqual(rules("Assortment coefficient score: 0.984775 → 1.010625",[S06,other]),[]);
 assert.deepEqual(rules("Assortment coefficient score: 0.984775 → 1.999999",[S06,other]),["unverified figure"]);
 assert.deepEqual(upliftContradictions("anything",[]),[]);
});

test("RED on recorded evidence: production f823b5 and staging b2821c S05 answers deny supersession",()=>{
 for(const path of ["qa_evidence/runs/20261014T224119Z-acceptance-f823b5/S05/s05.json","qa_evidence/staging/runs/20261015T081921Z-acceptance-b2821c/S05/s05.json"]){
  const {text,calcs}=evidence(path);
  const found=upliftContradictions(text,calcs);
  assert.deepEqual(found.map(c=>[c.rule,c.sentence]),[["denies supersession","There is no class supersession."]],path);
 }
});

test("GREEN on recorded clean S05 answers, including ones with a partial-reply notice",()=>{
 const paths=["qa_evidence/staging/runs/20261015T084429Z-acceptance-a8f0bf/S05/s05.json","qa_evidence/staging/runs/20261015T075452Z-acceptance-5d9a10/S05/s05.json",
  "qa_evidence/staging/runs/20261014T222033Z-acceptance-f24ec8/S05/s05.json","qa_evidence/staging/runs/20261014T215328Z-acceptance-c17a74/S05/s05.json",
  "qa_evidence/staging/runs/20261015T090052Z-acceptance-9d5398/S05/s05.json","qa_evidence/runs/20261011T194954Z-acceptance-96ca6e/S05/s05.json"];
 for(const path of paths){
  const {text,calcs}=evidence(path);
  assert.equal(calcs.length,1,path);
  assert.deepEqual(upliftContradictions(text,calcs),[],path);
 }
});
