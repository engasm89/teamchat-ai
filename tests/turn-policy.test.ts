import test from "node:test";
import assert from "node:assert/strict";
import {MemoryRepairBudget,toolAuditRecord} from "../src/worker/gemini.ts";
import {NO_MATCH,resolvedContext} from "../src/tenant.ts";
import {validateMemoryValue} from "../src/memory.ts";

const rejected=()=>{const v=validateMemoryValue({roster:[{name:"A"}]});assert.equal(v.ok,false);return {validation_errors:(v as {errors:unknown[]}).errors,saved:false};};

test("a rejected memory value gets exactly one repair attempt",()=>{
 const budget=new MemoryRepairBudget();
 assert.equal(budget.refusal("save_memory"),null);
 budget.observe("save_memory",rejected());
 assert.equal(budget.refusal("save_memory"),null,"one repair is allowed");
 budget.observe("save_memory",rejected());
 const refusal=budget.refusal("save_memory");
 assert.equal(refusal?.saved,false);
 assert.match(String(refusal?.error),/Repair limit reached/);
 assert.equal(budget.refusal("search_catalog"),null,"other tools are unaffected");
});

test("a successful repair or unrelated failures do not consume the repair budget",()=>{
 const budget=new MemoryRepairBudget();
 budget.observe("save_memory",rejected());
 budget.observe("save_memory",{saved:true,memory:{key:"escalation"}});
 budget.observe("save_memory",{saved:false,error:"Memory key already exists; revision required"});
 budget.observe("search_memory",rejected());
 assert.equal(budget.refusal("save_memory"),null);
});

test("tool audit records identify the attempt without logging result rows",()=>{
 const ctx=resolvedContext("uid-northside-buyer1","northside-outfitters");
 const base={ctx,roomId:"assortment-review",jobAttempt:1,operationId:"r0-c0",name:"get_store_assortment",args:{store_id:"ST-5001"},replayed:false};
 const first=toolAuditRecord({...base,turnId:"turn-1",triggerSequence:"41",result:NO_MATCH});
 const second=toolAuditRecord({...base,turnId:"turn-2",triggerSequence:"44",result:NO_MATCH});
 assert.equal(first.message,"ai_tool_call");
 assert.equal(first.tenantId,"northside-outfitters");
 assert.equal(first.outcome,"no_match");
 assert.deepEqual(first.requested,{store_id:"ST-5001"});
 assert.notEqual(first.turnId,second.turnId);
 assert.notEqual(first.triggerSequence,second.triggerSequence);
 const found=toolAuditRecord({...base,turnId:"turn-3",triggerSequence:1,result:{ref:"r",store:{store_id:"ST-4003",store_name:"Secret Name"}}});
 assert.equal(found.outcome,"results");
 assert.doesNotMatch(JSON.stringify(found),/Secret Name/);
});

test("memory audit records keep the key and field names, not the stored values",()=>{
 const ctx=resolvedContext("uid-northside-buyer1","northside-outfitters");
 const record=toolAuditRecord({ctx,turnId:"t",roomId:"assortment-review",triggerSequence:3,jobAttempt:2,operationId:"r1-c0",name:"save_memory",
  args:{key:"escalation_contact",room:"assortment-review",value_json:JSON.stringify({name:"Dana Private",phone:"555-0100"})},result:rejected(),replayed:true});
 assert.deepEqual(record.requested,{key:"escalation_contact",room:"assortment-review",fields:["name","phone"]});
 assert.equal(record.outcome,"validation_rejected");
 assert.equal(record.replayed,true);
 assert.doesNotMatch(JSON.stringify(record),/Dana Private|555-0100/);
 const fromMessage=toolAuditRecord({ctx,turnId:"t",roomId:"assortment-review",triggerSequence:3,jobAttempt:1,operationId:"r0-c0",name:"save_memory",
  args:{key:"k",room:"assortment-review",value_json:'{"a":1}'},result:rejected(),replayed:false,valueSource:"requester_message"});
 assert.equal((fromMessage.requested as Record<string,unknown>).valueSource,"requester_message");
});
