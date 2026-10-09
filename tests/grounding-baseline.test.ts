import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalToolExecutor,TOOL_DECLARATIONS} from '../src/tools.ts';
import {loadFixtures} from '../src/fixtures.ts';
import {resolvedContext} from '../src/tenant.ts';
import {SourceLedger} from '../src/grounding.ts';

const north=resolvedContext('n1','northside-outfitters');
test('Gemini cannot introduce an unverified monetary baseline',async()=>{
 const tool=TOOL_DECLARATIONS.find(t=>t.name==='calculate_uplift')!;
 assert.ok(!Object.hasOwn(tool.parameters.properties,'monetary_baseline'));
 const local=new LocalToolExecutor(loadFixtures());
 await assert.rejects(local.execute(north,'calculate_uplift',{store_id:'ST-4007',add_codes:['APP-100.11'],monetary_baseline:'1000000'},new SourceLedger(north,'attack')),/Unsupported tool argument/);
 const verified=await local.execute(north,'calculate_uplift',{store_id:'ST-4007',add_codes:['APP-100.11']},new SourceLedger(north,'verified')) as any;
 assert.equal(verified.result.scenarioValue,undefined);
 assert.match(verified.result.caveat,/not sales/);
});
