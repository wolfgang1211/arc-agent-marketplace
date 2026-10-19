const { loadRuntimeWallet } = require('./v2-keystore-worker');
const { ethers } = require('ethers');

const TYPES = {
  Application: [
    { name: 'jobId', type: 'uint256' },
    { name: 'operator', type: 'address' },
    { name: 'termsHash', type: 'bytes32' },
    { name: 'validAfter', type: 'uint64' },
    { name: 'validBefore', type: 'uint64' },
    { name: 'nonceEpoch', type: 'uint256' },
    { name: 'operatorNonce', type: 'uint256' },
  ],
};

async function main(input) {
  if (!input || input.op !== 'signLocalApplication' || input.role !== 'testOperator') throw new Error('INVALID_REQUEST');
  const domain = input.domain;
  if (!domain || domain.name !== 'AlphaBoard Agent Marketplace V2' || domain.version !== '1' ||
      String(domain.chainId) !== '31337' || !ethers.isAddress(domain.verifyingContract)) throw new Error('INVALID_LOCAL_DOMAIN');
  if (!input.value || !ethers.isAddress(input.value.operator) || input.value.operator.toLowerCase() !== input.expectedAddress.toLowerCase()) throw new Error('OPERATOR_MISMATCH');
  const wallet = await loadRuntimeWallet({ op: 'decrypt', role: 'testOperator', password: input.password });
  if (wallet.address.toLowerCase() !== input.expectedAddress.toLowerCase()) throw new Error('ADDRESS_MISMATCH');
  const signature = await wallet.signTypedData(domain, TYPES, input.value);
  process.stdout.write(JSON.stringify({ ok: true, signature }));
}

let raw = '';
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  try { main(JSON.parse(raw)).catch(() => { process.stdout.write(JSON.stringify({ ok: false, error: 'LOCAL_SIGN_FAILED' })); process.exitCode = 1; }); }
  catch { process.stdout.write(JSON.stringify({ ok: false, error: 'LOCAL_SIGN_FAILED' })); process.exitCode = 1; }
});
