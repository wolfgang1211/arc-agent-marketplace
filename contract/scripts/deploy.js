const hre = require("hardhat");
const manifest = require("../DEPLOYMENT-MANIFEST.json");

const ARC_TESTNET_USDC = manifest.constructorArguments.find(
  ({ name }) => name === "usdcAddress",
)?.value;

async function main() {
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
  const usdcAddress = ARC_TESTNET_USDC;
  console.log("Using USDC:", usdcAddress);
  console.log("Using deployment manifest: DEPLOYMENT-MANIFEST.json");

  const Factory = await hre.ethers.getContractFactory("AgentMarketplace");
  const contract = await Factory.deploy(usdcAddress);
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
  );
  console.log("Only an ACCEPTED result permits frontend/env consumption.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
