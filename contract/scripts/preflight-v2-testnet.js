// Transaction-free Arc preflight. No signer, secret, funding or deployment path.
const fs = require('fs');
const path = require('path');
const { JsonRpcProvider, Contract, isAddress, formatEther, formatUnits } = require('ethers');
const root = path.resolve(__dirname, '..');
const RPC = 'https://rpc.testnet.arc.io';
const TOKEN = '0x3600000000000000000000000000000000000000';
const allowed = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getCode', 'eth_getBalance', 'eth_getTransactionCount', 'eth_call', 'eth_gasPrice', 'eth_maxPriorityFeePerGas']);
async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs/v2-testnet-wallets.json'), 'utf8'));
  const addresses = Object.values(manifest.roles);
  if (!addresses.every(isAddress) || new Set(addresses.map(x => x.toLowerCase())).size !== 8) throw new Error('ROLE_MANIFEST_INVALID');
  const provider = new JsonRpcProvider(RPC);
  const original = provider.send.bind(provider);
  const methods = [];
  provider.send = async (method, params) => {
    if (!allowed.has(method)) throw new Error('RPC_METHOD_FORBIDDEN');
    methods.push(method);
    return original(method, params);
  };
  try {
    if ((await provider.getNetwork()).chainId !== 5042002n) throw new Error('WRONG_CHAIN');
    const head = await provider.getBlockNumber();
    const blockNumber = Math.max(0, head - 2);
    const block = await provider.getBlock(blockNumber);
    const token = new Contract(TOKEN, ['function decimals() view returns (uint8)', 'function symbol() view returns (string)', 'function balanceOf(address) view returns (uint256)'], provider);
    const decimals = Number(await token.decimals({ blockTag: blockNumber }));
    const symbol = await token.symbol({ blockTag: blockNumber });
    if (decimals !== 6 || symbol !== 'USDC') throw new Error('TOKEN_METADATA_MISMATCH');
    const roles = {};
    for (const [role, address] of Object.entries(manifest.roles)) {
      const native = await provider.getBalance(address, blockNumber);
      const erc20 = await token.balanceOf(address, { blockTag: blockNumber });
      const nonce = await provider.getTransactionCount(address, 'pending');
      const code = await provider.getCode(address, blockNumber);
      if (role === 'deployer' && (nonce !== 0 || code !== '0x')) throw new Error('DEPLOYER_NOT_PRISTINE');
      roles[role] = { address, pendingNonce: nonce, nativeUSDC: formatEther(native), erc20USDC: formatUnits(erc20, 6), nativeRaw: native.toString(), erc20Raw: erc20.toString(), codeBytes: (code.length - 2) / 2 };
    }
    const gasPrice = BigInt(await provider.send('eth_gasPrice', []));
    const priority = BigInt(await provider.send('eth_maxPriorityFeePerGas', []));
    const cap = 2n * block.baseFeePerGas + priority;
    const result = { timestamp: new Date().toISOString(), network: 'Arc Testnet', chainId: 5042002, rpc: RPC, token: TOKEN, decimals, symbol, balanceBlockNumber: blockNumber, balanceBlockHash: block.hash, nonceTag: 'pending', roles, feeQuote: { gasPriceWei: gasPrice.toString(), baseFeeWei: block.baseFeePerGas.toString(), priorityWei: priority.toString(), planningCapWei: cap.toString() }, rpcMethods: methods, transactionMethodsPermitted: false, balanceWarning: 'Native USDC (18 decimals) and ERC-20 USDC (6 decimals) are the same underlying balance; do not sum them.' };
    fs.writeFileSync(path.join(root, 'docs/v2-testnet-readonly-preflight.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
  } finally {
    provider.destroy();
  }
}
main().catch(() => { console.error('READ_ONLY_PREFLIGHT_FAILED'); process.exitCode = 1; });
