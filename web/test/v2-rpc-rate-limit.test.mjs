import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadOnlyV2Transport, V2_RPC_MAX_IN_FLIGHT } from '../lib/v2/server/api-runtime.mjs';
import { ARC_TESTNET_PROFILE } from '../lib/v2/chain-profile.mjs';

const CHAIN = `0x${ARC_TESTNET_PROFILE.canonicalChainId.toString(16)}`;
function mockFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => handler(JSON.parse(init.body));
  return () => { globalThis.fetch = original; };
}
const ok = (id, result) => new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), { status: 200 });

test('rate-limited JSON-RPC (-32005) is retried and then succeeds', async () => {
  let storageCalls = 0;
  const restore = mockFetch(body => {
    if (body.method === 'eth_chainId') return ok(body.id, CHAIN);
    storageCalls++;
    if (storageCalls < 3) return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32005, message: 'rate limit exceeded' } }), { status: 200 });
    return ok(body.id, `0x${'00'.repeat(32)}`);
  });
  try {
    const t = createReadOnlyV2Transport();
    const value = await t('eth_getStorageAt', [ARC_TESTNET_PROFILE.marketplace, '0x0', '0x1']);
    assert.equal(value, `0x${'00'.repeat(32)}`);
    assert.equal(storageCalls, 3);
  } finally { restore(); }
});

test('persistent HTTP 429 is retried then fails closed as V2_RPC_UNAVAILABLE', async () => {
  let codeCalls = 0;
  const restore = mockFetch(body => { if (body.method === 'eth_chainId') return ok(body.id, CHAIN); codeCalls++; return new Response('', { status: 429 }); });
  try {
    const t = createReadOnlyV2Transport();
    await assert.rejects(t('eth_getCode', [ARC_TESTNET_PROFILE.marketplace, '0x1']), /V2_RPC_UNAVAILABLE/);
    assert.equal(codeCalls, 4, 'initial attempt + 3 retries');
  } finally { restore(); }
});

test('non rate-limit RPC errors are not retried', async () => {
  let calls = 0;
  const restore = mockFetch(body => { if (body.method === 'eth_chainId') return ok(body.id, CHAIN); calls++; return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32000, message: 'execution reverted' } }), { status: 200 }); });
  try {
    const t = createReadOnlyV2Transport();
    await assert.rejects(t('eth_call', [{ to: ARC_TESTNET_PROFILE.marketplace, data: '0x' }, '0x1']), /V2_RPC_UNAVAILABLE/);
    assert.equal(calls, 1);
  } finally { restore(); }
});

test('in-flight RPC requests are capped across parallel transports', async () => {
  let inFlight = 0, peak = 0;
  const restore = mockFetch(async body => { inFlight++; peak = Math.max(peak, inFlight); await new Promise(r => setTimeout(r, 5)); inFlight--; return body.method === 'eth_chainId' ? ok(body.id, CHAIN) : ok(body.id, `0x${'11'.repeat(32)}`); });
  try {
    const reads = Array.from({ length: 30 }, () => createReadOnlyV2Transport()('eth_getStorageAt', [ARC_TESTNET_PROFILE.marketplace, '0x0', '0x1']));
    await Promise.all(reads);
    assert.ok(peak <= V2_RPC_MAX_IN_FLIGHT, `peak ${peak} exceeded cap`);
  } finally { restore(); }
});
