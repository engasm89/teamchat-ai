import test from "node:test";
import assert from "node:assert/strict";
import {assertMatchingPersistedTool} from "../src/worker/gemini.ts";

test("AI retry may reuse an operation only when its name and arguments match",()=>{
 const original={name:"get_store_assortment",arguments:{store_id:"ST-4003",options:{sort:"asc",limit:2}}};
 assert.doesNotThrow(()=>assertMatchingPersistedTool(original,"get_store_assortment",{options:{limit:2,sort:"asc"},store_id:"ST-4003"}));
 assert.throws(()=>assertMatchingPersistedTool(original,"get_store_assortment",{store_id:"ST-4007",options:{sort:"asc",limit:2}}),/diverged/);
 assert.throws(()=>assertMatchingPersistedTool(original,"search_catalog",{store_id:"ST-4003",options:{sort:"asc",limit:2}}),/diverged/);
 assert.doesNotThrow(()=>assertMatchingPersistedTool(null,"search_catalog",{query:"AC"}));
});
