import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../app/page.js", import.meta.url), "utf8");
const contract = fs.readFileSync(new URL("../lib/contract.js", import.meta.url), "utf8");

test("registration allowance uses the deployed AGENT_STAKE getter", () => {
  assert.doesNotMatch(contract, /export const AGENT_STAKE\s*=\s*\d+/);
  assert.match(page, /functionName:\s*"AGENT_STAKE"/);
  assert.match(page, /args:\s*\[CONTRACT_ADDRESS,\s*agentStake\]/);
  assert.match(page, /disabled=\{wrongNetwork \|\| noContract \|\| agentStake == null\}/);
});
