import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const profile = fs.readFileSync(new URL("../app/agents/[address]/page.js", import.meta.url), "utf8");
const contract = fs.readFileSync(new URL("../lib/contract.js", import.meta.url), "utf8");

test("agent profiles bound job history to one contract-sized page", () => {
  assert.match(profile, /PROFILE_JOB_LIMIT\s*=\s*100n/);
  assert.match(profile, /functionName:\s*"getJobsPaged"/);
  assert.doesNotMatch(profile, /Array\.from\(\{\s*length:\s*Math\.ceil/);
  assert.match(profile, /latest 100 marketplace jobs/i);
});

test("agent slash history starts at verified deployment metadata, never block zero", () => {
  assert.match(contract, /CONTRACT_DEPLOYMENT_BLOCK/);
  assert.match(profile, /queryKey:\s*\["agent-slashes",\s*CONTRACT_ADDRESS,\s*CONTRACT_DEPLOYMENT_BLOCK\?\.toString\(\),\s*address\]/);
  assert.match(profile, /fromBlock:\s*CONTRACT_DEPLOYMENT_BLOCK/);
  assert.doesNotMatch(profile, /fromBlock:\s*0n/);
});
