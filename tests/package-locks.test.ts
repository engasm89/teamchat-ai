import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,mkdirSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {verifyPackageLocks} from "../scripts/verify-package-locks.ts";

test("release preflight rejects missing or stale root and web npm lockfiles",()=>{
 const dir=mkdtempSync(join(tmpdir(),"teamchat-locks-"));
 try{
  mkdirSync(join(dir,"apps/web"),{recursive:true});
  const m={name:"mock-root",dependencies:{ws:"^8.18.3"}};
  const web={name:"mock-web",dependencies:{react:"^19.0.0"}};
  writeFileSync(join(dir,"package.json"),JSON.stringify(m));
  writeFileSync(join(dir,"apps/web/package.json"),JSON.stringify(web));
  assert.throws(()=>verifyPackageLocks(dir),/package-lock.json is required/);
  writeFileSync(join(dir,"package-lock.json"),JSON.stringify({name:m.name,lockfileVersion:3,packages:{"":{dependencies:{ws:"^8.18.3"}}}}));
  assert.throws(()=>verifyPackageLocks(dir),/package-lock.json is required/);
  writeFileSync(join(dir,"apps/web/package-lock.json"),JSON.stringify({name:web.name,lockfileVersion:3,packages:{"":{dependencies:{react:"^18.0.0"}}}}));
  assert.throws(()=>verifyPackageLocks(dir),/stale dependencies lock entry react/);
  writeFileSync(join(dir,"apps/web/package-lock.json"),JSON.stringify({name:web.name,lockfileVersion:3,packages:{"":{dependencies:{react:"^19.0.0"}}}}));
  assert.deepEqual(verifyPackageLocks(dir),[".","apps/web"]);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
