#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const LIMIT = 24_000;
const WARN = 23_500;
const root = path.resolve(__dirname, "..");
const targets = [
  ["AgentMarketplaceV2", "contracts/AgentMarketplaceV2.sol:AgentMarketplaceV2"],
  ["OperatorCollateralVaultV2", "contracts/OperatorCollateralVaultV2.sol:OperatorCollateralVaultV2"],
];
function artifact(name) {
  const file = path.join(root, "artifacts-v2-runs50", "contracts", `${name}.sol`, `${name}.json`);
  if (!fs.existsSync(file)) throw new Error(`missing canonical artifact: ${file}`);
  return { file, value: JSON.parse(fs.readFileSync(file, "utf8")) };
}
function runtimeBytes(value) {
  const hex = value.deployedBytecode;
  if (!hex || !hex.startsWith("0x")) throw new Error("artifact has no deployed runtime");
  return (hex.length - 2) / 2;
}
function checkBytes(label, size) {
  if (size > LIMIT) throw new Error(`${label} runtime ${size} exceeds ${LIMIT}`);
  if (size > WARN) console.warn(`WARN ${label} runtime ${size} is above ${WARN}`);
}
function measureCanonical() {
  const result = { limit: LIMIT, warn: WARN, compiler: "0.8.28", evmVersion: "cancun", runs: 50, artifacts: [] };
  for (const [name, fq] of targets) {
    const { file, value } = artifact(name);
    const size = runtimeBytes(value);
    checkBytes(name, size);
    result.artifacts.push({ name, fq, file: path.relative(root, file), runtimeBytes: size, runtimeSha256: crypto.createHash("sha256").update(Buffer.from(value.deployedBytecode.slice(2), "hex")).digest("hex") });
  }
  return result;
}
if (require.main === module) console.log(JSON.stringify(measureCanonical(), null, 2));
module.exports = { LIMIT, WARN, runtimeBytes, checkBytes, measureCanonical };
