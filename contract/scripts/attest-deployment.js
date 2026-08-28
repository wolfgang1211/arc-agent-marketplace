const path = require("node:path");
const { JsonRpcProvider } = require("ethers");
const { attestDeployment } = require("../lib/deployment-attestation");
const {
  DEPLOYMENT_MODES,
  markDeploymentAttested,
  readDeploymentRunState,
} = require("../lib/deployment-modes");

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || !value) {
      throw new Error(
        "Usage: node scripts/attest-deployment.js --rpc <url> --address <address> --tx <deployment-hash> --mode <verification|live-testnet|production>",
      );
    }
    values[flag.slice(2)] = value;
  }
  if (!values.rpc || !values.address || !values.tx || !values.mode) {
    throw new Error("--rpc, --address, --tx, and --mode are required");
  }
  if (!DEPLOYMENT_MODES[values.mode]) {
    throw new Error("--mode must be verification, live-testnet, or production");
  }
  return values;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(__dirname, "..");
  const manifestName = DEPLOYMENT_MODES[args.mode].manifestFile;
  const result = await attestDeployment({
    provider: new JsonRpcProvider(args.rpc),
    address: args.address,
    transactionHash: args.tx,
    root,
    identityPath: path.join(root, "ARTIFACT-IDENTITY.json"),
    manifestPath: path.join(root, manifestName),
  });
  const { statePath } = markDeploymentAttested({
    root,
    mode: args.mode,
    address: args.address,
    attestation: result,
  });
  const persisted = readDeploymentRunState({ root, mode: args.mode, address: args.address });
  if (persisted.state.status !== "ATTESTED" || persisted.state.attestation?.accepted !== true) {
    throw new Error("Persisted attestation state verification failed");
  }
  console.log(JSON.stringify({
    rpcUrl: args.rpc,
    deploymentMode: args.mode,
    manifestFile: manifestName,
    runStatePath: statePath,
    ...result,
  }, null, 2));
  console.log("Deployment bytecode attestation ACCEPTED.");
}

main().catch((error) => {
  console.error(`Deployment bytecode attestation REJECTED: ${error.message}`);
  process.exitCode = 1;
});
