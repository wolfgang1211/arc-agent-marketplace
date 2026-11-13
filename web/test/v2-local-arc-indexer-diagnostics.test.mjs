import assert from 'node:assert/strict';
import test from 'node:test';
import { adaptiveLogRangeAfter, classifyLocalArcRpcFailure, createAdaptiveLogTransport, createLocalArcTransport } from '../scripts/v2-local-arc-indexer.mjs';

test('classifies RPC failures with method/range and safe message only', () => {
  assert.deepEqual(classifyLocalArcRpcFailure({ method: 'eth_getLogs', fromBlock: 10, toBlock: 20, error: Object.assign(new Error('secret provider body'), { code: -32012 }) }), {
    code: 'INDEXER_RPC_FAILED', method: 'eth_getLogs', blockRange: { from: '10', to: '20' }, httpStatus: undefined, jsonrpcCode: -32012, retryAfterMs: undefined, kind: 'range_too_large', safeMessage: 'RPC log range too large',
  });
  const failure = classifyLocalArcRpcFailure({ method: 'eth_getLogs', fromBlock: 10, toBlock: 20, error: Object.assign(new Error('secret'), { code: 429, httpStatus: 429 }) });
  assert.equal(failure.kind, 'rate_limited');
  assert.equal(failure.safeMessage, 'RPC rate limited');
  assert.equal('message' in failure, false);
});

test('adaptive log range grows and backs off independently from canonical batch size', () => {
  assert.equal(adaptiveLogRangeAfter({ range: 5_000, outcome: 'success' }), 10_000);
  assert.equal(adaptiveLogRangeAfter({ range: 10_000, outcome: 'success' }), 10_000);
  assert.equal(adaptiveLogRangeAfter({ range: 10_000, outcome: 'range_too_large' }), 5_000);
  assert.equal(adaptiveLogRangeAfter({ range: 1_000, outcome: 'timeout' }), 1_000);
});

test('adaptive log transport splits range failures and bounds rate-limit retries', async () => {
  const calls = [];
  const failures = [];
  const waits = [];
  const base = async (method, params) => {
    const from = BigInt(params[0].fromBlock); const to = BigInt(params[0].toBlock);
    calls.push({ from: String(from), to: String(to) });
    if (to - from + 1n > 10_000n) throw Object.assign(new Error('provider detail must not escape'), { code: -32012 });
    return [];
  };
  const transport = createAdaptiveLogTransport({ transport: base, initialRange: 50_000, maxRange: 50_000, onFailure: (x) => failures.push(x), sleep: async (ms) => waits.push(ms) });
  await transport('eth_getLogs', [{ address: '0xabc', fromBlock: '0x64', toBlock: '0xc34f' }]);
  assert.ok(calls.some((x) => BigInt(x.to) - BigInt(x.from) + 1n <= 10_000n));
  assert.equal(failures[0].kind, 'range_too_large');
  assert.ok(failures.every((x) => x.method === 'eth_getLogs' && x.safeMessage));
  assert.deepEqual(waits, []);
});

test('adaptive log transport stops hammering after bounded 429 retries', async () => {
  let calls = 0; const waits = [];
  const transport = createAdaptiveLogTransport({ transport: async () => { calls += 1; throw Object.assign(new Error('provider detail'), { code: 429, httpStatus: 429 }); }, sleep: async (ms) => waits.push(ms) });
  await assert.rejects(() => transport('eth_getLogs', [{ fromBlock: '0x1', toBlock: '0x1' }]), /provider detail/);
  assert.equal(calls, 4);
  assert.deepEqual(waits, [250, 500, 1000]);
});

test('default production retry actually sleeps after a 429', async () => {
  let calls = 0;
  const transport = createAdaptiveLogTransport({ transport: async () => {
    if (++calls === 1) throw Object.assign(new Error('limited'), { httpStatus: 429 });
    return [];
  } });
  const started = performance.now();
  await transport('eth_getLogs', [{ fromBlock: '0x1', toBlock: '0x1' }]);
  assert.ok(performance.now() - started >= 200, 'production backoff must not be a no-op');
});

test('Retry-After is not shortened to two seconds', async () => {
  let calls = 0; const waits = [];
  const transport = createAdaptiveLogTransport({ transport: async () => {
    if (++calls === 1) throw Object.assign(new Error('limited'), { httpStatus: 429, retryAfterMs: 6000 });
    return [];
  }, sleep: async ms => waits.push(ms) });
  await transport('eth_getLogs', [{ fromBlock: '0x1', toBlock: '0x1' }]);
  assert.deepEqual(waits, [6000]);
});

test('429 backoff also protects non-log RPC methods', async () => {
  let calls = 0;
  const transport = createLocalArcTransport({ fetchImpl: async (_, options) => {
    const request = JSON.parse(options.body);
    if (++calls === 1) return Response.json({ jsonrpc: '2.0', id: request.id, error: { code: -32005 } }, { status: 429, headers: { 'retry-after': '1' } });
    return Response.json({ jsonrpc: '2.0', id: request.id, result: '0x4cef52' });
  } });
  await assert.rejects(transport('eth_chainId'));
  const started = performance.now();
  await transport('eth_chainId');
  assert.ok(performance.now() - started >= 900, '429 must back off all RPC methods');
});

test('an upstream signal does not disable the per-request timeout', async () => {
  const upstream = new AbortController();
  const transport = createLocalArcTransport({ timeoutMs: 20, fetchImpl: async (_, options) => {
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  } });
  await assert.rejects(transport('eth_chainId', [], upstream.signal));
});
