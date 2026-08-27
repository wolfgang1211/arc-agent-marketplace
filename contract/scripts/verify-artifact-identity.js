const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { keccak256 } = require("ethers");

const ROOT = path.resolve(__dirname, "..");
const IDENTITY_PATH = path.join(ROOT, "ARTIFACT-IDENTITY.json");
const CONTRACT_SOURCE = "contracts/AgentMarketplace.sol";
const CONTRACT_NAME = "AgentMarketplace";

function runHardhat(task) {
  const hardhatCli = path.join(ROOT, "node_modules", "hardhat", "internal", "cli", "cli.js");
  const result = spawnSync(process.execPath, [hardhatCli, task], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function rawBytecodeIdentity(bytecode, label) {
  assert.match(bytecode, /^0x[0-9a-fA-F]*$/, `${label} is not 0x-prefixed bytecode`);
  const bytes = Buffer.from(bytecode.slice(2), "hex");
  return {
    rawByteLength: bytes.length,
    keccak256: keccak256(bytecode),
  };
}

function installedVersion(packageName) {
  return readJson(path.join(ROOT, "node_modules", ...packageName.split("/"), "package.json")).version;
}

function packageLockSha256() {
  return `0x${crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(ROOT, "package-lock.json")))
    .digest("hex")}`;
}

function loadBuildInfo() {
  const directory = path.join(ROOT, "artifacts", "build-info");
  const candidates = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(directory, name));

  for (const candidate of candidates) {
    const buildInfo = readJson(candidate);
    if (buildInfo.output?.contracts?.[CONTRACT_SOURCE]?.[CONTRACT_NAME]) {
      return buildInfo;
    }
  }
  throw new Error(`No build-info entry found for ${CONTRACT_SOURCE}:${CONTRACT_NAME}`);
}

function collectBuildIdentity() {
  const buildInfo = loadBuildInfo();
  const compilerOutput = buildInfo.output.contracts[CONTRACT_SOURCE][CONTRACT_NAME].evm;
  const settings = buildInfo.input.settings;

  assert.equal(settings.evmVersion, "cancun", "Clean build-info evmVersion is not cancun");
  assert.equal(settings.optimizer?.enabled, true, "Optimizer must be enabled");
  assert.equal(settings.optimizer?.runs, 200, "Optimizer runs must be 200");

  return {
    contract: `${CONTRACT_SOURCE}:${CONTRACT_NAME}`,
    solcVersion: buildInfo.solcVersion,
    solcLongVersion: buildInfo.solcLongVersion,
    evmVersion: settings.evmVersion,
    optimizer: {
      enabled: settings.optimizer.enabled,
      runs: settings.optimizer.runs,
    },
    creationBytecode: rawBytecodeIdentity(
      `0x${compilerOutput.bytecode.object}`,
      "creation bytecode",
    ),
    deployedBytecode: rawBytecodeIdentity(
      `0x${compilerOutput.deployedBytecode.object}`,
      "deployed bytecode",
    ),
    toolchain: {
      hardhat: installedVersion("hardhat"),
      hardhatToolbox: installedVersion("@nomicfoundation/hardhat-toolbox"),
      openzeppelinContracts: installedVersion("@openzeppelin/contracts"),
      packageLockSha256: packageLockSha256(),
    },
  };
}

runHardhat("clean");
runHardhat("compile");
const actualBuild = collectBuildIdentity();

if (process.argv.includes("--write")) {
  const previous = fs.existsSync(IDENTITY_PATH) ? readJson(IDENTITY_PATH) : {};
  const identity = {
    schemaVersion: 1,
    hashDefinition:
      "Hashes are keccak256 over decoded raw bytecode bytes excluding the 0x prefix; creation bytecode excludes constructor arguments.",
    build: actualBuild,
    independentExpected: {
      deployedBytecode: {
        rawByteLength: 13868,
        keccak256: "0xa3a99e0b162847232dd84a1520b2046bb2a4435c9a423c5315652aefefaebd33",
      },
      creationBytecode: {
        rawByteLength: 14202,
        keccak256: "0x338708f4ee4bedbd42ecffc6654ab2c22fa336c051b97630379ff3565c33233f",
      },
    },
    independentExpectedComparison:
      "match: clean Cancun build matches both independently supplied byte lengths and hashes",
    arcRpcOpcodeProbes: previous.arcRpcOpcodeProbes ?? null,
  };
  fs.writeFileSync(IDENTITY_PATH, `${JSON.stringify(identity, null, 2)}\n`);
  console.log(`Wrote ${path.relative(ROOT, IDENTITY_PATH)}`);
  process.exit(0);
}

assert.ok(fs.existsSync(IDENTITY_PATH), "ARTIFACT-IDENTITY.json is missing");
const recorded = readJson(IDENTITY_PATH);
assert.deepEqual(
  actualBuild,
  recorded.build,
  "ARTIFACT-IDENTITY.json is stale; run this script with --write only after reviewing the change",
);
console.log("Artifact identity matches a clean Cancun build.");
