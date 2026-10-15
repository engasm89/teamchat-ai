/** Apply db/migrations/*.sql in order as the migration OWNER, recording each
 * file's SHA-256 in teamchat.schema_migrations and refusing to continue when an
 * applied file has changed. Every migration manages its own BEGIN/COMMIT and is
 * idempotent, so a crash between applying a file and recording it is repaired
 * by running this script again.
 *
 * Usage: MIGRATION_DATABASE_URL=postgres://owner@host/db node --experimental-strip-types scripts/db/migrate.ts [--dry-run]
 * A database migrated before tracking existed (001–007 applied by hand) is
 * recognised by its schema objects and baselined, never re-applied blindly. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {createPgPool} from "../../src/server/database.ts";

const dir=path.resolve(import.meta.dirname,"../../db/migrations");
const files=fs.readdirSync(dir).filter(f=>/^\d{3}_[a-z0-9_]+\.sql$/.test(f)).sort();
const migrations=files.map(f=>{const sql=fs.readFileSync(path.join(dir,f),"utf8");return {version:f.slice(0,-4),sql,sha256:crypto.createHash("sha256").update(sql).digest("hex")};});
const dryRun=process.argv.includes("--dry-run");
const url=process.env.MIGRATION_DATABASE_URL;
if(!url)throw Error("MIGRATION_DATABASE_URL (the migration owner, never the runtime role) is required");
const LEGACY_PROBES:Record<string,string>={
 "001_schema":"SELECT to_regclass('teamchat.rooms') IS NOT NULL AS present",
 "002_notifications":"SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname='publish_event_wakeup' AND pronamespace='teamchat'::regnamespace) AS present",
 "003_auth_grants":"SELECT to_regclass('teamchat.auth_directory') IS NOT NULL AS present",
 "004_ai_consent":"SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='teamchat' AND table_name='ai_jobs' AND column_name='memory_consent') AS present",
 "005_job_lookup":"SELECT to_regclass('teamchat.ai_job_directory') IS NOT NULL AS present",
 "006_ephemeral":"SELECT to_regclass('teamchat.typing_leases') IS NOT NULL AS present",
 "007_semantic_memory":"SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='teamchat' AND table_name='memories' AND column_name='embedding') AS present",
};
const pool=await createPgPool(url);
const c=await pool.connect();
try{
 const who=await c.query<{u:string;bypass:boolean;owner:string|null}>("SELECT current_user AS u,(SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user) AS bypass,(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=to_regclass('teamchat.rooms')) AS owner");
 const me=who.rows[0]!;
 if(/^teamchat_api/.test(me.u))throw Error("Refusing to migrate as an application runtime role");
 if(me.owner&&me.owner!==me.u){
  const member=await c.query<{ok:boolean}>("SELECT pg_has_role(current_user,$1,'USAGE') AS ok",[me.owner]);
  if(!member.rows[0]?.ok)throw Error(`Connected as ${me.u}, but the schema is owned by ${me.owner}`);
 }
 const tracked=(await c.query<{t:boolean}>("SELECT to_regclass('teamchat.schema_migrations') IS NOT NULL AS t")).rows[0]!.t;
 const applied=new Map<string,string>();
 if(tracked)for(const r of (await c.query<{version:string;sha256:string}>("SELECT version,sha256 FROM teamchat.schema_migrations")).rows)applied.set(r.version,r.sha256);
 const baseline:string[]=[];
 if(!tracked&&me.owner){
  for(const m of migrations){
   const probe=LEGACY_PROBES[m.version];if(!probe)break;
   const present=(await c.query<{present:boolean}>(probe)).rows[0]?.present;
   if(!present)throw Error(`Untracked database is missing ${m.version}; apply it deliberately before using this script`);
   baseline.push(m.version);
  }
 }
 for(const [v,sha] of applied){
  const m=migrations.find(x=>x.version===v);
  if(!m)throw Error(`Database records ${v}, which is not in db/migrations`);
  if(m.sha256!==sha)throw Error(`${v} changed after it was applied (recorded ${sha.slice(0,12)}, file ${m.sha256.slice(0,12)})`);
 }
 const pending=migrations.filter(m=>!applied.has(m.version)&&!baseline.includes(m.version));
 console.log(JSON.stringify({connectedAs:me.u,schemaOwner:me.owner,tracked,baseline,applied:[...applied.keys()],pending:pending.map(m=>m.version),dryRun}));
 if(dryRun)process.exit(0);
 const record=async(m:{version:string;sha256:string})=>{await c.query("INSERT INTO teamchat.schema_migrations(version,sha256) VALUES($1,$2) ON CONFLICT (version) DO NOTHING",[m.version,m.sha256]);};
 for(const m of pending){
  const started=Date.now();
  await c.query(m.sql);
  const exists=(await c.query<{t:boolean}>("SELECT to_regclass('teamchat.schema_migrations') IS NOT NULL AS t")).rows[0]!.t;
  if(exists){for(const v of baseline.splice(0))await record(migrations.find(x=>x.version===v)!);await record(m);}
  else baseline.push(m.version);
  console.log(JSON.stringify({applied:m.version,sha256:m.sha256,ms:Date.now()-started}));
 }
 if(baseline.length&&(await c.query<{t:boolean}>("SELECT to_regclass('teamchat.schema_migrations') IS NOT NULL AS t")).rows[0]!.t)
  for(const v of baseline.splice(0))await record(migrations.find(x=>x.version===v)!);
}finally{c.release();await pool.end();}
