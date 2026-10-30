const fs = require("node:fs");
const hre = require("hardhat");
const { ethers } = hre;

function assertLoopbackRpc(rpcUrl) {
  if (typeof rpcUrl !== "string" || !/^http:\/\/127\.0\.0\.1:\d+$/.test(rpcUrl)) {
    throw new Error("V2_LOCAL_RPC_URL must be an explicit 127.0.0.1 endpoint");
  }
  return rpcUrl;
}

async function main() {
  const out = process.env.V2_LOCAL_MANIFEST_OUT;
  if (!out) throw new Error("V2_LOCAL_MANIFEST_OUT is required");
  const rpcUrl = assertLoopbackRpc(process.env.V2_LOCAL_RPC_URL);
  const provider = new ethers.JsonRpcProvider(rpcUrl, 31337, { staticNetwork: true });
  const observed = await provider.send("eth_chainId", []);
  if (typeof observed !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(observed) || BigInt(observed) !== 31337n) {
    throw new Error("refusing deploy before eth_chainId is 31337");
  }
  const [owner, client, operator, treasury, resolver] = await Promise.all([0, 1, 2, 3, 4].map((index) => provider.getSigner(index)));
  const Token = await ethers.getContractFactory("MockUSDC", owner);
  const token = await Token.deploy();
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  const nonce = await provider.getTransactionCount(owner.address);
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
  const marketCode = await provider.getCode(marketAddress);
  const vaultCode = await provider.getCode(vaultAddress);
  const marketBytes = (marketCode.length - 2) / 2;
  const vaultBytes = (vaultCode.length - 2) / 2;
  if (marketBytes !== 23908 || vaultBytes !== 4854) throw new Error(`unexpected runtime size ${marketBytes}/${vaultBytes}`);
  const marketReceipt = await provider.getTransactionReceipt(market.deploymentTransaction().hash);
  const vaultReceipt = await provider.getTransactionReceipt(vault.deploymentTransaction().hash);
  const head = await provider.getBlock("latest");
  const amount = 2_000n * 1_000_000n;
  for (const signer of [owner, client, operator, treasury, resolver]) await (await token.mint(signer.address, amount)).wait();
  const manifest = {
    chainId: BigInt(observed).toString(),
    rpcUrl,
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
