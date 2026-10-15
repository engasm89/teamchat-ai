/** Create (or re-key) a runtime login as the migration owner, without the
 * plaintext password ever reaching the server or its statement log: the role
 * is given a SCRAM-SHA-256 verifier computed here. The role gets no
 * memberships and no privileged attributes; run provision-runtime-role.ts next.
 * Usage: MIGRATION_DATABASE_URL=... DB_RUNTIME_ROLE=teamchat_api_staging RUNTIME_ROLE_PASSWORD=... \
 *   node --experimental-strip-types scripts/db/create-runtime-login.ts */
import crypto from "node:crypto";
import {createPgPool,runtimeRoleName} from "../../src/server/database.ts";

const url=process.env.MIGRATION_DATABASE_URL,password=process.env.RUNTIME_ROLE_PASSWORD;
if(!url)throw Error("MIGRATION_DATABASE_URL (the migration owner) is required");
if(!password||password.length<24)throw Error("RUNTIME_ROLE_PASSWORD (at least 24 characters) is required");
const role=runtimeRoleName();

function scramVerifier(secret:string,salt=crypto.randomBytes(16),iterations=4096):string{
 const salted=crypto.pbkdf2Sync(secret.normalize("NFKC"),salt,iterations,32,"sha256");
 const clientKey=crypto.createHmac("sha256",salted).update("Client Key").digest();
 const storedKey=crypto.createHash("sha256").update(clientKey).digest();
 const serverKey=crypto.createHmac("sha256",salted).update("Server Key").digest();
 return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

const pool=await createPgPool(url);
const c=await pool.connect();
try{
 const me=(await c.query<{u:string}>("SELECT current_user AS u")).rows[0]!.u;
 if(me===role)throw Error("Connect as the migration owner, not the runtime role");
 const exists=(await c.query("SELECT 1 FROM pg_roles WHERE rolname=$1",[role])).rows.length===1;
 const ident=`"${role}"`,verifier=scramVerifier(password).replace(/'/g,"''");
 // Changing other attributes on ALTER needs privileges the owner may lack; the check below verifies them all.
 await c.query(exists?`ALTER ROLE ${ident} LOGIN PASSWORD '${verifier}'`
  :`CREATE ROLE ${ident} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${verifier}'`);
 const db=(await c.query<{d:string}>("SELECT current_database() AS d")).rows[0]!.d;
 await c.query(`REVOKE CONNECT ON DATABASE "${db}" FROM PUBLIC`);
 await c.query(`GRANT CONNECT ON DATABASE "${db}" TO ${ident}`);
 const check=await c.query<{super:boolean;bypass:boolean;members:string[]}>(
  "SELECT r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication AS super,r.rolbypassrls AS bypass,ARRAY(SELECT b.rolname::text FROM pg_auth_members m JOIN pg_roles b ON b.oid=m.roleid WHERE m.member=r.oid) AS members FROM pg_roles r WHERE r.rolname=$1",[role]);
 const r=check.rows[0]!;
 if(r.super||r.bypass||r.members.length)throw Error(`${role} is privileged or has memberships ${r.members.join(",")}`);
 console.log(JSON.stringify({role,created:!exists,database:db,memberships:r.members}));
}finally{c.release();await pool.end();}
