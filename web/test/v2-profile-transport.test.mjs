import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadOnlyV2Transport } from '../lib/v2/server/api-runtime.mjs';
import { resolveV2ChainProfile } from '../lib/v2/chain-profile.mjs';

function installRpc(t, handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const request = JSON.parse(options.body);
    calls.push({ url, method: request.method, params: request.params });
    return Response.json({ jsonrpc: '2.0', id: request.id, result: await handler(request, calls) });
  };
  t.after(() => { globalThis.fetch = original; });
  return calls;
}

for (const method of ['eth_sendTransaction', 'eth_sendRawTransaction', 'personal_sign', 'eth_sign', 'eth_signTypedData_v4', 'wallet_sendCalls']) {
  test('server rejects ' + method + ' without making any RPC request', async (t) => {
    const calls = installRpc(t, () => assert.fail('No RPC is allowed for a denied method'));
    await assert.rejects(createReadOnlyV2Transport()(method, []), /V2_RPC_METHOD_DENIED/);
    assert.equal(calls.length, 0);
  });
}

test('actual chain ID is checked before any profile-external data request', async (t) => {
  const calls = installRpc(t, (request) => { assert.equal(request.method, 'eth_chainId'); return '0x1'; });
  await assert.rejects(createReadOnlyV2Transport()('eth_call', [{ to: '0x' + '11'.repeat(20), data: '0x' }, 'latest']), /V2_RPC_CHAIN_MISMATCH/);
  assert.deepEqual(calls.map((entry) => entry.method), ['eth_chainId']);
  assert.equal(calls[0].url, 'https://rpc.testnet.arc.io');
});

test('transport re-attests chain after the endpoint changes, rather than trusting cached network', async (t) => {
  let checks = 0;
  const calls = installRpc(t, (request) => {
    if (request.method === 'eth_chainId') return ++checks === 1 ? '0x4cef52' : '0x1';
    assert.equal(request.method, 'eth_blockNumber'); return '0x10';
  });
  const transport = createReadOnlyV2Transport();
  assert.equal(await transport('eth_blockNumber'), '0x10');
  await assert.rejects(transport('eth_blockNumber'), /V2_RPC_CHAIN_MISMATCH/);
  assert.deepEqual(calls.map((entry) => entry.method), ['eth_chainId', 'eth_blockNumber', 'eth_chainId']);
});

test('pending receipt null remains pending instead of becoming unavailable or confirmed', async (t) => {
  installRpc(t, (request) => request.method === 'eth_chainId' ? '0x4cef52' : null);
  const transport = createReadOnlyV2Transport();
  assert.equal(await transport('eth_getTransactionReceipt', ['0x' + '11'.repeat(32)]), null);
  assert.equal(await transport('eth_getTransactionByHash', ['0x' + '11'.repeat(32)]), null);
  await assert.rejects(transport('eth_getCode', ['0x' + '11'.repeat(20), 'latest']), /V2_RPC_UNAVAILABLE/);
});

test('RPC response identifiers must bind to the actual request', async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ jsonrpc: '2.0', id: 'wrong-id', result: '0x4cef52' });
  t.after(() => { globalThis.fetch = original; });
  await assert.rejects(createReadOnlyV2Transport()('eth_chainId'), /V2_RPC_UNAVAILABLE/);
});

const addr = (n) => '0x' + BigInt(n).toString(16).padStart(40, '0');
const hash = (n) => '0x' + BigInt(n).toString(16).padStart(64, '0');
function localProfile() {
  return resolveV2ChainProfile({ env: { V2_CHAIN_PROFILE: 'local-hardhat' }, localManifest: {
    chainId: '31337', rpcUrl: 'http://127.0.0.1:8545',
    pair: { market: addr(1), vault: addr(2), token: addr(3), treasury: addr(4) },
    runtime: { market: { address: addr(1), bytes: 23908, rawHash: hash(1) }, vault: { address: addr(2), bytes: 4854, rawHash: hash(2) } },
    deployments: [{ name: 'OperatorCollateralVaultV2', blockNumber: 10 }, { name: 'AgentMarketplaceV2', blockNumber: 11 }],
    anchorBlock: { number: 12, hash: hash(12) }, roles: {},
  } });
}

test('local bulk receipt adapter preserves every actual ordered receipt and foreign log', async (t) => {
  const header = { hash: hash(12), number: '0xc', transactions: [hash(21), hash(22)] };
  const receipts = header.transactions.map((transactionHash, index) => ({ transactionHash, blockHash: header.hash, blockNumber: header.number, transactionIndex: '0x' + index.toString(16), logs: [{ address: addr(3), topics: [hash(50)], data: '0x' }] }));
  const calls = installRpc(t, (request) => {
    if (request.method === 'eth_chainId') return '0x7a69';
    if (request.method === 'eth_getBlockByNumber') return header;
    if (request.method === 'eth_getTransactionReceipt') return receipts.find((receipt) => receipt.transactionHash === request.params[0]);
    assert.fail('Only real single-receipt reads are supported by this local fixture');
  });
  assert.deepEqual(await createReadOnlyV2Transport({ profile: localProfile() })('eth_getBlockReceipts', ['0xc']), receipts);
  assert.equal(calls.filter((entry) => entry.method === 'eth_getTransactionReceipt').length, 2);
  assert.equal(calls.some((entry) => entry.method === 'eth_getBlockReceipts'), false);
});

test('local bulk receipt adapter rejects incomplete receipt evidence instead of returning an empty array', async (t) => {
  installRpc(t, (request) => request.method === 'eth_chainId' ? '0x7a69' : request.method === 'eth_getBlockByNumber' ? { hash: hash(12), number: '0xc', transactions: [hash(21)] } : null);
  await assert.rejects(createReadOnlyV2Transport({ profile: localProfile() })('eth_getBlockReceipts', ['0xc']), /V2_RPC_UNAVAILABLE/);
});
