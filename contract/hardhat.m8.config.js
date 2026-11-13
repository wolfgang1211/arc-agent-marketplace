// Isolated in-process acceptance chain. Never configures an external network.
const base=require('./hardhat.v2.config');
module.exports={...base,networks:{hardhat:{...base.networks?.hardhat,chainId:5042002}}};
