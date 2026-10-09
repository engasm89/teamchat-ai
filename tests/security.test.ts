import test from "node:test";
import assert from "node:assert/strict";
import {loadFixtures} from "../src/fixtures.ts";
import {resolvedContext,NO_MATCH} from "../src/tenant.ts";
import {FixtureRepository} from "../src/repository.ts";
import {SourceLedger} from "../src/grounding.ts";
import {validateMemoryValue} from "../src/memory.ts";
import {FixtureEventLog,EventReducer} from "../src/events.ts";
const fixtures=loadFixtures();const repo=new FixtureRepository(fixtures);
const n=resolvedContext("test-northside-user","northside-outfitters");
const v=resolvedContext("test-valley-user","valley-home-goods");
test("forged/unresolved tenant contexts fail closed",()=>{
 assert.throws(()=>resolvedContext("buyer","unexpected-tenant"),/Unauthorized/);
 assert.throws(()=>repo.getStore({uid:"buyer",tenantId:"northside-outfitters"} as any,"ST-4003"),/Unauthorized/);
});
test("foreign store ID indistinguishable from unknown ID",()=>{
 const valleyId=fixtures.storesByTenant[v.tenantId][0]!.store_id;
 assert.deepEqual(repo.getStore(n,valleyId),repo.getStore(n,"ST-9999"));
 assert.deepEqual(repo.getStore(n,"ST-9999"),NO_MATCH);
});
test("shared key is isolated to each tenant",()=>{
 const k="q1_assortment_target";const north=repo.getMemory(n,k),valley=repo.getMemory(v,k);
 assert.ok("value" in north&&"value" in valley);if("value" in north&&"value" in valley)assert.notDeepEqual(north.value,valley.value);
});
test("nested or oversized memory is refused without mutation",()=>{
 const old=repo.listMemories(n).length;
 assert.equal(validateMemoryValue({owner:"Alice", nested:{role:"admin"}}).ok,false);
 assert.throws(()=>repo.saveMemory(n,{key:"nested_attack",room:"assortment-review",value:{a:[1,2]}},new Date().toISOString()),/Invalid memory/);
 assert.equal(repo.listMemories(n).length,old);
});
test("valid tenant-shared memory provenance comes from server ctx",()=>{
 const memory=repo.saveMemory(n,{key:"escalation_contact",room:"assortment-review",value:{contact:"Alex",deadline:"2026-10-16"}},"2026-10-09T00:00:00Z");
 assert.equal(memory.created_by,n.uid);assert.equal(repo.getMemory(n,"escalation_contact"),memory);
 assert.deepEqual(repo.getMemory(v,"escalation_contact"),NO_MATCH);
});
test("turn source ledger refuses hallucinated IDs and fields",()=>{
 const ledger=new SourceLedger(n,"turn-test");const code=repo.getProduct(n,"APP-100.12");assert.ok("catalog_code" in code);
 if("catalog_code" in code){const ref=ledger.add("catalog",code.catalog_code,code);
  assert.deepEqual(ledger.render({template:"catalog",ref,fields:["catalog_code","margin_class"]}).values,{catalog_code:"APP-100.12",margin_class:"318"});
  assert.throws(()=>ledger.render({template:"catalog",ref:"turn-test:valley-home-goods:catalog:APP-100.12",fields:["catalog_code"]}),/Invalid/);
  assert.throws(()=>ledger.render({template:"catalog",ref,fields:["invented_profit"]}),/Unsupported/);
 }
});
test("event replay preserves order, dedupes, and isolates tenants",()=>{
 const log=new FixtureEventLog(); const e1=log.send(n,"room1","id1","First"),e2=log.send(n,"room1","id2","Second");
 assert.equal(log.send(n,"room1","id1","First").eventId,e1.eventId);
 assert.throws(()=>log.send(n,"room1","id1","Altered"),/Conflicting/);
 assert.deepEqual(log.replay(n,"room1",1),[e2]);assert.deepEqual(log.replay(v,"room1"),[]);
 const reducer=new EventReducer();assert.equal(reducer.accept(e2),"gap");assert.equal(reducer.accept(e1),"applied");assert.equal(reducer.accept(e1),"duplicate");assert.equal(reducer.accept(e2),"applied");assert.equal(reducer.cursor,2);
});
