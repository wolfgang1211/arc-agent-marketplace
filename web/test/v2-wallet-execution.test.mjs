import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeFunctionData } from 'viem';
import manifest from '../lib/v2/action-manifest.json' with { type: 'json' };
import { assertReadbackIdentity, executeWalletAction, loadV2Profile, sameExpected, storageKey } from '../lib/v2/new-wallet-execution.mjs';

const wallet = '0x1111111111111111111111111111111111111111';
const profile = { id: 'arc', chainId: '5042002', rpcUrl: 'https://rpc.invalid', marketplace: '0xfa156b7a5205b123c8a22a807ba98405e36130f1', vault: '0xd5b271b7bf4696d662b2bcB1a94b408887c6C423', usdc: '0x2222222222222222222222222222222222222222' };
const prepared = { action: 'approve', intentId: 'intent-1', expiry: Date.now() + 60_000, expected: { stateVersion: '4' }, transaction: { to: profile.marketplace, value: '0', data: '0x' } };

test('wallet execution refuses wrong chain before simulation or send', async () => {
  const calls = [];
  const provider = { request: async ({ method }) => { calls.push(method); if (method === 'eth_accounts') return [wallet]; if (method === 'eth_chainId') return '0x7a69'; throw new Error(`unexpected ${method}`); } };
  await assert.rejects(() => executeWalletAction(prepared, { profile, provider }), (error) => error.code === 'wrong-chain');
  assert.deepEqual(calls, ['eth_accounts', 'eth_chainId']);
  assert.equal(calls.includes('eth_sendTransaction'), false);
});

test('readback matching is exact and does not accept local expected state', () => {
  assert.equal(sameExpected({ stateVersion: '4', status: 'completed' }, { stateVersion: '4' }), true);
  assert.equal(sameExpected({ stateVersion: '5' }, { stateVersion: '4' }), false);
  assert.equal(sameExpected({ stateVersion: '4' }, { stateVersion: '4', deadline: '9' }), false);
});

test('pending intent key is scoped to profile, chain, wallet and action', () => {
  const key = storageKey({ profileId: 'arc', chainId: '5042002', wallet, action: 'approve', intentId: 'i-1' });
  assert.match(key, /^v2-wallet-intent:arc:5042002:0x1111.*:approve:i-1$/);
  assert.notEqual(key, storageKey({ profileId: 'arc', chainId: '31337', wallet, action: 'approve', intentId: 'i-1' }));
});

test('profile loader fails closed on missing or malformed public profile', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ profile: { chainId: '5042002' } }), { status: 200 });
    await assert.rejects(loadV2Profile(), (error) => error.code === 'profile-unavailable');
  } finally { globalThis.fetch = originalFetch; }
});

test('expired prepared intent does not call wallet provider', async () => {
  let calls = 0;
  const provider = { request: async () => { calls += 1; return []; } };
  await assert.rejects(() => executeWalletAction({ ...prepared, expiry: Date.now() - 1 }, { profile, provider }), (error) => error.code === 'expired');
  assert.equal(calls, 0);
});

test('readback identity rejects omitted profile, wallet, action or hash', () => {
  const intent = { intentId: 'intent-1', profileId: 'arc', chainId: '5042002', wallet, action: 'approve', expected: { stateVersion: '4' } };
  const hash = `0x${'ab'.repeat(32)}`;
  const complete = { ok: true, confirmed: true, intentId: 'intent-1', profileId: 'arc', chainId: '5042002', wallet, action: 'approve', hash, state: { stateVersion: '4', status: '6' } };
  assert.equal(assertReadbackIdentity(complete, intent, hash).confirmed, true);
  for (const key of ['profileId', 'chainId', 'wallet', 'action', 'hash']) {
    const omitted = { ...complete };
    delete omitted[key];
    assert.throws(() => assertReadbackIdentity(omitted, intent, hash), (error) => error.code === 'readback-mismatch');
  }
  assert.throws(() => assertReadbackIdentity({ ...complete, state: { status: '6' } }, intent, hash), (error) => error.code === 'readback-mismatch');
});

test('uncertain broadcast is stored before send and blocks a second submission', async () => {
  const approve = manifest.contracts.marketplace.abi.find((item) => item.name === 'approve');
  const data = encodeFunctionData({ abi: [approve], functionName: 'approve', args: [7n, 3n] });
  const map = new Map();
  globalThis.localStorage = { get length() { return map.size; }, key: (index) => [...map.keys()][index] ?? null, getItem: (key) => map.get(key) ?? null, setItem: (key, value) => { map.set(key, String(value)); }, removeItem: (key) => { map.delete(key); } };
  const sends = [];
  const provider = { request: async ({ method, params }) => {
    if (method === 'eth_accounts') return [wallet];
    if (method === 'eth_chainId') return '0x4cef52';
    if (method === 'eth_call') return '0x';
    if (method === 'eth_estimateGas') return '0x5208';
    if (method === 'eth_blockNumber') return '0x10';
    if (method === 'eth_getBlockByNumber') return { number: '0x10', baseFeePerGas: '0x1', hash: `0x${'11'.repeat(32)}` };
    if (method === 'eth_getTransactionCount') return '0x1';
    if (method === 'eth_gasPrice') return '0x1';
    if (method === 'eth_sendTransaction') {
      sends.push(params[0]);
      const stored = [...map.values()].map((value) => JSON.parse(value));
      assert.equal(stored.some((item) => item.status === 'broadcast-unknown' && item.hash === null && item.action === 'approve'), true);
      throw Object.assign(new Error('broadcast dropped'), { code: 'NETWORK_ERROR' });
    }
    throw new Error(`unexpected ${method}`);
  } };
  const action = { ...prepared, transaction: { ...prepared.transaction, from: wallet, data } };
  await assert.rejects(() => executeWalletAction(action, { profile, provider }), (error) => error.code === 'broadcast-uncertain');
  assert.equal(sends.length, 1);
  await assert.rejects(() => executeWalletAction({ ...action, intentId: 'intent-2' }, { profile, provider }), (error) => error.code === 'reconciliation-required');
  assert.equal(sends.length, 1);
  delete globalThis.localStorage;
});
