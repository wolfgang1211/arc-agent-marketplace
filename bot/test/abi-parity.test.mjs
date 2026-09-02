import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { MARKETPLACE_ABI } from "../src/abi.mjs";

const artifactPath = new URL("../../contract/artifacts/contracts/AgentMarketplace.sol/AgentMarketplace.json", import.meta.url);
const artifact = JSON.parse(await readFile(artifactPath, "utf8"));

for (const entry of MARKETPLACE_ABI) {
  test(`bot ABI matches compiled contract: ${entry.type} ${entry.name}`, () => {
    const compiled = artifact.abi.find((candidate) => candidate.type === entry.type && candidate.name === entry.name);
    assert.ok(compiled, `missing compiled ${entry.type} ${entry.name}`);
    assert.deepEqual(shape(entry), shape(compiled));
  });
}

function shape(entry) {
  const value = { type: entry.type, name: entry.name };
  if (entry.stateMutability) value.stateMutability = entry.stateMutability;
  if (entry.anonymous != null) value.anonymous = entry.anonymous;
  if (entry.inputs) value.inputs = entry.inputs.map(parameterShape);
  if (entry.outputs) value.outputs = entry.outputs.map(parameterShape);
  return value;
}

function parameterShape(parameter) {
  const value = { name: parameter.name || "", type: parameter.type };
  if (parameter.indexed != null) value.indexed = parameter.indexed;
  if (parameter.components) value.components = parameter.components.map(parameterShape);
  return value;
}
