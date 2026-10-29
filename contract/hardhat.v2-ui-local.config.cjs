// Isolated loopback-only V2 browser-test node. No dotenv or external networks.
module.exports = {
  solidity: {
    version: '0.8.28',
    settings: { evmVersion: 'cancun', optimizer: { enabled: true, runs: 50 }, viaIR: true },
  },
  networks: { hardhat: { chainId: 31337, hardfork: 'cancun', loggingEnabled: false } },
  paths: { cache: './cache-v2-ui-local', artifacts: './artifacts-v2-ui-local' },
};
