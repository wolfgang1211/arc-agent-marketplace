require("@nomicfoundation/hardhat-toolbox");
const base = require("./hardhat.config");
// Canonical V2 production profile. Optimizer variance belongs in a dedicated
// experiment config; the acceptance build must not depend on ambient env.
const v2Runs = 50;
const v2Artifacts = "./artifacts-v2-runs50";
const v2Cache = "./cache-v2-runs50";

const v2Settings = {
  ...base.solidity.settings,
  viaIR: true,
  optimizer: { enabled: true, runs: v2Runs },
  outputSelection: {
    ...base.solidity.settings.outputSelection,
    "*": {
      ...base.solidity.settings.outputSelection["*"],
      "AgentMarketplaceV2": [
        "abi",
        "evm.bytecode",
        "evm.deployedBytecode",
        "evm.deployedBytecode.immutableReferences",
        "evm.methodIdentifiers",
        "metadata",
        "storageLayout",
      ],
    },
  },
};

module.exports = {
  ...base,
  solidity: {
    compilers: [{ version: base.solidity.version, settings: base.solidity.settings }],
    overrides: {
      "contracts/AgentMarketplaceV2.sol": {
        version: base.solidity.version,
        settings: v2Settings,
      },
      "contracts/OperatorCollateralVaultV2.sol": {
        version: base.solidity.version,
        settings: v2Settings,
      },
    },
  },
  paths: {
    ...base.paths,
    artifacts: v2Artifacts,
    cache: v2Cache,
  },
  mocha: { timeout: 600000 },
};
