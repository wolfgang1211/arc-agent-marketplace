const { ethers } = require('hardhat');

async function explicitLocalProfile({ market, vault, token, treasury, provider = ethers.provider, rpcUrl = 'http://127.0.0.1:8545' }) {
  const { resolveV2ChainProfile } = await import('../../../web/lib/v2/chain-profile.mjs');
  const marketAddress = await market.getAddress();
  const vaultAddress = await vault.getAddress();
  const tokenAddress = await token.getAddress();
  const treasuryAddress = typeof treasury === 'string' ? treasury : treasury.address;
  const marketCode = await provider.getCode(marketAddress);
  const vaultCode = await provider.getCode(vaultAddress);
  const marketReceipt = await market.deploymentTransaction().wait();
  const vaultReceipt = await vault.deploymentTransaction().wait();
  const head = await provider.getBlock('latest');
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(rpcUrl)) throw new Error('local profile witness must use loopback');
  return resolveV2ChainProfile({
    env: { V2_CHAIN_PROFILE: 'local-hardhat' },
    localManifest: {
      chainId: '31337',
      rpcUrl,
      pair: { market: marketAddress, vault: vaultAddress, token: tokenAddress, treasury: treasuryAddress },
      runtime: {
        market: { address: marketAddress, bytes: (marketCode.length - 2) / 2, rawHash: ethers.keccak256(marketCode) },
        vault: { address: vaultAddress, bytes: (vaultCode.length - 2) / 2, rawHash: ethers.keccak256(vaultCode) },
      },
      deployments: [
        { name: 'OperatorCollateralVaultV2', blockNumber: Number(vaultReceipt.blockNumber) },
        { name: 'AgentMarketplaceV2', blockNumber: Number(marketReceipt.blockNumber) },
      ],
      anchorBlock: { number: Number(head.number), hash: head.hash },
      roles: {},
    },
  });
}

module.exports = { explicitLocalProfile };
