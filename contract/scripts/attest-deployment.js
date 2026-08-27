const path = require("node:path");
const { JsonRpcProvider } = require("ethers");
const { attestDeployment } = require("../lib/deployment-attestation");

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || !value) {
      throw new Error(
        "Usage: node scripts/attest-deployment.js --rpc <url> --address <address> --tx <deployment-hash>",
      );
    }
    values[flag.slice(2)] = value;
  }
  if (!values.rpc || !values.address || !values.tx) {
    throw new Error("--rpc, --address, and --tx are required");
  }
  return values;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(__dirname, "..");
  const result = await attestDeployment({
    provider: new JsonRpcProvider(args.rpc),
    address: args.address,
    transactionHash: args.tx,
    root,
    identityPath: path.join(root, "ARTIFACT-IDENTITY.json"),
    manifestPath: path.join(root, "DEPLOYMENT-MANIFEST.json"),
  });
  console.log(JSON.stringify({ rpcUrl: args.rpc, ...result }, null, 2));
  console.log("Deployment bytecode attestation ACCEPTED.");
}

main().catch((error) => {
  console.error(`Deployment bytecode attestation REJECTED: ${error.message}`);
  process.exitCode = 1;
});
