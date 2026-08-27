import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { categoryDistinctClients, currentEraCopy } from "../lib/profile.mjs";

const profilePagePath = fileURLToPath(new URL("../app/agents/[address]/page.js", import.meta.url));
const buildRoots = [
  fileURLToPath(new URL("../.next/server/app/agents", import.meta.url)),
  fileURLToPath(new URL("../.next/static/chunks/app/agents", import.meta.url)),
];

async function javascriptFiles(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const path = `${root}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await javascriptFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(path);
  }
  return files;
}

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

test("profile source avoids overstated rate and raw point claims", async () => {
  const source = await readFile(profilePagePath, "utf8");

  assert.doesNotMatch(source, /approval rate/i);
  assert.doesNotMatch(source, /reputation score/i);
  assert.doesNotMatch(source, /points per distinct client/i);
  assert.doesNotMatch(source, /<[^>]+>\s*\{\s*score(?:\.toString\(\))?\s*\}/);
  assert.match(source, /fromBlock: 0n/);
  assert.match(source, /Slashed \$\{slashCount\} time/);
  assert.match(source, /categoryDistinctClients\(score\)/);
  assert.match(source, /Category counters are unavailable after a slash because the contract does not reset category history/);
  assert.match(source, /slashCount > 0/);
});

test("compiled profile artifacts cannot reintroduce forbidden trust claims", async () => {
  const files = (await Promise.all(buildRoots.map(javascriptFiles))).flat();
  assert.ok(files.length > 0, "profile build artifacts missing; run npm run build before npm test");

  const compiled = (await Promise.all(files.map((path) => readFile(path, "utf8")))).join("\n");
  assert.doesNotMatch(compiled, /approval rate/i);
  assert.doesNotMatch(compiled, /reputation score/i);
  assert.doesNotMatch(compiled, /points per distinct client/i);
  assert.doesNotMatch(compiled, /400 points/i);
  assert.match(compiled, /Since last slash/);
  assert.match(compiled, /distinct client/);
});