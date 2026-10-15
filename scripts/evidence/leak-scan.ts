/** Looks for credentials in everything that could be published: tracked and
 * untracked (non-ignored) files, this branch's diff against main, and any extra
 * paths given. Exact secrets come from the macOS Keychain (every teamchat-ai*
 * entry) and Secret Manager (the database URLs); shapes catch the rest. Prints
 * only labels and file names, never a secret. Exit 1 on any hit.
 *   node --experimental-strip-types scripts/evidence/leak-scan.ts [extra files...] */
import fs from "node:fs";
import {execFileSync} from "node:child_process";

const run=(cmd:string,args:string[])=>execFileSync(cmd,args,{encoding:"utf8",stdio:["ignore","pipe","ignore"],maxBuffer:1<<30});

const secrets:Array<{label:string;value:string}>=[];
const entries=new Set<string>();
for(const record of run("security",["dump-keychain"]).split(/^keychain:/m)){
 const svce=/"svce"<blob>="([^"]+)"/.exec(record)?.[1],acct=/"acct"<blob>="([^"]+)"/.exec(record)?.[1];
 if(svce&&acct)entries.add(`${acct}\u0000${svce}`);
}
for(const entry of entries){
 const [account,svc]=entry.split("\u0000") as [string,string];
 if(!svc.startsWith("teamchat-ai"))continue;
 const value=run("security",["find-generic-password","-s",svc,"-a",account,"-w"]).trim();
 if(value.length>=8)secrets.push({label:`keychain ${svc} entry #${secrets.length+1}`,value});
}
for(const name of ["teamchat-database-url","teamchat-staging-database-url"]){
 const url=run("gcloud",["secrets","versions","access","latest","--secret",name,"--project","focus-clean-4b9f4"]).trim();
 const password=/^postgres(?:ql)?:\/\/[^:]+:([^@]+)@/.exec(url)?.[1];
 if(password){secrets.push({label:`${name} password`,value:password},{label:`${name} password (decoded)`,value:decodeURIComponent(password)});}
}
const shapes:Array<[string,RegExp]>=[
 ["postgres URL with a password",/postgres(?:ql)?:\/\/[^:\s/@"'`]+:(?!\$\{|<|password|\*)[^@\s"'`]{6,}@/],
 ["JSON web token",/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
 ["private key",/-----BEGIN [A-Z ]*PRIVATE KEY-----/],
 ["refresh or access token field",/"(refreshToken|refresh_token|access_token)"\s*:\s*"[^"]{20,}"/],
];

const files=[...run("git",["ls-files","-co","--exclude-standard"]).split("\n").filter(Boolean),...process.argv.slice(2)];
const sources:Array<[string,string]>=[["git diff main...HEAD",run("git",["diff","main...HEAD"])]];
for(const f of files){
 if(f.startsWith("audit/"))throw Error("audit/ must never be tracked or publishable");
 try{const st=fs.statSync(f);if(st.isFile()&&st.size<64<<20)sources.push([f,fs.readFileSync(f,"latin1")]);}catch{}
}

const hits:string[]=[];
for(const [name,text] of sources){
 for(const s of secrets)if(text.includes(s.value))hits.push(`${name}: ${s.label}`);
 for(const [label,re] of shapes)if(re.test(text))hits.push(`${name}: ${label}`);
}
console.log(JSON.stringify({secretsChecked:secrets.length,shapes:shapes.length,sourcesScanned:sources.length,hits:hits.length}));
for(const h of hits)console.log(`HIT ${h}`);
process.exitCode=hits.length?1:0;
