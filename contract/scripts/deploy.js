const hre = require("hardhat");
const { assertDeploymentManifest } = require("../lib/deployment-manifest");
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
  const [deployer] = await hre.ethers.getSigners();
  const net = await hre.ethers.provider.getNetwork();

  console.log("Network chainId:", net.chainId.toString());
  console.log("Deployer:", deployer.address);

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Native gas USDC balance:", hre.ethers.formatUnits(balance, 18));

  if (net.chainId !== 5042002n) {
    console.warn("WARNING: not on Arc Testnet (expected chainId 5042002).");
  }

  if (`0x${net.chainId.toString(16)}` !== manifest.expectedChainId) {
    throw new Error(`Deployment manifest rejects chainId ${net.chainId}`);
  }
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

  const Factory = await hre.ethers.getContractFactory("AgentMarketplace");
  const contract = await Factory.deploy(
    usdcAddress,
    values.deliveryTimeout,
    values.approvalTimeout,
    values.disputeTimeout,
  );
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  const deploymentTransaction = contract.deploymentTransaction();
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
