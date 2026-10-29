import test from 'node:test';
import assert from 'node:assert/strict';
import { executeWalletAction, loadV2Profile, sameExpected, storageKey } from '../lib/v2/new-wallet-execution.mjs';

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
