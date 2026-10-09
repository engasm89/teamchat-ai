import test from "node:test";
import assert from "node:assert/strict";
import {hasAiMention} from "../src/persistence/postgres.ts";

test("the explicit @AI wakeup recognizes punctuation and mixed case",()=>{
 for(const input of ["@AI compare stores", "Hi, @AI: calculate uplift", "(@ai) show memory", "Please ask @AI."])
  assert.equal(hasAiMention(input),true,input);
 for(const input of ["assistant compare stores", "support@ai.example.com", "before@aiplanner", "@AIsomething", "abc@AI"])
  assert.equal(hasAiMention(input),false,input);
});
