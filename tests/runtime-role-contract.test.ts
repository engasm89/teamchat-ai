import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {join} from "node:path";

type Permission="SELECT"|"INSERT"|"UPDATE"|"DELETE";
const ops:Record<Permission,RegExp>={
 SELECT:/\b(?:FROM|JOIN)\s+teamchat\.([a-z_]+)/gi,
 INSERT:/\bINSERT\s+INTO\s+teamchat\.([a-z_]+)/gi,
 UPDATE:/\bUPDATE\s+teamchat\.([a-z_]+)/gi,
 DELETE:/\bDELETE\s+FROM\s+teamchat\.([a-z_]+)/gi,
};
function sourceFiles(dir:string):string[]{
 return readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
  const path=join(dir,entry.name);
  return entry.isDirectory()?sourceFiles(path):entry.isFile()&&entry.name.endsWith(".ts")?[path]:[];
 });
}
/** Static contract: runtime DML must be authorized by the least-privilege
 * role provisioning script. This is NOT a substitute for a real RLS test. */
export function missingRuntimePermissions(source:string,grants:string):string[]{
 const granted=new Map<string,Set<string>>();
 for(const statement of grants.matchAll(/\bGRANT\s+(SELECT|INSERT|UPDATE|DELETE)(?:\s*,\s*(?:SELECT|INSERT|UPDATE|DELETE))*\s+ON\s+([\s\S]*?)\s+TO\s+teamchat_api\s*;/gi)){
  const permissions=statement[0]!.slice(5,statement[0]!.search(/\sON\s/i)).split(",").map(x=>x.trim().toUpperCase());
  for(const name of statement[2]!.split(",")){
   const table=name.trim().replace(/^teamchat\./,"");
   if(!granted.has(table))granted.set(table,new Set());
   for(const permission of permissions)granted.get(table)!.add(permission);
  }
 }
 const missing:string[]=[];
 for(const [permission,expression] of Object.entries(ops) as Array<[Permission,RegExp]>){
  for(const match of source.matchAll(new RegExp(expression.source,expression.flags))){
   const table=match[1]!;
   if(!granted.get(table)?.has(permission))missing.push(`${permission} teamchat.${table}`);
  }
 }
 return [...new Set(missing)].sort();
}

test("runtime SQL operations are granted explicitly to nonowner teamchat_api",()=>{
 const source=sourceFiles("src").map(file=>readFileSync(file,"utf8")).join("\n");
 const grants=readFileSync("db/provision_runtime_role.sql","utf8");
 assert.deepEqual(missingRuntimePermissions(source,grants),[]);
 const withoutReclaimGrant=grants.replace(
  "GRANT DELETE ON teamchat.answer_blocks,teamchat.presence_leases TO teamchat_api;",
  "GRANT DELETE ON teamchat.presence_leases TO teamchat_api;");
 assert.deepEqual(missingRuntimePermissions(source,withoutReclaimGrant),["DELETE teamchat.answer_blocks"]);
});
