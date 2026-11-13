import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalArcPrefetchTransport as createTransport, createLocalArcTransport } from '../scripts/v2-local-arc-indexer.mjs';
import { ARC_TESTNET_PROFILE } from '../lib/v2/chain-profile.mjs';
const createLocalArcPrefetchTransport = options => createTransport({ historicalCeiling: 100_000_000n, ...options });

const hash = n => `0x${BigInt(n).toString(16).padStart(64, '0')}`;
const header = n => ({ number: `0x${BigInt(n).toString(16)}`, hash: hash(n), parentHash: hash(BigInt(n) - 1n), transactions: [hash(1000n + BigInt(n))], logsBloom: `0x${'00'.repeat(256)}` });
const receipts = n => [{ blockNumber: `0x${BigInt(n).toString(16)}`, blockHash: hash(n), transactionHash: hash(1000n + BigInt(n)), transactionIndex: '0x0', logs: [] }];
function stubBatch({ mutate, chain = '0x4cef52' } = {}) {
  const calls = [];
  const batchTransport = async (requests) => {
    calls.push(requests);
    return requests.map((request, i) => request.method === 'eth_getBlockByNumber' ? mutate?.(header(BigInt(request.params[0]))) ?? header(BigInt(request.params[0])) : receipts(BigInt(request.params[0])));
  };
  return { calls, batchTransport };
}

function fakeBatchFetch({ transform = row => row, status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (_, init) => {
    const requests = JSON.parse(init.body); calls.push(requests);
    const rows = requests.map(request => ({ jsonrpc: '2.0', id: request.id, result: request.method === 'eth_chainId' ? '0x4cef52' : request.method === 'eth_getBlockByNumber' ? header(BigInt(request.params[0])) : receipts(BigInt(request.params[0])) }));
    return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => transform(rows) };
  };
  return { calls, fetchImpl };
}

test('prefetch makes one 41-request batch and returns unchanged core-shaped values', async () => {
  const { calls, batchTransport } = stubBatch();
  const transport = createLocalArcPrefetchTransport({ transport: async () => { throw new Error('must not use scalar historical call'); }, batchTransport });
  const h = await transport('eth_getBlockByNumber', ['0x100', false]);
  const r = await transport('eth_getBlockReceipts', ['0x100']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 40);
  assert.equal(h.number, '0x100');
  assert.deepEqual(r, receipts(0x100));
  assert.deepEqual(h, header(0x100));
});

test('strict numeric historical calls only; tags and eth_call never enter cache', async () => {
  const { calls, batchTransport } = stubBatch(); let scalar = 0;
  const transport = createLocalArcPrefetchTransport({ transport: async (method, params) => { scalar += 1; return { method, params }; }, batchTransport });
  await transport('eth_getBlockByNumber', ['latest', false]);
  await transport('eth_getBlockByNumber', ['0x10', true]);
  await transport('eth_call', [{ to: '0x1' }, 'latest']);
  assert.equal(calls.length, 0); assert.equal(scalar, 3);
});

test('one-use cache evicts both methods per height and repeated heights fetch fresh', async () => {
  let round = 0; const calls = [];
  const transport = createLocalArcPrefetchTransport({ transport: async (method, params) => { calls.push(++round); return { ...header(BigInt(params[0])), round }; }, batchTransport: async requests => { calls.push(++round); return requests.map(r => r.method === 'eth_getBlockByNumber' ? { ...header(BigInt(r.params[0])), round } : receipts(BigInt(r.params[0]))); } });
  const first = await transport('eth_getBlockByNumber', ['0x20', false]);
  await transport('eth_getBlockReceipts', ['0x20']);
  const second = await transport('eth_getBlockByNumber', ['0x20', false]);
  assert.deepEqual(calls, [1, 2]); assert.notEqual(first.round, second.round);
});

test('partial, duplicate, unknown, malformed, or wrong-height batches reject before caching', async t => {
  for (const [name, make] of [
    ['partial', rows => rows.slice(0, -1)],
    ['duplicate id', rows => rows.map((row, i) => i === 1 ? { ...row, id: rows[0].id } : row)],
    ['unknown id', rows => rows.map((row, i) => i === 1 ? { ...row, id: 999999 } : row)],
    ['malformed jsonrpc', rows => rows.map((row, i) => i === 2 ? { ...row, jsonrpc: '1.0' } : row)],
    ['wrong height', rows => rows.map((row, i) => i === 1 ? { ...row, result: { ...row.result, number: '0x0' } } : row)],
    ['missing receipt', rows => rows.map((row, i) => i === 21 ? { ...row, result: null } : row)],
    ['RPC error', rows => rows.map((row, i) => i === 2 ? { ...row, error: { code: -32603 } } : row)],
  ]) {
    await t.test(name, async () => {
      const { fetchImpl } = fakeBatchFetch({ transform: make });
      const base = createLocalArcTransport({ profile: ARC_TESTNET_PROFILE, fetchImpl });
      const transport = createLocalArcPrefetchTransport({ transport: base, batchTransport: base.batch });
      await assert.rejects(() => transport('eth_getBlockByNumber', ['0x30', false]), /V2_RPC_UNAVAILABLE|invalid RPC prefetch/);
      transport.clear();
    });
  }
});

test('wrong chain never exposes partial cache', async () => {
  const { fetchImpl } = fakeBatchFetch({ transform: rows => rows.map((row, i) => i === 0 ? { ...row, result: '0x1' } : row) });
  const base = createLocalArcTransport({ profile: ARC_TESTNET_PROFILE, fetchImpl });
  const transport = createLocalArcPrefetchTransport({ transport: base, batchTransport: base.batch });
  await assert.rejects(() => transport('eth_getBlockByNumber', ['0x40', false]), /V2_RPC_UNAVAILABLE|prefetch/);
  assert.equal(typeof transport.clear, 'function'); transport.clear();
});

test('missing receipt is rejected atomically and an aborted prefetch is not reused', async () => {
  const calls = []; let abortFirst = true;
  const transport = createLocalArcPrefetchTransport({
    transport: async () => {},
    batchTransport: async (requests, signal) => {
      calls.push(1);
      if (abortFirst) {
        abortFirst = false;
        await new Promise((resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }));
      }
      return requests.map(r => r.method === 'eth_getBlockByNumber' ? header(BigInt(r.params[0])) : receipts(BigInt(r.params[0])));
    },
  });
  const controller = new AbortController(); const pending = transport('eth_getBlockByNumber', ['0x60', false], controller.signal);
  await new Promise(setImmediate); controller.abort();
  await assert.rejects(pending);
  assert.deepEqual(await transport('eth_getBlockByNumber', ['0x60', false]), header(0x60));
  assert.equal(calls.length, 2);

  const missing = createLocalArcPrefetchTransport({ transport: async () => {}, batchTransport: async requests => requests.map(r => r.method === 'eth_getBlockByNumber' ? header(BigInt(r.params[0])) : null) });
  await assert.rejects(() => missing('eth_getBlockReceipts', ['0x61']), /invalid RPC prefetch result/);
});

test('batch transport pins canonical public RPC, sends chainId once, and preserves abort timeout', async () => {
  const { calls, fetchImpl } = fakeBatchFetch();
  const base = createLocalArcTransport({ profile: ARC_TESTNET_PROFILE, fetchImpl, timeoutMs: 50 });
  const result = await base.batch([{ method: 'eth_getBlockByNumber', params: ['0x50', false] }, { method: 'eth_getBlockReceipts', params: ['0x50'] }]);
  assert.equal(calls.length, 1); assert.equal(calls[0].length, 3); assert.equal(calls[0][0].method, 'eth_chainId');
  assert.equal(result[0].number, '0x50'); assert.deepEqual(result[1], receipts(0x50));
});

test('configurable small windows validate their own exact cardinality', async () => {
  const { batchTransport } = stubBatch();
  const transport = createLocalArcPrefetchTransport({ transport: async () => {}, batchTransport, maxBlocks: 2, historicalCeiling: 100_000_000n });
  assert.deepEqual(await transport('eth_getBlockByNumber', ['0x50', false]), header(0x50));
});

test('an aborted signal cannot consume an already prefetched entry', async () => {
  const { batchTransport } = stubBatch();
  const transport = createLocalArcPrefetchTransport({ transport: async () => {}, batchTransport, historicalCeiling: 100_000_000n });
  await transport('eth_getBlockByNumber', ['0x50', false]);
  const signal = AbortSignal.abort();
  await assert.rejects(transport('eth_getBlockByNumber', ['0x51', false], signal));
});

test('distant windows evict old fork evidence instead of accumulating cache', async () => {
  let round = 0;
  const transport = createLocalArcPrefetchTransport({ transport: async () => {}, historicalCeiling: 100_000_000n, batchTransport: async requests => {
    round += 1;
    return requests.map(r => r.method === 'eth_getBlockByNumber' ? { ...header(BigInt(r.params[0])), round } : receipts(BigInt(r.params[0])));
  } });
  await transport('eth_getBlockByNumber', ['0x50', false]);
  await transport('eth_getBlockByNumber', ['0x100', false]);
  const result = await transport('eth_getBlockByNumber', ['0x51', false]);
  assert.equal(result.round, 3);
});

test('batch request cap rejects oversized input before network access', async () => {
  let calls = 0;
  const base = createLocalArcTransport({ fetchImpl: async () => { calls++; throw new Error('network must not run'); } });
  await assert.rejects(base.batch(Array.from({ length: 41 }, () => ({ method: 'eth_getBlockReceipts', params: ['0x1'] }))), /invalid RPC batch/);
  assert.equal(calls, 0);
});

test('window stops before observed head and unknown head disables prefetch', async () => {
  const { calls, batchTransport } = stubBatch(); let scalar = 0;
  const transport = createTransport({ transport: async (method, params) => { scalar++; return method === 'eth_blockNumber' ? '0x53' : header(BigInt(params[0])); }, batchTransport });
  await transport('eth_getBlockByNumber', ['0x50', false]);
  assert.equal(calls.length, 0);
  await transport('eth_blockNumber');
  await transport('eth_getBlockByNumber', ['0x50', false]);
  assert.equal(calls[0].length, 6);
  assert.ok(calls[0].every(r => BigInt(r.params[0]) < 0x53n));
  await transport('eth_getBlockByNumber', ['0x53', false]);
  assert.equal(calls.length, 1); assert.equal(scalar, 3);
});
