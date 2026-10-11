import test from "node:test";
import assert from "node:assert/strict";
import {score,stores,products} from "../scripts/acceptance/oracle.ts";
import {loadFixtures} from "../src/fixtures.ts";
import {scoreStore} from "../src/retail.ts";
import type {TenantId} from "../src/types.ts";

test("independent oracle and application agree on every store, alone and with each gap added",()=>{
 const fixtures=loadFixtures();let compared=0;
 for(const [tenant,list] of Object.entries(stores))for(const s of list){
  for(const add of [[],s.suspected_gaps.map(g=>g.catalog_code),["APP-100.12"]]){
   const expected=score(tenant,s.store_id,add),actual=scoreStore(fixtures,tenant as TenantId,s.store_id,add)!;
   assert.equal(actual.score,expected.score,`${s.store_id} +${add.join(",")}`);
   assert.deepEqual(actual.retained,expected.retained);assert.deepEqual(actual.removed,expected.removed);
   compared++;
  }
 }
 assert.equal(compared,72);
});

test("adding a code whose class the store already has changes nothing (ST-4003 + APP-100.12)",()=>{
 const base=score("northside-outfitters","ST-4003");
 const withHighEfficiency=score("northside-outfitters","ST-4003",["APP-100.12"]);
 assert.equal(products.get("APP-100.12")?.margin_class,"318");
 assert.ok(base.retained.includes("318"));
 assert.equal(withHighEfficiency.score,base.score);
 assert.deepEqual(base.removed,["1003","506"]);
});
