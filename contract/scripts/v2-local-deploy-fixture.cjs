const fs = require("node:fs");
const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const out = process.env.V2_LOCAL_MANIFEST_OUT;
  if (!out) throw new Error("V2_LOCAL_MANIFEST_OUT is required");
  const [owner, client, operator, treasury, resolver] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("MockUSDC");
  const token = await Token.deploy();
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  const nonce = await ethers.provider.getTransactionCount(owner.address);
  const expectedMarket = ethers.getCreateAddress({ from: owner.address, nonce: nonce + 1 });
  const Vault = await ethers.getContractFactory("OperatorCollateralVaultV2", owner);
  const vault = await Vault.deploy(tokenAddress, expectedMarket, treasury.address);
  await vault.waitForDeployment();
  const Market = await ethers.getContractFactory("AgentMarketplaceV2", owner);
  const market = await Market.deploy(tokenAddress, owner.address, treasury.address, await vault.getAddress());
  await market.waitForDeployment();
  const marketAddress = await market.getAddress();
  const vaultAddress = await vault.getAddress();
  if (await vault.marketplace() !== marketAddress || await market.collateralVault() !== vaultAddress) throw new Error("pair mismatch");
  const marketCode = await ethers.provider.getCode(marketAddress);
  const vaultCode = await ethers.provider.getCode(vaultAddress);
  const marketBytes = (marketCode.length - 2) / 2;
  const vaultBytes = (vaultCode.length - 2) / 2;
  if (marketBytes !== 23908 || vaultBytes !== 4854) throw new Error(`unexpected runtime size ${marketBytes}/${vaultBytes}`);
  const marketReceipt = await ethers.provider.getTransactionReceipt(market.deploymentTransaction().hash);
  const vaultReceipt = await ethers.provider.getTransactionReceipt(vault.deploymentTransaction().hash);
  const head = await ethers.provider.getBlock("latest");
  const amount = 2_000n * 1_000_000n;
  for (const signer of [owner, client, operator, treasury, resolver]) await (await token.mint(signer.address, amount)).wait();
  const manifest = {
    chainId: "31337",
    rpcUrl: "http://127.0.0.1:8545",
    pair: { market: marketAddress, vault: vaultAddress, token: tokenAddress, treasury: treasury.address },
    runtime: {
      market: { address: marketAddress, bytes: marketBytes, rawHash: ethers.keccak256(marketCode) },
      vault: { address: vaultAddress, bytes: vaultBytes, rawHash: ethers.keccak256(vaultCode) },
    },
    deployments: [
      { name: "OperatorCollateralVaultV2", blockNumber: Number(vaultReceipt.blockNumber) },
      { name: "AgentMarketplaceV2", blockNumber: Number(marketReceipt.blockNumber) },
    ],
    anchorBlock: { number: Number(head.number), hash: head.hash },
    roles: { owner: owner.address, client: client.address, operator: operator.address, treasury: treasury.address, resolver: resolver.address },
  };
  fs.writeFileSync(out, `${JSON.stringify(manifest)}\n`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
