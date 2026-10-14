/** Apply db/provision_runtime_role.sql for one runtime login, as the migration
 * owner. The role must already exist (create it with gcloud sql users create so
 * its password never passes through this script).
 * Usage: MIGRATION_DATABASE_URL=... DB_RUNTIME_ROLE=teamchat_api_staging node --experimental-strip-types scripts/db/provision-runtime-role.ts */
import fs from "node:fs";
import path from "node:path";
import {createPgPool,runtimeRoleName} from "../../src/server/database.ts";

const url=process.env.MIGRATION_DATABASE_URL;
if(!url)throw Error("MIGRATION_DATABASE_URL (the migration owner) is required");
const role=runtimeRoleName();
const sql=fs.readFileSync(path.resolve(import.meta.dirname,"../../db/provision_runtime_role.sql"),"utf8").replace(/\bteamchat_api\b/g,role);
const pool=await createPgPool(url);
const c=await pool.connect();
try{
 const me=(await c.query<{u:string}>("SELECT current_user AS u")).rows[0]!.u;
 if(me===role)throw Error("Connect as the migration owner, not the runtime role");
 await c.query(sql);
 const check=await c.query<{super:boolean;bypass:boolean}>("SELECT rolsuper AS super,rolbypassrls AS bypass FROM pg_roles WHERE rolname=$1",[role]);
 if(check.rows[0]?.super||check.rows[0]?.bypass)throw Error(`${role} is privileged; refusing to use it as a runtime role`);
 console.log(JSON.stringify({provisioned:role,database:(await c.query<{d:string}>("SELECT current_database() AS d")).rows[0]!.d}));
}finally{c.release();await pool.end();}
