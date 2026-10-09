import test from "node:test";
import assert from "node:assert/strict";
import {validateDispatchConfig} from "../src/server/task-dispatch.ts";

test("Cloud Tasks admission fails before serving requests with missing or unsafe OIDC configuration",()=>{
 const good={CLOUD_TASKS_QUEUE_PATH:"projects/test/locations/us-central1/queues/teamchat",
  CLOUD_TASKS_WORKER_URL:"https://private-worker.example",CLOUD_TASKS_AUDIENCE:"https://private-worker.example",
  CLOUD_TASKS_INVOKER_EMAIL:"queue-invoker@test.iam.gserviceaccount.com"};
 assert.equal(validateDispatchConfig(good).queue,good.CLOUD_TASKS_QUEUE_PATH);
 assert.throws(()=>validateDispatchConfig({...good,CLOUD_TASKS_WORKER_URL:"http://example.test"}),/Cloud Tasks/);
 assert.throws(()=>validateDispatchConfig({...good,CLOUD_TASKS_INVOKER_EMAIL:""}),/Cloud Tasks/);
 assert.throws(()=>validateDispatchConfig({...good,CLOUD_TASKS_QUEUE_PATH:"invalid"}),/Cloud Tasks/);
});