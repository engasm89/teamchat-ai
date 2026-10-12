/** Rotates the six reviewer passwords and revokes every earlier session, keeping each password
 * recoverable from the macOS Keychain at every step:
 *   1. the new password is staged in Keychain service teamchat-ai-reviewer-next and read back;
 *   2. Firebase is updated and refresh tokens are revoked;
 *   3. the new password must sign in, the old one must not, and a refresh token issued before the
 *      rotation must be refused;
 *   4. only then is the main item (teamchat-ai-reviewer) overwritten and the staged copy deleted.
 * If a step fails, the main item still holds the password Firebase accepts, or the staged item does.
 * Passwords reach Keychain through `security -i` on stdin, never argv, and are never printed or recorded.
 *   FIREBASE_PROJECT_ID=focus-clean-4b9f4 node --experimental-strip-types scripts/handoff/rotate-passwords.ts [--check]
 * --check signs in with the current passwords and looks the users up, changing nothing. */
import crypto from "node:crypto";
import {execFileSync} from "node:child_process";
import {initializeApp} from "firebase-admin/app";
import {getAuth} from "firebase-admin/auth";
import {RunRecorder,keychainPassword} from "../evidence/lib.ts";
import {ACCOUNTS,API_URL,APP_URL,bindDeployment,firebaseApiKey,sleep,type AccountKey} from "../acceptance/common.ts";

const MAIN="teamchat-ai-reviewer",STAGED="teamchat-ai-reviewer-next";
const HARNESS=["scripts/handoff/rotate-passwords.ts","scripts/acceptance/common.ts","scripts/evidence/lib.ts"];
const check=process.argv.includes("--check");
const projectId=process.env.FIREBASE_PROJECT_ID;
if(!projectId)throw Error("Set FIREBASE_PROJECT_ID");
const auth=getAuth(initializeApp({projectId}));
const keys=Object.keys(ACCOUNTS) as AccountKey[];

function newPassword():string{
 for(;;){const p=crypto.randomBytes(18).toString("base64url");if(/[A-Z]/.test(p)&&/[a-z]/.test(p)&&/\d/.test(p)&&!p.startsWith("-"))return p;}
}
function keychainWrite(service:string,account:string,password:string){
 execFileSync("security",["-i"],{input:`add-generic-password -U -s ${service} -a ${account} -w ${password}\n`,stdio:["pipe","ignore","inherit"]});
 if(keychainPassword(account,service)!==password)throw Error(`Keychain ${service} read-back mismatch for ${account}`);
}
async function signIn(email:string,password:string){
 const res=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseApiKey()}`,
  {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password,returnSecureToken:true})});
 const body=await res.json() as {localId?:string;refreshToken?:string;error?:{message:string}};
 return {ok:res.ok,uid:body.localId,refreshToken:body.refreshToken,error:body.error?.message};
}
async function refresh(token:string){
 const res=await fetch(`https://securetoken.googleapis.com/v1/token?key=${firebaseApiKey()}`,
  {method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"refresh_token",refresh_token:token})});
 const body=await res.json() as {error?:{message:string}};
 return {ok:res.ok,error:body.error?.message};
}

const {sourceSha,deployment}=bindDeployment();
const run=new RunRecorder({suite:check?"rotation-check":"rotation",environment:`production: ${APP_URL} + ${API_URL}`,sourceSha,deployment,harnessFiles:HARNESS,
 ...(check?{runsDir:"qa_evidence/scratch/dry-runs"}:{})});
try{
 await run.run(check?"ROTATION-CHECK":"ROTATION",check?"Current reviewer passwords sign in and match Firebase users (read-only)":"Six reviewer passwords rotated, earlier sessions revoked, new passwords only in Keychain",["D04"],async t=>{
  const rows:Array<Record<string,unknown>>=[];
  for(const k of keys){
   const email=ACCOUNTS[k].email,row:Record<string,unknown>={account:k};rows.push(row);
   const user=await auth.getUserByEmail(email);row.disabled=user.disabled;
   const old=keychainPassword(email,MAIN);
   const before=await signIn(email,old);row.oldPasswordSignedInBefore=before.ok;row.uidMatches=before.uid===user.uid;
   if(check||!before.ok||!before.refreshToken)continue;
   // Firebase stores the revocation time in whole seconds; a session started in that same second survives it.
   await sleep(2000);
   const startedAt=Date.now();
   const next=newPassword();
   keychainWrite(STAGED,email,next);row.staged=true;
   await auth.updateUser(user.uid,{password:next});
   await auth.revokeRefreshTokens(user.uid);
   const after=await auth.getUser(user.uid);
   row.sessionsRevokedAfterRotation=Date.parse(after.tokensValidAfterTime??"")>=Math.floor(startedAt/1000)*1000;
   row.newPasswordSignsIn=(await signIn(email,next)).ok;
   const stale=await signIn(email,old);row.oldPasswordRejected=!stale.ok;row.oldPasswordError=stale.error;
   const oldSession=await refresh(before.refreshToken);row.earlierRefreshTokenRefused=!oldSession.ok;row.earlierRefreshTokenError=oldSession.error;
   if(row.newPasswordSignsIn!==true)throw Error(`New password for ${k} does not sign in; it remains in Keychain service ${STAGED}`);
   keychainWrite(MAIN,email,next);
   execFileSync("security",["delete-generic-password","-s",STAGED,"-a",email],{stdio:"ignore"});
   row.keychainMainHoldsNewPassword=keychainPassword(email,MAIN)===next;
   row.rotatedAt=new Date().toISOString();
  }
  t.detail("accounts",rows).detail("keychain",{service:MAIN,staging:STAGED,writeMethod:"security -i on stdin (never argv)"}).detail("passwordsRecorded",false);
  t.assert("all six Firebase users are enabled",rows.every(r=>r.disabled===false),"enabled",rows.map(r=>[r.account,r.disabled]));
  t.assert(check?"the current Keychain passwords sign in as the expected users":"the pre-rotation Keychain passwords signed in as the expected users",
   rows.every(r=>r.oldPasswordSignedInBefore===true&&r.uidMatches===true),true,rows.map(r=>[r.account,r.oldPasswordSignedInBefore,r.uidMatches]));
  if(check)return;
  t.assert("every new password signs in",rows.every(r=>r.newPasswordSignsIn===true),true,rows.map(r=>[r.account,r.newPasswordSignsIn]));
  t.assert("every old password is rejected",rows.every(r=>r.oldPasswordRejected===true),true,rows.map(r=>[r.account,r.oldPasswordError]));
  t.assert("refresh tokens issued before the rotation are refused",rows.every(r=>r.earlierRefreshTokenRefused===true),true,rows.map(r=>[r.account,r.earlierRefreshTokenError]));
  t.assert("Firebase records the revocation time after the rotation started",rows.every(r=>r.sessionsRevokedAfterRotation===true),true,rows.map(r=>[r.account,r.sessionsRevokedAfterRotation]));
  t.assert("the Keychain main item holds each new password; no staged copy remains",rows.every(r=>r.keychainMainHoldsNewPassword===true),true,rows.map(r=>[r.account,r.keychainMainHoldsNewPassword]));
 });
}finally{run.finish();}
