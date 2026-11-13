import assert from 'node:assert/strict';
import test from 'node:test';
import { adaptiveBatchSizeAfter, createAdaptiveLocalArcSync, createLocalArcTransport } from '../scripts/v2-local-arc-indexer.mjs';
import { ARC_TESTNET_PROFILE } from '../lib/v2/chain-profile.mjs';

test('adaptive batch grows only after a verified cursor-advancing success', () => {
  assert.equal(adaptiveBatchSizeAfter({ batchSize: 25, outcome: 'success', maxBatchSize: 1000 }), 50);
  assert.equal(adaptiveBatchSizeAfter({ batchSize: 50, outcome: 'success', maxBatchSize: 1000 }), 100);
  assert.equal(adaptiveBatchSizeAfter({ batchSize: 25, outcome: 'degraded', maxBatchSize: 1000 }), 12);
  assert.equal(adaptiveBatchSizeAfter({ batchSize: 1, outcome: 'degraded', maxBatchSize: 1000 }), 1);
});

test('adaptive runner backs down after a budget failure and never invents a cursor', async () => {
  const seen = [];
  let call = 0;
  const result = await createAdaptiveLocalArcSync({
    initialBatchSize: 25,
    maxBatchSize: 1000,
    maxAttempts: 2,
    totalBudgetMs: 1000,
    now: (() => { let t = 0; return () => (t += 100); })(),
    makeIndexer: ({ batchSize, totalBudgetMs }) => {
      seen.push({ batchSize, totalBudgetMs });
      return { syncOnce: async () => (++call === 1
        ? { status: 'degraded', cursor: { blockNumber: '10' }, error: Object.assign(new Error('budget'), { code: 'INDEXER_BUDGET_EXHAUSTED' }) }
        : { status: 'catching_up', cursor: { blockNumber: '11' }, headers: 1, events: 0 }) };
    },
  });
  assert.equal(result.status, 'catching_up');
  assert.deepEqual(result.cursor, { blockNumber: '11' });
  assert.deepEqual(seen.map((x) => x.batchSize), [25, 12]);
  assert.ok(seen.every((x) => x.totalBudgetMs > 0));
});

test('adaptive runner does not grow on a non-advancing success', async () => {
  const seen = [];
  const result = await createAdaptiveLocalArcSync({
    initialBatchSize: 25,
    maxAttempts: 2,
    makeIndexer: ({ batchSize }) => {
      seen.push(batchSize);
      return { syncOnce: async () => ({ status: 'healthy', cursor: { blockNumber: '10' }, headers: 0, events: 0 }) };
    },
  });
  assert.equal(result.status, 'healthy');
  assert.deepEqual(seen, [25]);
});

test('local transport is pinned to the public Arc RPC and rechecks chain identity', async () => {
  const calls = [];
  const transport = createLocalArcTransport({
    profile: ARC_TESTNET_PROFILE,
    fetchImpl: async (url, init) => {
      calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      return { ok: true, async json() { return { jsonrpc: '2.0', id: calls.at(-1).body.id, result: calls.at(-1).body.method === 'eth_chainId' ? '0x4cef52' : '0xabc' }; } };
    },
  });
  assert.equal(await transport('eth_blockNumber'), '0xabc');
  assert.equal(calls[0].url, 'https://rpc.testnet.arc.io');
  assert.equal(calls[0].headers['user-agent'], 'Mozilla/5.0');
  assert.equal(calls[1].body.method, 'eth_blockNumber');
  await assert.rejects(() => transport('eth_sendRawTransaction', ['0x00']), /V2_RPC_METHOD_DENIED/);
});
