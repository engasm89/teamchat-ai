/** Reports every file under the given paths that contains one of the six reviewer passwords held
 * in the macOS Keychain, including files inside .zip archives. Only paths and account keys are
 * printed; passwords are read in-process and never written anywhere. Exits 1 if anything is found.
 *   node --experimental-strip-types scripts/handoff/scan-credentials.ts [--service <name>] <path>... */
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {keychainPassword} from "../evidence/lib.ts";
import {ACCOUNTS,type AccountKey} from "../acceptance/common.ts";

const args=process.argv.slice(2);
const service=args.includes("--service")?args.splice(args.indexOf("--service"),2)[1]!:"teamchat-ai-reviewer";
if(!args.length)throw Error("Give at least one path to scan");
const SKIP=new Set(["node_modules",".git"]);
const secrets=(Object.keys(ACCOUNTS) as AccountKey[]).map(k=>({k,value:Buffer.from(keychainPassword(ACCOUNTS[k].email,service))}));
const hits:string[]=[];let files=0;

const matches=(buf:Buffer)=>secrets.filter(s=>buf.includes(s.value)).map(s=>s.k);
function scanZip(file:string){
 for(const entry of execFileSync("unzip",["-Z1",file],{encoding:"utf8",maxBuffer:1<<26}).split("\n").filter(e=>e&&!e.endsWith("/"))){
  const found=matches(execFileSync("unzip",["-p",file,entry],{maxBuffer:1<<30}));files++;
  if(found.length)hits.push(`${file}!${entry}: ${found.join(",")}`);
 }
}
function walk(p:string){
 const st=fs.lstatSync(p);
 if(st.isSymbolicLink())return;
 if(st.isDirectory()){for(const e of fs.readdirSync(p))if(!SKIP.has(e))walk(path.join(p,e));return;}
 if(p.endsWith(".zip")){scanZip(p);return;}
 const found=matches(fs.readFileSync(p));files++;
 if(found.length)hits.push(`${p}: ${found.join(",")}`);
}
for(const p of args)walk(path.resolve(p));
console.log(`Keychain service ${service}: ${secrets.length} passwords, ${files} files scanned, ${hits.length} containing a password`);
for(const h of hits)console.log(h);
process.exit(hits.length?1:0);
