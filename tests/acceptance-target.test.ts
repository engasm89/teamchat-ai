import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {loadTarget,readTarget,productionCollisions,assertRestartableTarget,type Target} from "../scripts/acceptance/target.ts";

const production=readTarget("config/targets/production.json");
const staging=readTarget("config/targets/staging.json");
const served=(map:Record<string,string[]>)=>(service:string)=>({urls:map[service]??[]});
const liveOk=served({
 [staging.apiService]:[staging.apiUrl,"https://teamchat-api-staging-abc-uc.a.run.app"],
 [staging.workerService]:[staging.workerUrl],
 [production.apiService]:[production.apiUrl,"https://teamchat-api-prod-uc.a.run.app"],
 [production.workerService]:[production.workerUrl],
});

test("live runners refuse to start without an explicit target",()=>{
 assert.throws(()=>loadTarget({}),/TEAMCHAT_TARGET/);
 assert.throws(()=>loadTarget({TEAMCHAT_TARGET:"../production"}),/bare target name/);
 assert.equal(loadTarget({TEAMCHAT_TARGET:"staging"}).apiService,staging.apiService);
});

test("acceptance scripts carry no production endpoints or service names",()=>{
 const files=["common.ts","live-client.ts","run-employer-acceptance.ts","target.ts","browser/run-browser.ts","browser/cut-proxy.ts"];
 const needles=[production.apiUrl,production.workerUrl,production.appUrl,production.project,`"${production.apiService}"`,`"${production.workerService}"`,production.databaseSecret,production.keychainService];
 for(const f of files){
  const src=fs.readFileSync(`scripts/acceptance/${f}`,"utf8");
  for(const n of needles)assert.ok(!src.includes(n),`${f} hardcodes ${n}`);
 }
});

test("the staging target shares no production identifier",()=>{
 assert.deepEqual(productionCollisions(staging,production),[]);
 assert.doesNotThrow(()=>assertRestartableTarget(staging,production,liveOk));
});

test("S19 refuses the production target and any target that reuses a production identifier",()=>{
 assert.throws(()=>assertRestartableTarget(production,production,liveOk),/Refusing S19/);
 const variants:Array<[string,Partial<Target>]>=[
  ["api service",{apiService:production.apiService}],
  ["worker service",{workerService:production.workerService}],
  ["api url",{apiUrl:production.apiUrl}],
  ["worker url",{workerUrl:production.workerUrl}],
  ["app url",{appUrl:production.appUrl}],
  ["database",{database:production.database}],
  ["secret",{databaseSecret:production.databaseSecret}],
  ["role",{dbRole:production.dbRole}],
  ["keychain",{keychainService:production.keychainService}],
  ["accounts",{accounts:{...staging.accounts,v3:production.accounts.v3}}],
 ];
 for(const [label,patch] of variants){
  const t={...staging,...patch};
  assert.ok(productionCollisions(t,production).length>0,label);
  assert.throws(()=>assertRestartableTarget(t,production,liveOk),/Refusing S19/,label);
 }
});

test("S19 refuses when the services it would restart are not the ones under test, or serve production",()=>{
 const wrongService=served({[staging.apiService]:["https://elsewhere.a.run.app"],[staging.workerService]:[staging.workerUrl],
  [production.apiService]:[production.apiUrl],[production.workerService]:[production.workerUrl]});
 assert.throws(()=>assertRestartableTarget(staging,production,wrongService),/does not serve/);
 const aliasOfProduction=served({[staging.apiService]:[staging.apiUrl,"https://teamchat-api-prod-uc.a.run.app"],[staging.workerService]:[staging.workerUrl],
  [production.apiService]:[production.apiUrl,"https://teamchat-api-prod-uc.a.run.app"],[production.workerService]:[production.workerUrl]});
 assert.throws(()=>assertRestartableTarget(staging,production,aliasOfProduction),/served by a production service/);
});
