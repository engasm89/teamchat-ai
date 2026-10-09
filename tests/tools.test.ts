import test from "node:test";
import assert from "node:assert/strict";
import {loadFixtures} from "../src/fixtures.ts";
import {resolvedContext,NO_MATCH} from "../src/tenant.ts";
import {SourceLedger} from "../src/grounding.ts";
import {TOOL_DECLARATIONS,LocalToolExecutor} from "../src/tools.ts";
const fixtures=loadFixtures();const executor=new LocalToolExecutor(fixtures);
const north=resolvedContext("n1","northside-outfitters"),valley=resolvedContext("v1","valley-home-goods");
test("Gemini tools declare no tenant override",()=>{
 assert.equal(TOOL_DECLARATIONS.length,7);
 for(const d of TOOL_DECLARATIONS)assert.ok(!Object.keys(d.parameters.properties).some(x=>x.includes("tenant")));
});
test("catalog lookups return validated source references",async()=>{
 const l=new SourceLedger(north,"tool-1");const result=await executor.execute(north,"get_catalog_code",{catalog_code:"APP-100.12"},l);
 assert.ok(result&&typeof result==="object"&&"ref" in result);
 if(result&&typeof result==="object"&&"ref" in result){const ref=String(result.ref);assert.equal(l.resolve(ref,"margin_class"),"318");}
 const none=await executor.execute(north,"get_catalog_code",{catalog_code:"APP-999.99"},l);
 assert.deepEqual(none,NO_MATCH);
});
test("model cannot override tenant via tool args",async()=>{
 await assert.rejects(executor.execute(north,"get_store_assortment",{store_id:"ST-4003",tenantId:"valley-home-goods"},new SourceLedger(north,"t3")),/Unsupported tool argument/);
});
test("foreign store is same as unknown and prompt cannot elevate",async()=>{
 const foreign=fixtures.storesByTenant[valley.tenantId][0]!.store_id;
 const a=await executor.execute(north,"get_store_assortment",{store_id:foreign},new SourceLedger(north,"t4"));
 const b=await executor.execute(north,"get_store_assortment",{store_id:"ST-9999"},new SourceLedger(north,"t5"));
 assert.deepEqual(a,b);
});
test("calculate_uplift tool returns dimensionless data and source ledger",async()=>{
 const ledger=new SourceLedger(north,"t6");const result=await executor.execute(north,"calculate_uplift",{store_id:"ST-4007",add_codes:["APP-100.11","APP-100.12","APP-100.13","APP-169.16"]},ledger);
 assert.ok(result&&typeof result==="object"&&"result" in result);
 if(result&&typeof result==="object"&&"result" in result){assert.equal((result.result as any).delta,"0.115775");assert.equal(ledger.resolve(String((result as any).ref),"delta"),"0.115775");}
});
test("memory mutation is denied without explicit user consent",async()=>{
 await assert.rejects(executor.execute(north,"save_memory",{key:"new",room:"assortment-review",value:{owner:"A"}},new SourceLedger(north,"t7")),/consent/);
});
