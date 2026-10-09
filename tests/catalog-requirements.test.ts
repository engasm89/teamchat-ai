import {test} from "node:test";
import assert from "node:assert/strict";
import {loadFixtures} from "../src/fixtures.ts";
import {rankCatalog,normalizeCatalogCode,normalizeStoreId} from "../src/catalog-search.ts";
const fixture=loadFixtures();
test("two abbreviated categories cannot starve each other",()=>{
 const codes=rankCatalog(fixture.productRows,"AC and SSD",8).map(x=>x.catalog_code);
 assert.equal(codes.length,8);
 assert.ok(codes.some(x=>x.startsWith("APP-")));
 assert.ok(codes.some(x=>x.startsWith("ELC-")));
});
test("nonexistent goods never return a plausible unrelated product",()=>{
 assert.deepEqual(rankCatalog(fixture.productRows,"beekeeping veils",10),[]);
 assert.deepEqual(rankCatalog(fixture.productRows,"random nonexistent thing",10),[]);
});
test("buyer code punctuation and store numbers normalize without making up records",()=>{
 assert.equal(normalizeCatalogCode("app10012"),"APP-100.12");
 assert.equal(normalizeCatalogCode("app 100-12"),"APP-100.12");
 assert.equal(normalizeCatalogCode("APP-100.12"),"APP-100.12");
 assert.equal(normalizeCatalogCode("APP-100.123"),null);
 assert.equal(normalizeStoreId("4003"),"ST-4003");
 assert.equal(normalizeStoreId("ST4007"),"ST-4007");
 assert.equal(normalizeStoreId("VALLEY-4003"),null);
});
