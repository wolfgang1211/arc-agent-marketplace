import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../app/page.js", import.meta.url), "utf8");

test("walletless visitors render the marketplace instead of an early wallet gate", () => {
  assert.doesNotMatch(page, /if\s*\(!isConnected\)\s*\{\s*return\s*\(/);
  assert.match(page, /<MetricCard label="Open on page"/);
  assert.match(page, /<h2>Available jobs<\/h2>/);
  assert.match(page, /<h2>Recommended agents<\/h2>/);
});

test("walletless write controls explain that a wallet is required", () => {
  for (const copy of [
    "Connect wallet to register as an agent",
    "Connect wallet to post a job",
    "Connect wallet to accept job",
    "Connect wallet to submit delivery",
    "Connect wallet to approve and pay",
    "Connect wallet to dispute job",
    "Connect wallet to settle job",
    "Connect wallet to cancel job",
    "Connect wallet to withdraw stake",
  ]) {
    assert.match(page, new RegExp(copy));
  }
});
