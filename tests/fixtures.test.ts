import test from "node:test";
import assert from "node:assert/strict";
import {loadFixtures,parseCsv} from "../src/fixtures.ts";
import {TENANTS} from "../src/types.ts";
const set=loadFixtures();
test("CSV parser handles quoted comma and embedded newline",()=>{
 const data='code,description\n"abc","hello, world"\n"z","two\nlines"\n';
 assert.deepEqual(parseCsv(data),[{code:"abc",description:"hello, world"},{code:"z",description:"two\nlines"}]);
});
test("all five unchanged fixtures are parsed and integrity-checked",()=>{
 assert.equal(set.productRows.length,1000);assert.equal(set.productRows.filter(p=>!p.margin_class).length,289);
 assert.equal(set.marginRows.length,44);assert.equal(set.segmentRows.length,12);
 for(const t of TENANTS){assert.equal(set.storesByTenant[t].length,12);assert.equal(set.memoriesByTenant[t].length,4);}
 assert.equal(Object.keys(set.hashes).length,5);
});
