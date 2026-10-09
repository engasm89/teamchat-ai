import test from "node:test";
import assert from "node:assert/strict";
import {canSendInRoom} from "../apps/web/src/room-access.ts";

test("online socket does not authorize sending into an unlisted room",()=>{
 assert.equal(canSendInRoom([],"assortment-review","online"),false);
 assert.equal(canSendInRoom(["category-strategy"],"assortment-review","online"),false);
 assert.equal(canSendInRoom(["assortment-review"],"","online"),false);
 assert.equal(canSendInRoom(["assortment-review"],"assortment-review","connecting"),false);
 assert.equal(canSendInRoom(["assortment-review"],"assortment-review","online"),true);
});
