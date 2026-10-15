/** A throwaway local PostgreSQL 17 cluster (with pgvector) for integration tests.
 * Roles mirror Cloud SQL: the schema owner is NOT a superuser, so FORCE RLS
 * applies to it, and the runtime role has only the grants in
 * db/provision_runtime_role.sql. Nothing here touches a shared database. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import crypto from "node:crypto";
import {execFileSync,spawnSync} from "node:child_process";

export const PG_BIN=process.env.PG_BIN??"/opt/homebrew/opt/postgresql@17/bin";
const freePort=()=>new Promise<number>(resolve=>{const s=net.createServer().listen(0,()=>{const p=(s.address() as net.AddressInfo).port;s.close(()=>resolve(p));});});

export interface LocalCluster {
 port:number;ownerPassword:string;runtimePassword:string;
 url(user:"teamchat_owner"|"teamchat_api",db?:string):string;
 superuser(sql:string,db?:string):string;
 createDatabase(name:string):void;
 stop():void;
}
export async function startLocalCluster():Promise<LocalCluster>{
 if(!fs.existsSync(path.join(PG_BIN,"initdb")))throw Error(`PostgreSQL binaries not found in ${PG_BIN}; set PG_BIN`);
 const data=fs.mkdtempSync(path.join(os.tmpdir(),"teamchat-it-pg-"));
 const socket=fs.mkdtempSync(path.join("/tmp","tcit-"));
 const port=await freePort();
 const ownerPassword=crypto.randomBytes(18).toString("hex"),runtimePassword=crypto.randomBytes(18).toString("hex");
 execFileSync(path.join(PG_BIN,"initdb"),["-D",data,"-U","postgres","--auth-local=trust","--auth-host=scram-sha-256","-E","UTF8"],{stdio:"ignore"});
 execFileSync(path.join(PG_BIN,"pg_ctl"),["-D",data,"-l",path.join(data,"server.log"),"-w","-o",`-p ${port} -k ${socket} -c listen_addresses=127.0.0.1`,"start"],{stdio:"ignore"});
 const superuser=(sql:string,db="postgres")=>execFileSync(path.join(PG_BIN,"psql"),["-X","-A","-t","-q","-v","ON_ERROR_STOP=1","-h",socket,"-p",String(port),"-U","postgres","-d",db,"-c",sql],{encoding:"utf8"}).trim();
 superuser(`CREATE ROLE teamchat_owner LOGIN PASSWORD '${ownerPassword}' NOSUPERUSER NOBYPASSRLS`);
 superuser(`CREATE ROLE teamchat_api LOGIN PASSWORD '${runtimePassword}' NOSUPERUSER NOBYPASSRLS`);
 return {port,ownerPassword,runtimePassword,superuser,
  url:(user,db="teamchat")=>`postgres://${user}:${user==="teamchat_owner"?ownerPassword:runtimePassword}@127.0.0.1:${port}/${db}`,
  createDatabase(name){
   superuser(`CREATE DATABASE ${name} OWNER teamchat_owner`);
   // Cloud SQL grants extension creation through cloudsqlsuperuser; here the
   // superuser installs them so the owner's IF NOT EXISTS is a no-op.
   superuser("CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS vector;",name);
  },
  stop(){spawnSync(path.join(PG_BIN,"pg_ctl"),["-D",data,"-m","fast","stop"]);fs.rmSync(data,{recursive:true,force:true});fs.rmSync(socket,{recursive:true,force:true});}};
}
