import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createFileState } from "../src/state.mjs";

test("persists restart state atomically without serializing secrets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "arc-bot-state-"));
  const path = join(directory, "state.json");
  const state = createFileState(path);
  assert.equal(await state.load(), null);
  const value = { version: 1, wasRegistered: true, jobs: { "7": { phase: "submitted", submitTxHash: "0xabc" } } };
  await state.save(value);
  assert.deepEqual(await state.load(), value);
  const raw = await readFile(path, "utf8");
  assert.equal(raw.includes("privateKey"), false);
  assert.equal(raw.includes("PINATA_JWT"), false);
});
