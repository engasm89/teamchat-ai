import test from 'node:test';
import assert from 'node:assert/strict';
import {renderVerifiedBlock} from '../apps/web/src/verified.ts';

test('authorized store results are readable and preserve evidence without inventing seasonal relevance',()=>{
 const result=renderVerifiedBlock({template:'get_store_assortment',result:{ref:'same-tenant-store',store:{store_id:'ST-4007',store_name:'Store 4007',channel:'physical',store_format:'medium',segment:'loyalty',carried_categories_2026:['APP-100.11'],suspected_gaps:[{catalog_code:'APP-169.16',description:'Known gap',evidence:'Fixture signal'}]}}});
 assert.match(result,/ST-4007/);assert.match(result,/Fixture signal/);
 assert.match(result,/not confirmed demand/);assert.match(result,/has not been inferred/);
 assert.match(result,/Source: same-tenant-store/);
});
test('a rejected memory value shows each field-level reason instead of raw JSON',()=>{
 const result=renderVerifiedBlock({template:'save_memory',result:{saved:false,validation_errors:[{field:'roster',issue:'Nested values and arrays are not allowed'}]}});
 assert.match(result,/^Not saved/);assert.match(result,/• roster: Nested values and arrays are not allowed/);
 assert.doesNotMatch(result,/"template"/);
 assert.match(renderVerifiedBlock({template:'save_memory',result:{saved:false,error:'Repair limit reached: nothing was stored'}}),/Not saved — Repair limit reached/);
 assert.match(renderVerifiedBlock({template:'save_memory',result:{saved:true,ref:'memory-ref',memory:{key:'escalation_contact',value:{name:'Dana'},created_by:'uid-1',created_at:'2026-10-11',source_room_id:'assortment-review'}}}),/Saved to shared memory: escalation_contact[\s\S]*Source: memory-ref/);
});
test('the two-option comparison renders the authoritative source-backed difference',()=>{
 const result=renderVerifiedBlock({template:'compare_assortment_options',result:{ref:'calculation-ref',store_id:'ST-4007',codes_a:['APP-100.11'],codes_b:['APP-100.12'],comparison:{baseline:'1.000000',option_a:{score:'1.500000',uplift:'0.500000',retained:['318'],removed:[]},option_b:{score:'1.250000',uplift:'0.250000',retained:['318'],removed:[]},difference_b_minus_a:'-0.250000',caveat:'Dimensionless only'}}});
 assert.match(result,/Difference \(B − A\): -0\.250000/);assert.match(result,/calculation-ref/);assert.match(result,/Dimensionless only/);
});
