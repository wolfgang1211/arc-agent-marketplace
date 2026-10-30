import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeFunctionData } from 'viem';
import manifest from '../lib/v2/action-manifest.json' with { type: 'json' };
import { assertReadbackIdentity, executeWalletAction, loadV2Profile, reconcileWalletBroadcast, resumeWalletIntent, sameExpected, storageKey } from '../lib/v2/new-wallet-execution.mjs';

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

function memoryStorage() {
  const map = new Map();
  return { get length() { return map.size; }, key: (index) => [...map.keys()][index] ?? null, getItem: (key) => map.get(key) ?? null, setItem: (key, value) => { map.set(key, String(value)); }, removeItem: (key) => { map.delete(key); } };
}
function storedIntents() { return [...Array(globalThis.localStorage.length).keys()].map((index) => JSON.parse(globalThis.localStorage.getItem(globalThis.localStorage.key(index)))); }
function providerFor({ onSend, allowance = `0x${'00'.repeat(32)}`, receiptFor, transactionFor }) {
  const sends = [];
  const provider = { request: async ({ method, params }) => {
    if (method === 'eth_accounts') return [wallet];
    if (method === 'eth_chainId') return '0x4cef52';
    if (method === 'eth_call') return String(params?.[0]?.data ?? '').startsWith('0xdd62ed3e') ? allowance : `0x${'00'.repeat(31)}01`;
    if (method === 'eth_estimateGas') return '0x5208';
    if (method === 'eth_blockNumber') return '0x10';
    if (method === 'eth_getBlockByNumber') return { number: '0x10', baseFeePerGas: '0x1', hash: `0x${'11'.repeat(32)}` };
    if (method === 'eth_getTransactionCount') return '0x1';
    if (method === 'eth_gasPrice') return '0x1';
    if (method === 'eth_sendTransaction') { sends.push(params[0]); return onSend(params[0], sends); }
    if (method === 'eth_getTransactionReceipt') return receiptFor?.(params[0]) ?? { status: '0x1', transactionHash: params[0], blockNumber: '0x11', blockHash: `0x${'22'.repeat(32)}` };
    if (method === 'eth_getTransactionByHash') return transactionFor?.(params[0]) ?? null;
    throw new Error(`unexpected ${method}`);
  } };
  return { provider, sends };
}
function depositAction(intentId = 'intent-dep') {
  const item = manifest.contracts.vault.abi.find((entry) => entry.name === 'depositStake');
  const data = encodeFunctionData({ abi: [item], functionName: 'depositStake', args: [20n] });
  return { action: 'depositStake', intentId, expiry: Date.now() + 60_000, expected: { freeStake: '20' }, allowance: { token: profile.usdc, spender: profile.vault, requiredAmount: '20' }, transaction: { to: profile.vault, from: wallet, value: '0', data } };
}
function mainAction(intentId = 'intent-main') {
  const item = manifest.contracts.marketplace.abi.find((entry) => entry.name === 'approve');
  const data = encodeFunctionData({ abi: [item], functionName: 'approve', args: [7n, 3n] });
  return { action: 'approve', intentId, expiry: Date.now() + 60_000, expected: { stateVersion: '4' }, transaction: { to: profile.marketplace, from: wallet, value: '0', data } };
}
const confirmed = (hash, intentId, action = 'approve') => ({ ok: true, confirmed: true, intentId, profileId: profile.id, chainId: profile.chainId, wallet, action, hash, state: { stateVersion: '4', status: '6' } });

for (const [label, kind, reject] of [
  ['direct 4001', 'main', () => Object.assign(new Error('SECRET_PROVIDER_TEXT'), { code: 4001 })],
  ['wrapped 4001', 'main', () => { const inner = { code: 4001, message: 'SECRET_PROVIDER_TEXT' }; const mid = new Error('wrapped'); mid.cause = inner; const outer = new Error('viem outer'); outer.cause = mid; return outer; }],
  ['approval direct 4001', 'approval', () => Object.assign(new Error('SECRET_PROVIDER_TEXT'), { code: 4001 })],
  ['approval wrapped 4001', 'approval', () => { const inner = { code: 4001, message: 'SECRET_PROVIDER_TEXT' }; const mid = new Error('wrapped'); mid.cause = inner; return mid; }],
]) {
  test(`${label} clears only that attempt and does not resend`, async () => {
    globalThis.localStorage = memoryStorage();
    localStorage.setItem('v2-wallet-intent:other', JSON.stringify({ intentId: 'keep-me', status: 'broadcast' }));
    const { provider, sends } = providerFor({ onSend: () => { throw reject(); } });
    const action = kind === 'approval' ? depositAction() : mainAction();
    await assert.rejects(() => executeWalletAction(action, { profile, provider, receiptTimeoutMs: 0 }), (caught) => caught.code === 'wallet-rejected' && caught.message.includes('SECRET_PROVIDER_TEXT') === false);
    assert.equal(sends.length, 1);
    assert.equal(storedIntents().some((item) => item.intentId === action.intentId || item.intentId === `${action.intentId}:approval`), false);
    assert.equal(storedIntents().some((item) => item.intentId === 'keep-me'), true);
    await assert.rejects(() => resumeWalletIntent({ stored: { intentId: action.intentId, profileId: profile.id, chainId: profile.chainId, wallet, action: action.action, status: 'broadcast-unknown', autoResume: true, hash: null }, profile, provider, receiptTimeoutMs: 0 }), (caught) => caught.code === 'reconciliation-required');
    assert.equal(sends.length, 1);
    delete globalThis.localStorage;
  });
}

test('explicit hash reconciliation completes a hashless broadcast without sending again', async () => {
  globalThis.localStorage = memoryStorage();
  const hash = `0x${'12'.repeat(32)}`;
  let observed = null;
  const { provider, sends } = providerFor({
    onSend: (tx) => { observed = tx; throw Object.assign(new Error('dropped'), { code: 'NETWORK_ERROR' }); },
    transactionFor: () => ({ from: wallet, to: observed.to, input: observed.data, chainId: `0x${BigInt(profile.chainId).toString(16)}` }),
  });
  const action = mainAction('reconcile-main');
  await assert.rejects(() => executeWalletAction(action, { profile, provider, receiptTimeoutMs: 0 }), (error) => error.code === 'broadcast-uncertain');
  const pending = storedIntents().find((item) => item.intentId === action.intentId);
  const readback = async () => confirmed(hash, action.intentId);
  const done = await reconcileWalletBroadcast({ stored: pending, observedHash: hash, profile, provider, readback, receiptTimeoutMs: 0 });
  assert.equal(done.phase, 'success');
  assert.equal(sends.length, 1);
  assert.equal(storedIntents().some((item) => item.intentId === action.intentId), false);
  delete globalThis.localStorage;
});

test('an explicit new attempt after rejection sends once more and is not an automatic retry', async () => {
  globalThis.localStorage = memoryStorage();
  let rejected = true;
  const hash = `0x${'ab'.repeat(32)}`;
  const { provider, sends } = providerFor({ onSend: () => { if (rejected) { rejected = false; throw Object.assign(new Error('SECRET_PROVIDER_TEXT'), { code: 4001 }); } return hash; } });
  const action = mainAction();
  await assert.rejects(() => executeWalletAction(action, { profile, provider, receiptTimeoutMs: 0 }), (error) => error.code === 'wallet-rejected');
  assert.equal(sends.length, 1);
  const readback = async () => confirmed(hash, 'intent-main-2');
  const done = await executeWalletAction({ ...action, intentId: 'intent-main-2' }, { profile, provider, readback, receiptTimeoutMs: 0 });
  assert.equal(done.phase, 'success');
  assert.equal(sends.length, 2);
  assert.equal(done.readback.confirmed, true);
  delete globalThis.localStorage;
});

for (const kind of ['main', 'approval']) {
  test(`${kind} uncertain broadcast stays stored and blocks automatic resend`, async () => {
    globalThis.localStorage = memoryStorage();
    const { provider, sends } = providerFor({ onSend: () => { throw Object.assign(new Error('SECRET_DROPPED'), { code: 'NETWORK_ERROR' }); } });
    const action = kind === 'approval' ? depositAction(`dep-${kind}`) : mainAction(`main-${kind}`);
    await assert.rejects(() => executeWalletAction(action, { profile, provider, receiptTimeoutMs: 0 }), (caught) => caught.code === 'broadcast-uncertain' && caught.message.includes('SECRET_DROPPED') === false);
    assert.equal(sends.length, 1);
    const pending = storedIntents().find((item) => item.status === 'broadcast-unknown' && item.hash === null);
    assert.equal(pending.autoResume, false);
    await assert.rejects(() => executeWalletAction({ ...action, intentId: 'second' }, { profile, provider, receiptTimeoutMs: 0 }), (caught) => caught.code === 'reconciliation-required');
    assert.equal(sends.length, 1);
    await assert.rejects(() => reconcileWalletBroadcast({ stored: pending, profile, provider }), (caught) => caught.code === 'reconciliation-required');
    assert.equal(storedIntents().some((item) => item.intentId === pending.intentId && item.hash === null), true);
    assert.equal(sends.length, 1);
    delete globalThis.localStorage;
  });

  test(`${kind} receipt timeout and stale readback do not send again on reload`, async () => {
    globalThis.localStorage = memoryStorage();
    const hash = `0x${(kind === 'approval' ? 'cd' : 'ef').repeat(32)}`;
    let receipts = 0;
    const { provider, sends } = providerFor({
      onSend: () => hash,
      allowance: kind === 'approval' ? `0x${'00'.repeat(32)}` : `0x${'ff'.repeat(32)}`,
      receiptFor: () => { receipts += 1; if (receipts === 1) throw new Error('not mined'); return { status: '0x1', transactionHash: hash }; },
    });
    const action = kind === 'approval' ? depositAction(`time-${kind}`) : mainAction(`time-${kind}`);
    const readback = async () => ({ ok: true, confirmed: true, intentId: action.intentId, profileId: profile.id, chainId: profile.chainId, wallet, action: action.action, hash, state: { stateVersion: '9' } });
    await assert.rejects(() => executeWalletAction(action, { profile, provider, readback, receiptTimeoutMs: 0 }), (error) => error.code === 'timeout');
    assert.equal(sends.length, 1);
    const pending = storedIntents().find((item) => item.hash === hash);
    await assert.rejects(() => resumeWalletIntent({ stored: pending, profile, provider, readback, receiptTimeoutMs: 0 }), (error) => error.code === 'readback-mismatch' || error.code === 'timeout');
    assert.equal(sends.length, 1);
    delete globalThis.localStorage;
  });
}
