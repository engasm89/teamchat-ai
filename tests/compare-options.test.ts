import test from 'node:test';
import assert from 'node:assert/strict';
import {loadFixtures} from '../src/fixtures.ts';
import {LocalToolExecutor} from '../src/tools.ts';
import {resolvedContext,NO_MATCH} from '../src/tenant.ts';
import {SourceLedger} from '../src/grounding.ts';
import {compareAlternatives,scoreStore} from '../src/retail.ts';
import {verifiedToolBlock} from '../src/worker/verified-block.ts';

const fixtures=loadFixtures();
const north=resolvedContext('buyer-north','northside-outfitters');
const valley=resolvedContext('buyer-valley','valley-home-goods');
const executor=new LocalToolExecutor(fixtures);

test('direct two-option comparison uses fixture math, transitive supersession and explicit B-minus-A',async()=>{
 const a={store_id:'ST-4007',option_a_codes:['APP-100.11'],option_b_codes:['APP-100.11','APP-100.12','APP-100.13','APP-169.16']};
 const result=await executor.execute(north,'compare_assortment_options',a,new SourceLedger(north,'compare-1')) as any;
 const before=scoreStore(fixtures,north.tenantId,'ST-4007')!;
 const one=scoreStore(fixtures,north.tenantId,'ST-4007',['APP-100.11'])!;
 const two=scoreStore(fixtures,north.tenantId,'ST-4007',['APP-100.11','APP-100.12','APP-100.13','APP-169.16'])!;
 assert.equal(result.comparison.baseline,before.score);
 assert.equal(result.comparison.option_a.score,one.score);
 assert.equal(result.comparison.option_b.score,two.score);
 const difference=compareAlternatives(before,one,two);
 assert.equal(result.comparison.difference_b_minus_a,difference.difference_b_minus_a);
 assert.ok(result.comparison.option_b.removed.includes('321'));
 assert.match(result.comparison.caveat,/not monetary/);
 assert.equal(verifiedToolBlock('compare_assortment_options',result).template,'compare_assortment_options');
});
test('duplicate class does not multiply uplift when comparing alternatives',async()=>{
 const result=await executor.execute(north,'compare_assortment_options',{store_id:'ST-4003',option_a_codes:['APP-100.11'],option_b_codes:['APP-100.11','APP-100.12']},new SourceLedger(north,'compare-2')) as any;
 assert.equal(result.comparison.difference_b_minus_a,'0.000000');
});
test('comparison is tenant bounded and an absent code cannot be invented',async()=>{
 const args={store_id:'ST-9999',option_a_codes:[],option_b_codes:[]};
 assert.deepEqual(await executor.execute(north,'compare_assortment_options',args,new SourceLedger(north,'no-store')),NO_MATCH);
 const other=fixtures.storesByTenant[valley.tenantId].find(s=>!fixtures.storesByTenant[north.tenantId].some(n=>n.store_id===s.store_id));
 if(other)assert.deepEqual(await executor.execute(north,'compare_assortment_options',{...args,store_id:other.store_id},new SourceLedger(north,'foreign')),NO_MATCH);
 assert.deepEqual(await executor.execute(north,'compare_assortment_options',{store_id:'ST-4003',option_a_codes:['NON-999.99'],option_b_codes:[]},new SourceLedger(north,'no-code')),NO_MATCH);
});
test('comparison forbids model-supplied tenant overrides and invalid code arrays',async()=>{
 await assert.rejects(executor.execute(north,'compare_assortment_options',{store_id:'ST-4003',option_a_codes:[],option_b_codes:[],tenant_id:'valley-home-goods'},new SourceLedger(north,'override')),/Unsupported tool argument/);
 await assert.rejects(executor.execute(north,'compare_assortment_options',{store_id:'ST-4003',option_a_codes:'APP-100.11',option_b_codes:[]},new SourceLedger(north,'invalid')),/Invalid add_codes/);
});
test('store 4007 without ST prefix resolves to the same verified comparison as ST-4007',async()=>{
 const codes={option_a_codes:['APP-100.11'],option_b_codes:['APP-100.12']};
 const first=await executor.execute(north,'compare_assortment_options',{store_id:'ST-4007',...codes},new SourceLedger(north,'full')) as any;
 const second=await executor.execute(north,'compare_assortment_options',{store_id:'4007',...codes},new SourceLedger(north,'short')) as any;
 assert.deepEqual(second.comparison,first.comparison);
});
