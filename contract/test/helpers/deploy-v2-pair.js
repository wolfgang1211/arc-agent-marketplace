const { ethers } = require("hardhat");
const { registerPair } = require("./v2-receipt-auditor");

async function deployV2Pair({ token, owner, treasury }) {
  if (Number(await token.decimals()) !== 6) throw new Error("V2 token must expose six decimals");
  const Vault = await ethers.getContractFactory("OperatorCollateralVaultV2", owner);
  const Market = await ethers.getContractFactory("AgentMarketplaceV2", owner);
  const nonce = await ethers.provider.getTransactionCount(owner.address);
  const expectedMarket = ethers.getCreateAddress({ from: owner.address, nonce: nonce + 1 });
  const vault = await Vault.deploy(await token.getAddress(), expectedMarket, treasury.address);
  await vault.waitForDeployment();
  const nonceAfterVault = await ethers.provider.getTransactionCount(owner.address);
  if (nonceAfterVault !== nonce + 1) {
    const orphanBalance = await token.balanceOf(await vault.getAddress());
    if (orphanBalance !== 0n) throw new Error("intervening deployment left orphan vault funds");
    throw new Error("owner nonce changed between paired deployments");
  }
  const market = await Market.deploy(await token.getAddress(), owner.address, treasury.address, await vault.getAddress());
  await market.waitForDeployment();
  if (await vault.marketplace() !== await market.getAddress()) throw new Error("vault/market pairing mismatch");
  if (await market.collateralVault() !== await vault.getAddress()) throw new Error("market/vault pairing mismatch");
  await registerPair({
    token: await token.getAddress(), market: await market.getAddress(), vault: await vault.getAddress(),
    deploymentTxHashes: [vault.deploymentTransaction()?.hash, market.deploymentTransaction()?.hash].filter(Boolean),
  });
  return { market, vault };
}

module.exports = { deployV2Pair };
