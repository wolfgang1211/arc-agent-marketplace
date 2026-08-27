const assert = require("node:assert/strict");
const hre = require("hardhat");

const settings = hre.config.solidity?.compilers?.[0]?.settings;
assert.ok(settings, "Hardhat Solidity settings are missing");
assert.equal(
  settings.evmVersion,
  "cancun",
  `Expected settings.evmVersion to be exactly cancun, got ${settings.evmVersion}`,
);

console.log("Hardhat EVM target is pinned to cancun.");
