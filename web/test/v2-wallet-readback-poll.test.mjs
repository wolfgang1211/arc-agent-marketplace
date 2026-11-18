import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeFunctionData, keccak256 } from 'viem';
import manifest from '../lib/v2/action-manifest.json' with { type: 'json' };
import { defaultReadback, assertReadbackIdentity, resumeWalletIntent, storageKey } from '../lib/v2/new-wallet-execution.mjs';

const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });
const wallet = '0x1111111111111111111111111111111111111111';
const hash = `0x${'ab'.repeat(32)}`;
const profile = { id: 'arc-testnet', chainId: '5042002', marketplace: '0xfa156b7a5205b123c8a22a807ba98405e36130f1', vault: '0xd5b271b7bf4696d662b2bcb1a94b408887c6c423', usdc: '0x2222222222222222222222222222222222222222', rpcUrl: 'https://rpc.invalid' };
const intent = { intentId: '00000000-0000-4000-8000-000000000001', profileId: profile.id, chainId: profile.chainId, wallet, action: 'registerOperator', expected: { action: 'registerOperator', wallet, registered: true } };
const confirmed = { ok: true, confirmed: true, intentId: intent.intentId, profileId: profile.id, chainId: profile.chainId, wallet, action: intent.action, hash, state: intent.expected };
function pollFixture(responses) {
  let clock = 0;
  const calls = [];
  const options = { timeoutMs: 30, intervalMs: 10, now: () => clock, sleep: async (ms) => { clock += ms; }, fetcher: async (url, init) => {
    calls.push({ url, init });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body), { status: next.status });
  } };
  globalThis.fetch = options.fetcher;
  return { options, calls };
}

test('canonical readback waits across pending receipt/indexer/reader states and verifies the exact identity', async () => {
  const f = pollFixture([
    { status: 200, body: { status: 'pending' } },
    { status: 503, body: { error: 'INDEXER_UNAVAILABLE' } },
    { status: 503, body: { error: 'READER_UNAVAILABLE' } },
    { status: 200, body: confirmed },
  ]);
  f.options.timeoutMs = 100;
  const result = await defaultReadback(hash, intent.intentId, f.options);
  assert.equal(assertReadbackIdentity(result, intent, hash).confirmed, true);
  assert.equal(f.calls.length, 4);
  for (const { url, init } of f.calls) {
    assert.equal(url, `/api/v2/transactions/${hash}?intent=${intent.intentId}`);
    assert.equal(init.credentials, 'same-origin');
    assert.equal(init.cache, 'no-store');
    assert.ok(!init.method || init.method === 'GET');
  }
});
test('canonical verification timeout stays pending instead of claiming state mismatch', async () => {
  const f = pollFixture([{ status: 503, body: { error: 'INDEXER_UNAVAILABLE' } }]);
  await assert.rejects(defaultReadback(hash, intent.intentId, f.options), (error) => error.code === 'verification-pending');
  assert.ok(f.calls.length <= 4);
});
test('transport failure stays pending without treating it as a proven state mismatch', async () => {
  const f = pollFixture([new TypeError('offline'), { status: 200, body: confirmed }]);
  await assert.rejects(defaultReadback(hash, intent.intentId, f.options), (error) => error.code === 'verification-pending');
  assert.equal(f.calls.length, 1);
});
for (const [status, body] of [
  [409, { error: 'INTENT_MISMATCH' }],
  [409, { error: 'READBACK_MISMATCH' }],
  [503, { error: 'READER_MISMATCH' }],
  [404, { error: 'NOT_FOUND' }],
  [500, { error: 'INTERNAL_ERROR' }],
  [503, { error: 'UNKNOWN_ERROR' }],
]) test(`HTTP ${status} ${body.error} is not retried or silently accepted`, async () => {
  const f = pollFixture([{ status, body }, { status: 200, body: confirmed }]);
  await assert.rejects(defaultReadback(hash, intent.intentId, f.options), (error) => error.code === 'readback-mismatch');
  assert.equal(f.calls.length, 1);
});
for (const status of [401, 403]) test(`HTTP ${status} requires the original session, never retries a wallet send`, async () => {
  const f = pollFixture([{ status, body: { error: 'INVALID_SESSION' } }]);
  await assert.rejects(defaultReadback(hash, intent.intentId, f.options), (error) => error.code === 'verification-session');
  assert.equal(f.calls.length, 1);
});
test('successful HTTP with forged or incomplete proof still fails exact identity checks', async () => {
  const f = pollFixture([{ status: 200, body: { ...confirmed, wallet: profile.usdc } }]);
  const result = await defaultReadback(hash, intent.intentId, f.options);
  assert.throws(() => assertReadbackIdentity(result, intent, hash), (error) => error.code === 'readback-mismatch');
});

test('malformed verification JSON is a hard stop, even with HTTP 200', async () => {
  let calls = 0;
  await assert.rejects(defaultReadback(hash, intent.intentId, { fetcher: async () => { calls += 1; return new Response('not JSON'); } }), (error) => error.code === 'readback-mismatch');
  assert.equal(calls, 1);
});

async function resume(readback) {
  const previous = globalThis.localStorage;
  const map = new Map();
  globalThis.localStorage = { get length() { return map.size; }, key: (i) => [...map.keys()][i], getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
  const data = encodeFunctionData({ abi: manifest.contracts.marketplace.abi, functionName: 'registerOperator', args: [] });
  const stored = { ...intent, status: 'broadcast', hash, to: profile.marketplace, calldataHash: keccak256(data), autoResume: true, resumeAttempts: 0 };
  const calls = [];
  const provider = { request: async ({ method }) => {
    calls.push(method);
    if (method === 'eth_accounts') return [wallet];
    if (method === 'eth_chainId') return '0x4cef52';
    if (method === 'eth_getTransactionByHash') return { hash, from: wallet, to: profile.marketplace, input: data, value: '0x0', chainId: '0x4cef52' };
    if (method === 'eth_getTransactionReceipt') return { status: '0x1', transactionHash: hash };
    throw new Error(`Forbidden resume request: ${method}`);
  } };
  globalThis.localStorage.setItem(storageKey(stored), JSON.stringify(stored));
  try { return await readback({ stored, provider, calls, map }); }
  finally { if (previous === undefined) delete globalThis.localStorage; else globalThis.localStorage = previous; }
}
test('readback failure retains the original action/hash and stored intent; resume never sends', async () => {
  await resume(async ({ stored, provider, calls, map }) => {
    const pending = Object.assign(new Error('still indexing'), { code: 'verification-pending' });
    await assert.rejects(resumeWalletIntent({ stored, profile, provider, readback: async () => { throw pending; } }), (error) => error.code === 'verification-pending' && error.transaction?.hash === hash && error.transaction?.action === 'registerOperator');
    assert.equal(map.size, 1);
    assert.ok(!calls.some((method) => /send|sign/i.test(method)));
  });
});
test('successful resumed verification preserves the real action and clears only the verified intent', async () => {
  await resume(async ({ stored, provider, calls, map }) => {
    const result = await resumeWalletIntent({ stored, profile, provider, readback: async () => confirmed });
    assert.equal(result.phase, 'success');
    assert.equal(result.action, 'registerOperator');
    assert.equal(result.hash, hash);
    assert.equal(map.size, 0);
    assert.ok(!calls.some((method) => /send|sign/i.test(method)));
  });
});
