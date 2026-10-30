import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { createPgliteDb, migrate } from '../lib/v2/server/db.mjs';
import { createV2Indexer } from '../lib/v2/server/indexer.mjs';
import { createV2IndexerStore } from '../lib/v2/server/indexer-store.mjs';

import { snapshot as pinnedSnapshot, pinnedReader } from './fixtures/v2-indexer-snapshot.mjs';
import { scratchDir } from './scratch-dir.mjs';

const chainId = 5042002;
const marketplace = '0xFA156B7A5205B123c8a22A807ba98405e36130f1';
const vault = '0xD5B271b7Bf4696d662B2bcB1a94b408887c6C423';
const hash = (n) => `0x${BigInt(n).toString(16).padStart(64, '0')}`;
const anchorNumber = 68072733;
const validSnapshot = (blockNumber = 68072744) => pinnedSnapshot(blockNumber);
const noopProjector = async () => {};

async function setup() {
  const dir = await mkdtemp(join(scratchDir(), 'v2-indexer-guards-'));
  const db = await createPgliteDb({ dataDir: dir });
  await migrate(db);
  const store = createV2IndexerStore({ db, chainId, marketplace, vault });
  return { dir, db, store };
}
async function teardown(ctx) { await ctx.db.close(); await rm(ctx.dir, { recursive: true, force: true }); }
function block(number, parentHash = hash(number - 1)) { return { number: `0x${BigInt(number).toString(16)}`, hash: hash(number), parentHash, timestamp: '0x1', transactions: [], logsBloom: `0x${'00'.repeat(256)}` }; }
function transportFixture({ head = 68072744, code = '0x', fail = null, calls = [] } = {}) {
  return async (method, params) => {
    calls.push({ method, params });
    if (fail) throw fail;
    if (method === 'eth_blockNumber') return `0x${BigInt(head).toString(16)}`;
    if (method === 'eth_chainId') return '0x4cef52';
    if (method === 'eth_getCode') return code;
    if (method === 'eth_getBlockByNumber') {
      const tag = params[0];
      if (tag === 'finalized' || tag === 'safe') throw Object.assign(new Error('unsupported'), { code: -32602 });
      return block(Number(BigInt(tag)));
    }
    if (method === 'eth_getLogs') return [];
    if (method === 'eth_getBlockReceipts') return [];
    throw new Error(`unexpected RPC ${method}`);
  };
}
function fixtureReader(snapshot = null) { return snapshot ? async () => ({ read: async () => snapshot }) : pinnedReader(); }
function makeIndexer(ctx, transport, options = {}) {
  return createV2Indexer({ db: ctx.db, transport, store: ctx.store, projector: noopProjector, readerFactory: fixtureReader(), confirmations: 0, ...options });
}

 test('default reader is actually invoked and empty runtime code cannot reach a cursor', async () => {
  const ctx = await setup(); const calls = [];
  try {
    const result = await createV2Indexer({ db: ctx.db, transport: transportFixture({ calls }), store: ctx.store, projector: noopProjector, confirmations: 0 }).syncOnce();
    assert.equal(result.status, 'degraded');
    assert.ok(calls.some(({ method }) => method === 'eth_getCode'), 'default createV2ChainReader must perform runtime verification');
    assert.equal(await ctx.store.cursor(), null);
    assert.equal(calls.some(({ method }) => method === 'eth_sendRawTransaction'), false);
  } finally { await teardown(ctx); }
});

test('attest-only or verify-bypass readers are rejected before any indexing work', async (t) => {
  for (const [label, reader] of [['verify', { verify: true }], ['attest', { attest: async () => validSnapshot() }]]) {
    await t.test(label, async () => {
      const ctx = await setup(); const calls = [];
      try {
        const result = await createV2Indexer({ db: ctx.db, transport: transportFixture({ calls }), store: ctx.store, projector: noopProjector, readerFactory: async () => reader, confirmations: 0 }).syncOnce();
        assert.equal(result.status, 'degraded');
        assert.equal(await ctx.store.cursor(), null);
      } finally { await teardown(ctx); }
    });
  }
});

test('malformed snapshot metadata and pin/hash attestations never become healthy', async (t) => {
  const cases = [
    ['missing block tag', { ...validSnapshot(), blockTag: '68072744' }],
    ['malformed block hash', { ...validSnapshot(), blockHash: '0x12' }],
    ['malformed normalized pin', { ...validSnapshot(), hashes: { marketplaceNormalized: '0x12', vaultNormalized: hash(2) } }],
    ['wrong chain metadata', { ...validSnapshot(), chainId: 31337n }],
  ];
  for (const [label, snapshot] of cases) await t.test(label, async () => {
    const ctx = await setup();
    try {
      const result = await createV2Indexer({ db: ctx.db, transport: transportFixture(), store: ctx.store, projector: noopProjector, readerFactory: fixtureReader(snapshot), confirmations: 0 }).syncOnce();
      assert.equal(result.status, 'degraded');
      assert.equal((await createV2Indexer({ db: ctx.db, transport: transportFixture(), store: ctx.store, projector: noopProjector, readerFactory: fixtureReader(snapshot) }).health()).status, 'starting');
      assert.equal(await ctx.store.cursor(), null);
    } finally { await teardown(ctx); }
  });
});

test('fixed Arc chain and deployment configuration is enforced at construction', async () => {
  const ctx = await setup();
  try {
    assert.throws(() => createV2Indexer({ db: ctx.db, transport: async () => '0x0', store: ctx.store, chainId: 31337 }), /configured Arc deployment/);
    assert.throws(() => createV2Indexer({ db: ctx.db, transport: async () => '0x0', store: ctx.store, marketplace: vault }), /configured Arc deployment/);
  } finally { await teardown(ctx); }
});

test('only the verified 68072733 anchor is accepted; arbitrary height 43 is rejected', async () => {
  const ctx = await setup();
  try {
    const bad = makeIndexer(ctx, transportFixture(), { initialAnchor: { blockNumber: '43', blockHash: hash(43) } });
    const result = await bad.syncOnce();
    assert.equal(result.status, 'degraded');
    assert.equal(await ctx.store.cursor(), null);
    const good = makeIndexer(ctx, transportFixture({ head: anchorNumber }), { initialAnchor: { blockNumber: String(anchorNumber), blockHash: hash(anchorNumber) } });
    assert.equal((await good.syncOnce()).status, 'healthy');
  } finally { await teardown(ctx); }
});

test('reader RPC surface is read-only and never permits raw transaction submission', async () => {
  const ctx = await setup(); const calls = [];
  try {
    const result = await createV2Indexer({ db: ctx.db, transport: transportFixture({ calls }), store: ctx.store, projector: noopProjector, confirmations: 0 }).syncOnce();
    assert.equal(result.status, 'degraded');
    assert.ok(calls.every(({ method }) => ['eth_blockNumber', 'eth_getBlockByNumber', 'eth_chainId', 'eth_getCode', 'eth_getLogs'].includes(method)));
    assert.equal(calls.some(({ method }) => method.includes('sendRaw') || method === 'eth_sendTransaction'), false);
  } finally { await teardown(ctx); }
});

test('a never-resolving transport is bounded by the configured timeout and total budget', async () => {
  const ctx = await setup();
  try {
    const started = Date.now();
    const result = await createV2Indexer({ db: ctx.db, transport: () => new Promise(() => {}), store: ctx.store, projector: noopProjector, readerFactory: fixtureReader(), timeoutMs: 20, totalBudgetMs: 50 }).syncOnce();
    assert.equal(result.status, 'degraded');
    assert.ok(Date.now() - started < 500, 'timeout guard must not hang');
  } finally { await teardown(ctx); }
});

test('maxBatches bounds actual head work and reports truthful catching_up status', async (t) => {
  for (const maxBatches of [1, 2]) await t.test(`maxBatches=${maxBatches}`, async () => {
    const expectedBlock = anchorNumber + maxBatches * 100;
    const ctx = await setup(); const calls = [];
    try {
      const result = await createV2Indexer({ db: ctx.db, transport: transportFixture({ head: anchorNumber + 1000, calls }), store: ctx.store, projector: noopProjector, readerFactory: fixtureReader(), initialAnchor: { blockNumber: String(anchorNumber), blockHash: hash(anchorNumber) }, batchSize: 100, maxBatches, confirmations: 0 }).syncOnce();
      assert.equal(result.status, 'catching_up');
      assert.deepEqual(await ctx.store.cursor(), { blockNumber: String(expectedBlock), blockHash: hash(expectedBlock) });
      assert.equal(calls.filter(({ method }) => method === 'eth_getLogs').length, maxBatches * 2);
    } finally { await teardown(ctx); }
  });
});

test('failed sync is degraded with a fixed safe error and preserves the prior cursor', async () => {
  const ctx = await setup();
  try {
    await ctx.store.applyBatch({ initialVerifiedAnchor: { blockNumber: String(anchorNumber), blockHash: hash(anchorNumber) }, headers: [{ blockNumber: String(anchorNumber + 1), blockHash: hash(anchorNumber + 1), parentHash: hash(anchorNumber), transactionCount: 0 }] });
    const prior = await ctx.store.cursor();
    const result = await makeIndexer(ctx, transportFixture({ fail: new Error('SECRET transport detail') }), { initialAnchor: { blockNumber: String(anchorNumber), blockHash: hash(anchorNumber) } }).syncOnce();
    assert.equal(result.status, 'degraded');
    assert.equal(result.error.message, 'indexer RPC request failed');
    assert.equal(result.error.message.includes('SECRET'), false);
    assert.deepEqual(await ctx.store.cursor(), prior);
    assert.equal((await makeIndexer(ctx, transportFixture({ fail: new Error('again') })).health()).status, 'starting');
  } finally { await teardown(ctx); }
});
