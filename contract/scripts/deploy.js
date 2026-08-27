const hre = require("hardhat");
const { assertDeploymentManifest } = require("../lib/deployment-manifest");
const {
  normalizePrivateKey,
  runDeploymentPreflight,
} = require("../lib/deploy-preflight");
const manifests = {
  verification: require("../DEPLOYMENT-MANIFEST.json"),
  production: require("../DEPLOYMENT-MANIFEST.production.json"),
};

function deploymentConfig(mode) {
  const manifest = manifests[mode];
  if (!manifest || manifest.mode !== mode) {
    throw new Error("Select deploy:verification or deploy:production explicitly");
  }
  assertDeploymentManifest(manifest, mode);
  return {
    manifest,
    values: Object.fromEntries(
      manifest.constructorArguments.map(({ name, value }) => [name, value]),
    ),
  };
}

async function main() {
  const mode = process.env.DEPLOYMENT_MODE ?? process.env.npm_lifecycle_event?.split(":")[1];
  const { manifest, values } = deploymentConfig(mode);

  // This must run before the first RPC request. It accepts either common key
  // representation but never logs or returns the secret.
  normalizePrivateKey(process.env.PRIVATE_KEY);

  const constructorArgs = [
    values.usdcAddress,
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
  console.log("Delivery timeout (seconds):", values.deliveryTimeout);
  console.log("Approval timeout (seconds):", values.approvalTimeout);
  console.log("Dispute timeout (seconds):", values.disputeTimeout);
  console.log(
    "Using deployment manifest:",
    mode === "verification" ? "DEPLOYMENT-MANIFEST.json" : "DEPLOYMENT-MANIFEST.production.json",
  );

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
  console.log("Actual deployment gas:", receipt.gasUsed.toString());
  console.log(
    "Deployment gas deviation:",
    `${(receipt.gasUsed - preflight.estimatedGas).toString()} gas`,
  );
  console.log("\nAgentMarketplace deployed to:", address);
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
