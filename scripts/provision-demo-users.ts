/** Opt-in provisioning for six REAL Firebase Auth users and tenant-scoped DB memberships.
 * Run only in an authorized assessment project. Never log plaintext passwords. */
import {createPgPool} from "../src/server/database.ts";
import {resolvedContext} from "../src/tenant.ts";
import {inTenantTransaction} from "../src/persistence/postgres.ts";
import {TENANTS,type TenantId} from "../src/types.ts";
interface Spec{email:string;password:string;tenant:TenantId;name:string;rooms:string[]}
const input=process.env.ASSESSMENT_USERS_JSON;
if(!input)throw Error("ASSESSMENT_USERS_JSON must contain exactly six designated users; no sample passwords are generated");
const specs=JSON.parse(input) as Spec[];
if(!Array.isArray(specs)||specs.length!==6||specs.some(s=>typeof s.email!=="string"||!s.email.includes("@")||typeof s.password!=="string"||s.password.length<12||!TENANTS.includes(s.tenant)||typeof s.name!=="string"||!s.name||!Array.isArray(s.rooms)||!s.rooms.length||s.rooms.some(r=>typeof r!=="string"))||TENANTS.some(t=>specs.filter(s=>s.tenant===t).length!==3)||new Set(specs.map(s=>s.email.toLowerCase())).size!==6)throw Error("Require exactly three unique valid users per tenant with strong passwords and rooms");
const authPath="firebase-admin/auth",appPath="firebase-admin/app";
const app=await import(appPath),api=await import(authPath);
if(!app.getApps().length)app.initializeApp();
const auth=api.getAuth();
// This script uses DBA credentials, NEVER runtime DATABASE_URL or the non-owner teamchat_api role.
const adminUrl=process.env.DATABASE_ADMIN_URL;if(!adminUrl)throw Error("DATABASE_ADMIN_URL required");
const db=await createPgPool(adminUrl);
try{
 for(const s of specs){
  let uid:string;
  try{uid=(await auth.getUserByEmail(s.email)).uid;}
  catch(e:unknown){if(!(e&&typeof e==="object"&&"code" in e&&e.code==="auth/user-not-found"))throw e;uid=(await auth.createUser({email:s.email,password:s.password,displayName:s.name,emailVerified:false,disabled:false})).uid;}
  const ctx=resolvedContext(uid,s.tenant);
  await inTenantTransaction(db,ctx,async c=>{
   const directory=await c.query("INSERT INTO teamchat.auth_directory(firebase_uid,tenant_id) VALUES($1,$2) ON CONFLICT (firebase_uid) DO UPDATE SET tenant_id=EXCLUDED.tenant_id WHERE teamchat.auth_directory.tenant_id=EXCLUDED.tenant_id RETURNING tenant_id",[uid,s.tenant]);
   if(directory.rows.length!==1)throw Error("Firebase UID is already assigned to a different tenant");
   await c.query("INSERT INTO teamchat.user_memberships(tenant_id,firebase_uid,display_name,role,active) VALUES($1,$2,$3,'member',true) ON CONFLICT (tenant_id,firebase_uid) DO UPDATE SET display_name=EXCLUDED.display_name,active=true",[s.tenant,uid,s.name]);
   for(const room of s.rooms){
    const check=await c.query("SELECT 1 FROM teamchat.rooms WHERE tenant_id=$1 AND room_id=$2",[s.tenant,room]);if(check.rows.length!==1)throw Error("Specified room missing");
    await c.query("INSERT INTO teamchat.room_memberships(tenant_id,room_id,firebase_uid) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",[s.tenant,room,uid]);
   }
  });
  console.log(`Provisioned ${s.tenant} account ${s.name}; credential not printed`);
 }
}finally{await db.end();}
