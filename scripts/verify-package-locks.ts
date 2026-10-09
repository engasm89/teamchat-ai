import {readFileSync} from "node:fs";

/** Docker uses npm ci, so an omitted or stale lockfile is a release defect. */
export function verifyPackageLocks(root=process.cwd()):string[] {
 const verified:string[]=[];
 for(const path of [".","apps/web"]){
  const dir=path==="."?root:`${root}/${path}`;
  const manifest=JSON.parse(readFileSync(`${dir}/package.json`,"utf8")) as {name:string;dependencies?:Record<string,string>;devDependencies?:Record<string,string>};
  let lock: {name?:string;lockfileVersion?:number;packages?:Record<string,{dependencies?:Record<string,string>;devDependencies?:Record<string,string>}>};
  try {lock=JSON.parse(readFileSync(`${dir}/package-lock.json`,"utf8"));}
  catch{throw Error(`${path}: package-lock.json is required for npm ci. Generate with npm install --package-lock-only in a networked build environment and commit it.`);}
  const entry=lock.packages?.[""];
  if(lock.name!==manifest.name||!lock.lockfileVersion||lock.lockfileVersion<2||!entry)throw Error(`${path}: invalid npm lockfile`);
  for(const category of ["dependencies","devDependencies"] as const){
   const deps=manifest[category]??{},locked=entry[category]??{};
   for(const [key,value] of Object.entries(deps))if(locked[key]!==value)throw Error(`${path}: stale ${category} lock entry ${key}`);
   for(const key of Object.keys(locked))if(!(key in deps))throw Error(`${path}: unexpected ${category} lock entry ${key}`);
  }
  verified.push(path);
 }
 return verified;
}
if(process.argv[1]?.endsWith("verify-package-locks.ts")){
 console.log(`Valid root/frontend npm lock manifests: ${verifyPackageLocks().join(", ")}`);
}