import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeFunctionData, keccak256 } from 'viem';
import manifest from '../lib/v2/action-manifest.json' with { type: 'json' };
import { resumeWalletIntent, storageKey } from '../lib/v2/new-wallet-execution.mjs';

const wallet = '0x1111111111111111111111111111111111111111';
const hash = `0x${'ab'.repeat(32)}`;
const profile = { id: 'arc-testnet', chainId: '5042002', marketplace: '0xfa156b7a5205b123c8a22a807ba98405e36130f1', vault: '0xd5b271b7bf4696d662b2bcb1a94b408887c6c423', usdc: '0x2222222222222222222222222222222222222222', rpcUrl: 'https://rpc.invalid' };
const data = encodeFunctionData({ abi: manifest.contracts.marketplace.abi, functionName: 'registerOperator', args: [] });
const base = { intentId: '00000000-0000-4000-8000-0000000000a1', profileId: profile.id, chainId: profile.chainId, wallet, action: 'registerOperator', kind: 'main', status: 'broadcast', hash, to: profile.marketplace, calldataHash: keccak256(data), autoResume: true, expected: { action: 'registerOperator', wallet, registered: true } };
const stale = Object.assign(new Error('state moved on'), { code: 'readback-mismatch' });

async function withStore(stored, receiptStatus, fn) {
  const previous = globalThis.localStorage;
  const map = new Map();
  globalThis.localStorage = { get length() { return map.size; }, key: (i) => [...map.keys()][i], getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
  const calls = [];
  const provider = { request: async ({ method }) => {
    calls.push(method);
    if (method === 'eth_accounts') return [wallet];
    if (method === 'eth_chainId') return '0x4cef52';
    if (method === 'eth_getTransactionByHash') return { hash, from: wallet, to: profile.marketplace, input: data, value: '0x0', chainId: '0x4cef52' };
    if (method === 'eth_getTransactionReceipt') return { status: receiptStatus, transactionHash: hash };
    throw new Error(`Forbidden request: ${method}`);
  } };
  map.set(storageKey(stored), JSON.stringify(stored));
  try { return await fn({ map, provider, calls }); } finally { if (previous === undefined) delete globalThis.localStorage; else globalThis.localStorage = previous; }
}
const records = map => [...map.values()].map(v => JSON.parse(v));

test('a mined intent whose readback lags is kept as mined (non-blocking), never resent', async () => {
  await withStore({ ...base, resumeAttempts: 0 }, '0x1', async ({ map, provider, calls }) => {
    await assert.rejects(resumeWalletIntent({ stored: { ...base, resumeAttempts: 0 }, profile, provider, readback: async () => { throw stale; }, receiptTimeoutMs: 0 }), e => e.code === 'readback-mismatch');
    assert.equal(map.size, 1);
    assert.equal(records(map)[0].status, 'mined');
    assert.ok(!calls.some(m => /send|sign/i.test(m)));
  });
});

test('an exhausted legacy record with a successful receipt is cleared as confirmed-onchain', async () => {
  const stored = { ...base, resumeAttempts: 3 };
  await withStore(stored, '0x1', async ({ map, provider, calls }) => {
    const result = await resumeWalletIntent({ stored, profile, provider, readback: async () => { throw stale; }, receiptTimeoutMs: 0 });
    assert.equal(result.phase, 'confirmed-onchain');
    assert.equal(result.hash, hash);
    assert.equal(map.size, 0);
    assert.ok(calls.includes('eth_getTransactionByHash'), 'canonical transaction binding is still validated');
    assert.ok(!calls.some(m => /send|sign/i.test(m)));
  });
});

test('an exhausted record whose receipt reverted becomes terminal, not cleared as success', async () => {
  const stored = { ...base, resumeAttempts: 3 };
  await withStore(stored, '0x0', async ({ map, provider }) => {
    await assert.rejects(resumeWalletIntent({ stored, profile, provider, readback: async () => { throw stale; }, receiptTimeoutMs: 0 }), e => e.code === 'receipt-reverted');
    assert.equal(records(map)[0].status, 'terminal');
  });
});

test('an exhausted record without a hash is left for manual reconciliation', async () => {
  const stored = { ...base, hash: null, status: 'broadcast-unknown', resumeAttempts: 3 };
  await withStore(stored, '0x1', async ({ map, provider, calls }) => {
    const result = await resumeWalletIntent({ stored, profile, provider, readback: async () => { throw stale; } });
    assert.equal(result, null);
    assert.equal(map.size, 1);
    assert.equal(calls.length, 0);
  });
});
