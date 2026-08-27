const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  loadCompilerMetadata,
  normalizeBytecode,
  rawBytecodeIdentity,
} = require("../lib/deployment-attestation");

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
const compilerMetadata = loadCompilerMetadata(ROOT);
const actualNormalizedDeployed = rawBytecodeIdentity(
  normalizeBytecode(
    compilerMetadata.deployedBytecode,
    compilerMetadata.immutableReferences,
  ),
  "normalized deployed bytecode",
);

if (process.argv.includes("--write")) {
  assert.ok(fs.existsSync(IDENTITY_PATH), "Governed identity must already exist before an update");
  const previous = readJson(IDENTITY_PATH);
  const valueAfter = (flag) => {
    const index = process.argv.indexOf(flag);
    return index === -1 ? undefined : process.argv[index + 1];
  };
  const reason = valueAfter("--reason");
  const recordId = valueAfter("--record-id");
  const oldCreationHash = valueAfter("--old-creation-hash");
  const oldDeployedHash = valueAfter("--old-deployed-hash");

  assert.ok(reason && reason.length >= 20, "--reason must describe the intentional contract change");
  assert.ok(recordId, "--record-id must identify the contract-changing commit or governed record");
  assert.equal(
    oldCreationHash,
    previous.build.creationBytecode.keccak256,
    "--old-creation-hash must exactly match the governed record",
  );
  assert.equal(
    oldDeployedHash,
    previous.build.deployedBytecode.keccak256,
    "--old-deployed-hash must exactly match the governed record",
  );
  assert.ok(
    actualBuild.creationBytecode.keccak256 !== oldCreationHash ||
      actualBuild.deployedBytecode.keccak256 !== oldDeployedHash,
    "Governed identity cannot be regenerated when contract bytecode is unchanged",
  );

  const identity = {
    ...previous,
    schemaVersion: 2,
    build: actualBuild,
    governance: {
      ...previous.governance,
      lastContractChange: {
        recordId,
        reason,
        oldCreationKeccak256: oldCreationHash,
        newCreationKeccak256: actualBuild.creationBytecode.keccak256,
        oldDeployedTemplateKeccak256: oldDeployedHash,
        newDeployedTemplateKeccak256: actualBuild.deployedBytecode.keccak256,
      },
    },
    independentExpected: null,
    independentExpectedComparison:
      "not carried forward: this governed intentional contract change has no independent expected identity",
    deploymentAttestation: {
      ...previous.deploymentAttestation,
      normalizedDeployedBytecode: actualNormalizedDeployed,
    },
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
assert.deepEqual(
  actualNormalizedDeployed,
  recorded.deploymentAttestation.normalizedDeployedBytecode,
  "ARTIFACT-IDENTITY.json normalized deployed identity is stale",
);
console.log("Artifact identity matches a clean Cancun build.");
