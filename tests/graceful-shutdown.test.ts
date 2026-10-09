import test from "node:test";
import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {installGracefulShutdown} from "../src/runtime/shutdown.ts";
class FakeRuntime extends EventEmitter { exitCode?:number; }
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test("SIGTERM invokes real cleanup once and unregisters both handlers",async()=>{
  const runtime=new FakeRuntime();let calls=0;
  installGracefulShutdown(async()=>{calls++;},runtime);
  runtime.emit("SIGTERM");runtime.emit("SIGINT");await tick();await tick();
  assert.equal(calls,1);
  assert.equal(runtime.listenerCount("SIGTERM"),0);
  assert.equal(runtime.listenerCount("SIGINT"),0);
  assert.equal(runtime.exitCode,undefined);
});

test("cleanup failure sets nonzero exit code without an unhandled rejection",async()=>{
  const runtime=new FakeRuntime(),errors:string[]=[];
  installGracefulShutdown(async()=>{throw Error("db pool close failed");},runtime,message=>errors.push(message));
  runtime.emit("SIGINT");await tick();await tick();
  assert.equal(runtime.exitCode,1);
  assert.match(errors[0]??"",/db pool close failed/);
});

test("cleanup hooks can be unregistered independently",()=>{
  const runtime=new FakeRuntime();const detach=installGracefulShutdown(async()=>{},runtime);
  detach();assert.equal(runtime.listenerCount("SIGTERM"),0);assert.equal(runtime.listenerCount("SIGINT"),0);
});
