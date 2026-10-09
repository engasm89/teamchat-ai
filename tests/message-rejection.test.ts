import test from "node:test";
import assert from "node:assert/strict";
import {isPermanentSendError} from "../src/server/http-socket.ts";

test("invalid and conflicting client messages get terminal rejection, not infinite retries",()=>{
 assert.equal(isPermanentSendError(Error("Invalid message command")),true);
 assert.equal(isPermanentSendError(Error("Conflicting duplicate client message ID")),true);
 assert.equal(isPermanentSendError(Error("Database temporarily unavailable")),false);
 assert.equal(isPermanentSendError(Error("connection closed")),false);
 assert.equal(isPermanentSendError("Invalid message command"),false);
});

import {sendDurableMessage} from "../src/persistence/postgres.ts";
import {resolvedContext} from "../src/tenant.ts";

test("invalid JSON command field types are permanently rejected without touching PostgreSQL",async()=>{
 const pool={connect:async()=>{throw Error("must not connect");}};
 const ctx=resolvedContext("signed-user","northside-outfitters");
 for(const data of [
  {roomId:2,clientMessageId:"message-1",body:"hello"},
  {roomId:"assortment-review",clientMessageId:{unexpected:true},body:"hello"},
  {roomId:"assortment-review",clientMessageId:"message-1",body:17},
  {roomId:"assortment-review",clientMessageId:"message-1",body:null},
 ])await assert.rejects(sendDurableMessage(pool as any,ctx,data as any),/Invalid message command/);
});
