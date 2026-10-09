import test from "node:test";
import assert from "node:assert/strict";
import {loadFixtures} from "../src/fixtures.ts";
import {catalogQueryTerms,rankCatalog} from "../src/catalog-search.ts";
const products=loadFixtures().productRows;
test("portable AC ranks the exact portable air conditioner family ahead of unrelated air products",()=>{
 const candidates=rankCatalog(products,"portable AC",10);
 assert.ok(candidates.length>0);
 assert.ok(candidates.every(x=>x.product_family==="Portable air conditioners"));
 assert.equal(candidates[0]?.catalog_code,"APP-100.11");
});
test("SSD abbreviation expands inside retrieval, without routing tools",()=>{
 const terms=catalogQueryTerms("find SSD code");
 assert.deepEqual(terms,["solid","state","drives"]);
 const results=rankCatalog(products,"SSD",10);
 assert.ok(results.some(x=>/solid.state.drive/i.test(x.description)));
});
test("absent or trivial terms produce zero candidates, without invented catalog codes",()=>{
 assert.deepEqual(rankCatalog(products,"zzzz_missing_product",10),[]);
 assert.deepEqual(rankCatalog(products,"what is a product code",10),[]);
});
