const fs = require("node:fs");
const path = require("node:path");

const DEPLOYMENT_MODES = Object.freeze({
  verification: Object.freeze({ manifestFile: "DEPLOYMENT-MANIFEST.json" }),
  "live-testnet": Object.freeze({ manifestFile: "DEPLOYMENT-MANIFEST.live-testnet.json" }),
  production: Object.freeze({ manifestFile: "DEPLOYMENT-MANIFEST.production.json" }),
});

const EXPLICIT_MODE_ERROR =
  "Select deploy:verification, deploy:live-testnet, or deploy:production explicitly";

function artifactIdentitySummary(identity) {
  const creationKeccak256 = identity?.build?.creationBytecode?.keccak256;
  const normalizedDeployedKeccak256 =
    identity?.deploymentAttestation?.normalizedDeployedBytecode?.keccak256;
  if (!creationKeccak256 || !normalizedDeployedKeccak256) {
    throw new Error("Artifact identity is incomplete");
  }
  return { creationKeccak256, normalizedDeployedKeccak256 };
}

function modeFromLifecycleEvent(lifecycleEvent) {
  if (typeof lifecycleEvent !== "string" || !lifecycleEvent.startsWith("deploy:")) return undefined;
  const mode = lifecycleEvent.slice("deploy:".length);
  return DEPLOYMENT_MODES[mode] ? mode : undefined;
}

function resolveDeploymentMode({ explicitMode, lifecycleEvent } = {}) {
  const lifecycleMode = modeFromLifecycleEvent(lifecycleEvent);
  if (explicitMode && lifecycleMode && explicitMode !== lifecycleMode) {
    throw new Error(`Deployment mode conflict: DEPLOYMENT_MODE=${explicitMode}, npm lifecycle=${lifecycleMode}`);
  }
  const mode = explicitMode ?? lifecycleMode;
  if (!DEPLOYMENT_MODES[mode]) throw new Error(EXPLICIT_MODE_ERROR);
  return { mode, ...DEPLOYMENT_MODES[mode] };
}

function assertAddress(address) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address ?? "")) {
    throw new Error("Run-state contract address must be a 20-byte EVM address");
  }
}

function deploymentRunPath(root, mode, address) {
  if (!DEPLOYMENT_MODES[mode]) throw new Error(`Unsupported deployment mode ${mode}`);
  assertAddress(address);
  return path.join(root, "deployment-runs", `arc-testnet-${mode}-${address.toLowerCase()}.json`);
}

function assertRunState(mode, state) {
  const config = DEPLOYMENT_MODES[mode];
  if (!config) throw new Error(`Unsupported deployment mode ${mode}`);
  if (state?.deploymentMode !== mode) throw new Error("Run-state deployment mode mismatch");
  if (state?.manifestFile !== config.manifestFile) throw new Error("Run-state manifest mismatch");
  assertAddress(state?.contractAddress);
}

function writeDeploymentRunState({ root, mode, state, overwrite = false }) {
  assertRunState(mode, state);
  const statePath = deploymentRunPath(root, mode, state.contractAddress);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const body = `${JSON.stringify(state, null, 2)}\n`;
  if (!overwrite) {
    fs.writeFileSync(statePath, body, { encoding: "utf8", flag: "wx" });
    return statePath;
  }
  const temporaryPath = `${statePath}.tmp`;
  fs.writeFileSync(temporaryPath, body, "utf8");
  fs.renameSync(temporaryPath, statePath);
  return statePath;
}

function readDeploymentRunState({ root, mode, address }) {
  const statePath = deploymentRunPath(root, mode, address);
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assertRunState(mode, state);
  return { statePath, state };
}

function markDeploymentAttested({ root, mode, address, attestation }) {
  if (attestation?.accepted !== true) {
    throw new Error("Cannot mark deployment ATTESTED without an accepted attestation");
  }
  const { state } = readDeploymentRunState({ root, mode, address });
  if (state.status !== "UNATTESTED") {
    throw new Error(`Run-state must be UNATTESTED before attestation, found ${state.status}`);
  }
  const updated = {
    ...state,
    status: "ATTESTED",
    attestation: {
      manifestFile: DEPLOYMENT_MODES[mode].manifestFile,
      ...attestation,
    },
  };
  const statePath = writeDeploymentRunState({ root, mode, state: updated, overwrite: true });
  return { statePath, state: updated };
}

module.exports = {
  DEPLOYMENT_MODES,
  EXPLICIT_MODE_ERROR,
  artifactIdentitySummary,
  deploymentRunPath,
  markDeploymentAttested,
  readDeploymentRunState,
  resolveDeploymentMode,
  writeDeploymentRunState,
};
