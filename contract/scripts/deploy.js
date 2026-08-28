const hre = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");
const { assertDeploymentManifest } = require("../lib/deployment-manifest");
const {
  DEPLOYMENT_MODES,
  resolveDeploymentMode,
  writeDeploymentRunState,
} = require("../lib/deployment-modes");
const {
  normalizePrivateKey,
  runDeploymentPreflight,
} = require("../lib/deploy-preflight");
const ROOT = path.resolve(__dirname, "..");

function deploymentConfig(mode) {
  const manifestFile = DEPLOYMENT_MODES[mode]?.manifestFile;
  const manifest = manifestFile
    ? JSON.parse(fs.readFileSync(path.join(ROOT, manifestFile), "utf8"))
    : undefined;
  if (!manifest || manifest.mode !== mode) {
    throw new Error("Select deploy:verification, deploy:live-testnet, or deploy:production explicitly");
  }
  assertDeploymentManifest(manifest, mode);
  return {
    manifest,
    manifestFile,
    values: Object.fromEntries(
      manifest.constructorArguments.map(({ name, value }) => [name, value]),
    ),
  };
}

async function main() {
  const { mode } = resolveDeploymentMode({
    explicitMode: process.env.DEPLOYMENT_MODE,
    lifecycleEvent: process.env.npm_lifecycle_event,
  });
  const { manifest, manifestFile, values } = deploymentConfig(mode);

  // This must run before the first RPC request. It accepts either common key
  // representation but never logs or returns the secret.
  normalizePrivateKey(process.env.PRIVATE_KEY);

  const constructorArgs = [
    values.usdcAddress,
    values.agentStake,
    values.deliveryTimeout,
    values.approvalTimeout,
    values.disputeTimeout,
  ];
  const Factory = await hre.ethers.getContractFactory("AgentMarketplace");
  const preflight = await runDeploymentPreflight({
    provider: hre.ethers.provider,
    factory: Factory,
    constructorArgs,
    expectedChainId: BigInt(manifest.expectedChainId),
    rawPrivateKey: process.env.PRIVATE_KEY,
  });
  const [deployer] = await hre.ethers.getSigners();
  if (deployer.address.toLowerCase() !== preflight.deployerAddress.toLowerCase()) {
    throw new Error("Configured signer does not match the preflight wallet. No transaction was sent.");
  }

  console.log("Preflight: ACCEPTED");
  console.log("Network chainId:", preflight.chainId.toString());
  console.log("RPC block:", preflight.blockNumber);
  console.log("Deployer:", preflight.deployerAddress);
  console.log("Native gas USDC balance (18 decimals):", hre.ethers.formatUnits(preflight.balance, 18));
  console.log("Estimated deployment gas:", preflight.estimatedGas.toString());
  console.log("Preflight max fee per gas:", preflight.maxFeePerGas.toString());
  console.log("Estimated deployment fee (wei):", preflight.estimatedCost.toString());
  console.log("Required balance with 2x reserve (wei):", preflight.required.toString());

  const usdcAddress = values.usdcAddress;
  console.log("Using USDC:", usdcAddress);
  console.log("Deployment mode:", mode);
  console.log("Agent stake (USDC base units):", values.agentStake);
  console.log("Delivery timeout (seconds):", values.deliveryTimeout);
  console.log("Approval timeout (seconds):", values.approvalTimeout);
  console.log("Dispute timeout (seconds):", values.disputeTimeout);
  console.log(
    "Using deployment manifest:",
    manifestFile,
  );

  if (process.env.PREFLIGHT_ONLY === "1") {
    console.log("PREFLIGHT_ONLY=1: checks passed; no transaction was sent.");
    return;
  }

  const contract = await Factory.deploy(...constructorArgs);
  const deploymentTransaction = contract.deploymentTransaction();
  const receipt = await deploymentTransaction.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error(
      `Deployment transaction ${deploymentTransaction.hash} failed with receipt.status=${receipt?.status ?? "missing"}. Address is rejected.`,
    );
  }
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const identity = JSON.parse(fs.readFileSync(path.join(ROOT, "ARTIFACT-IDENTITY.json"), "utf8"));
  const runStatePath = writeDeploymentRunState({
    root: ROOT,
    mode,
    state: {
      schemaVersion: 1,
      deploymentMode: mode,
      manifestFile,
      artifactIdentityFile: "ARTIFACT-IDENTITY.json",
      artifactIdentity: {
        creationKeccak256: identity?.bytecode?.creationBytecode?.keccak256,
        normalizedDeployedKeccak256: identity?.bytecode?.normalizedDeployedBytecode?.keccak256,
      },
      status: "UNATTESTED",
      chainId: preflight.chainId.toString(),
      contractAddress: address,
      transactionHash: deploymentTransaction.hash,
      blockNumber: receipt.blockNumber,
      receiptStatus: receipt.status,
      estimatedGas: preflight.estimatedGas.toString(),
      actualGasUsed: receipt.gasUsed.toString(),
      gasDeviation: (receipt.gasUsed - preflight.estimatedGas).toString(),
      effectiveGasPriceWei: (receipt.gasPrice ?? receipt.effectiveGasPrice)?.toString() ?? null,
    },
  });
  console.log("Actual deployment gas:", receipt.gasUsed.toString());
  console.log(
    "Deployment gas deviation:",
    `${(receipt.gasUsed - preflight.estimatedGas).toString()} gas`,
  );
  console.log("\nAgentMarketplace deployed to:", address);
  console.log("Deployment run state:", runStatePath);
  console.log("Explorer:", `https://testnet.arcscan.app/address/${address}`);
  console.log("Reputation getter: getAgentReputation(address)");
  console.log("\nUNATTESTED: do not announce or configure this address yet.");
  console.log(
    "Next: npm run attest:deployment -- --rpc <RPC_URL> --address",
    address,
    "--tx",
    deploymentTransaction.hash,
    "--mode",
    mode,
  );
  console.log("Only an ACCEPTED result permits frontend/env consumption.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
