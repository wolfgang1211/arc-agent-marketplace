import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { categoryDistinctClients, currentEraCopy } from "../lib/profile.mjs";

const profilePagePath = fileURLToPath(new URL("../app/agents/[address]/page.js", import.meta.url));

test("current counters are unqualified before any slash", () => {
  assert.equal(currentEraCopy("Clients with an approved delivery", 0), "Clients with an approved delivery");
});

test("current counters are explicitly qualified after a slash", () => {
  assert.equal(
    currentEraCopy("Clients with an approved delivery", 2),
    "Clients with an approved delivery · Since last slash"
  );
});

test("category scores are converted to distinct-client counts", () => {
  assert.equal(categoryDistinctClients(0n), 0n);
  assert.equal(categoryDistinctClients(100n), 1n);
  assert.equal(categoryDistinctClients(400n), 4n);
  assert.equal(categoryDistinctClients(450n), null);
});

test("profile copy avoids overstated rate and raw point claims", async () => {
  const source = await readFile(profilePagePath, "utf8");

  assert.doesNotMatch(source, /approval rate/i);
  assert.doesNotMatch(source, /reputation score/i);
  assert.doesNotMatch(source, /points per distinct client/i);
  assert.match(source, /fromBlock: 0n/);
  assert.match(source, /Slashed \$\{slashCount\} time/);
  assert.match(source, /categoryDistinctClients\(score\)/);
});