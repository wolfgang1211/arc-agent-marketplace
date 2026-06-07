const hre = require("hardhat");

// Official Arc Testnet ERC-20 USDC address (verify at
// https://docs.arc.io/arc/references/contract-addresses before each deploy).
const ARC_TESTNET_USDC = "0x3600000000000000000000000000000000000000";

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

  const usdcAddress = process.env.USDC_ADDRESS || ARC_TESTNET_USDC;
  console.log("Using USDC:", usdcAddress);

  const Factory = await hre.ethers.getContractFactory("AgentMarketplace");
  const contract = await Factory.deploy(usdcAddress);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("\nAgentMarketplace deployed to:", address);
  console.log("Explorer:", `https://testnet.arcscan.app/address/${address}`);
  console.log("\nNext: put this address in web/.env.local as NEXT_PUBLIC_CONTRACT_ADDRESS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
