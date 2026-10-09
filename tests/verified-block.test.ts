import {test} from "node:test";
import assert from "node:assert/strict";
import {verifiedToolBlock} from "../src/worker/verified-block.ts";
import {renderVerifiedBlock} from "../apps/web/src/verified.ts";
import {NO_MATCH} from "../src/tenant.ts";
test("unknown catalog items and absent decisions use explicitly truthful fixed server messages",()=>{
 assert.equal(renderVerifiedBlock(verifiedToolBlock("search_catalog",[])),"No matching product exists in the supplied catalog.");
 assert.equal(renderVerifiedBlock(verifiedToolBlock("search_memory",[])),"I have no record of that.");
 assert.equal(renderVerifiedBlock(verifiedToolBlock("get_store_assortment",NO_MATCH)),"No matching record is available in this workspace.");
 assert.equal(renderVerifiedBlock(verifiedToolBlock("get_store_assortment",JSON.parse(JSON.stringify(NO_MATCH)))),"No matching record is available in this workspace.");
});
test("a source-backed catalog answer retains code, margin mapping and source reference",()=>{
 const block=verifiedToolBlock("search_catalog",[{catalog_code:"APP-100.12",description:"Portable air conditioners",margin_class:"318",ref:"tenant:catalog:APP-100.12"}]);
 const display=renderVerifiedBlock(block);
 assert.match(display,/APP-100\.12/);assert.match(display,/318/);assert.match(display,/tenant:catalog/);
});
