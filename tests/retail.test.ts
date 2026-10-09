import test from "node:test";
import assert from "node:assert/strict";
import {loadFixtures} from "../src/fixtures.ts";
import {scoreStore,compareScores,retainedClasses,decimalMicro,formatMicro} from "../src/retail.ts";
const set=loadFixtures();const t="northside-outfitters";
test("ST-4003 fixture score and duplicate margin class",()=>{
 const before=scoreStore(set,t,"ST-4003")!,after=scoreStore(set,t,"ST-4003",["APP-100.12"])!;
 assert.equal(before.score,"1.047585");assert.equal(after.score,"1.047585");
 assert.equal(compareScores(before,after).delta,"0.000000");
 assert.ok(before.unmapped.includes("APP-100.99"));
});
test("ST-4007 uplift, transitive supersession and duplicate class",()=>{
 const before=scoreStore(set,t,"ST-4007")!;
 const after=scoreStore(set,t,"ST-4007",["APP-100.11","APP-100.12","APP-100.13","APP-169.16"])!;
 assert.equal(before.score,"0.984775");assert.equal(after.score,"1.100550");
 assert.equal(compareScores(before,after).delta,"0.115775");
 assert.ok(after.retained.includes("318"));assert.ok(after.removed.includes("321"));
});
test("no invented baseline or percentage",()=>{
 const s=scoreStore(set,t,"ST-4007")!;const result=compareScores(s,s);
 assert.equal(result.scenarioValue,undefined);assert.match(result.caveat,/not sales/);
});
test("cycle rejected, valid diamond accepted",()=>{
 const dag=new Map([["318",["319","321"]],["319",["321"]],["321",[]]]);
 assert.deepEqual(retainedClasses(new Set(["318","319","321"]),dag),{retained:["318"],removed:["319","321"]});
 assert.throws(()=>retainedClasses(new Set(["318","319"]),new Map([["318",["319"]],["319",["318"]]])),/Cyclic/);
});
test("full precision decimals",()=>{assert.equal(decimalMicro("1.123456"),1123456n);assert.equal(formatMicro(decimalMicro("-2.04")),"-2.040000");});
