import {loadFixtures} from "../src/fixtures.ts";
import {TENANTS} from "../src/types.ts";
const set=loadFixtures();
console.log(JSON.stringify({products:set.productRows.length,unmapped:set.productRows.filter(p=>p.margin_class===null).length,
 classes:set.marginRows.length,coefficients:set.segmentRows.length,
 stores:Object.fromEntries(TENANTS.map(t=>[t,set.storesByTenant[t].length])),
 memories:Object.fromEntries(TENANTS.map(t=>[t,set.memoriesByTenant[t].length])),hashes:set.hashes},null,2));
