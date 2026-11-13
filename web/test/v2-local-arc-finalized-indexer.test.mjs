// Real PGlite store + finalized log-range engine against deterministic RPC
// fixtures. Fixture acceptance only; not a live Arc measurement.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { encodeAbiParameters, encodeEventTopics } from 'viem';
import manifest from '../lib/v2/indexer-event-manifest.json' with { type: 'json' };
import { ARC_TESTNET_PROFILE } from '../lib/v2/chain-profile.mjs';
import { createPgliteDb, migrate } from '../lib/v2/server/db.mjs';
import { createV2IndexerStore } from '../lib/v2/server/indexer-store.mjs';
import { createFinalizedRangeTransport, createLocalArcFinalizedIndexer, LOCAL_ARC_FINALIZED_VERIFICATION_MODE, MAX_FINALIZED_LOG_RANGE } from '../scripts/local-arc-finalized-indexer.mjs';
import { runRpcCountProbe, probeHash } from '../scripts/v2-local-arc-rpc-count-probe.mjs';
import { snapshot as pinnedSnapshot } from './fixtures/v2-indexer-snapshot.mjs';
import { scratchDir } from './scratch-dir.mjs';

const A = ARC_TESTNET_PROFILE.initialAnchor.blockNumber;
const market = manifest.emitters.marketplace;
const qty = (n) => `0x${BigInt(n).toString(16)}`;
const hash = (n, salt = 0) => `0x${(BigInt(salt) * (1n << 200n) + BigInt(n)).toString(16).padStart(64, '0')}`;
const address = (n) => `0x${BigInt(n).toString(16).padStart(40, '0')}`;

function policyLog(number, { transactionIndex = 0, logIndex = 0, minReward = 100n, feeBps = 250n, blockHash = hash(number) } = {}) {
  const abi = manifest.abis.marketplace.find((x) => x.name === 'PolicyChanged');
  const args = { minReward, feeBps };
  const topics = encodeEventTopics({ abi: [abi], eventName: 'PolicyChanged', args: abi.inputs.filter((i) => i.indexed).map((i) => args[i.name]) });
  const nonIndexed = abi.inputs.filter((i) => !i.indexed);
  const data = encodeAbiParameters(nonIndexed.map((i) => ({ type: i.type })), nonIndexed.map((i) => args[i.name]));
  return { address: market, blockNumber: qty(number), blockHash, transactionHash: hash(100000 + number * 10 + transactionIndex), transactionIndex: qty(transactionIndex), logIndex: qty(logIndex), removed: false, topics, data };
}

function makeChain({ final, logs = [], forkFrom = null, forkSalt = 7, hook = null, logsOverride = null, chainIdHex = '0x4cef52', finalityUnsupported = false } = {}) {
  const calls = [];
  const h = (n) => (forkFrom !== null && BigInt(n) >= BigInt(forkFrom) ? hash(n, forkSalt) : hash(n));
  const block = (n) => ({ number: qty(n), hash: h(n), parentHash: h(BigInt(n) - 1n), timestamp: '0x1', transactions: [...new Set(logs.filter((l) => BigInt(l.blockNumber) === BigInt(n)).map((l) => l.transactionHash))] });
  const transport = async (method, params = []) => {
    calls.push({ method, params });
    const hooked = hook?.(method, params, calls);
    if (hooked instanceof Error) throw hooked;
    if (hooked !== undefined) return hooked;
    switch (method) {
      case 'eth_chainId': return chainIdHex;
      case 'eth_blockNumber': return qty(final);
      case 'eth_getBlockByNumber': {
        if (params[0] === 'finalized' || params[0] === 'safe') { if (finalityUnsupported) throw Object.assign(new Error('unsupported'), { code: -32602 }); return block(final); }
        const n = BigInt(params[0]); return n <= BigInt(final) ? block(n) : null;
      }
      case 'eth_getLogs': {
        const filter = params[0]; const from = BigInt(filter.fromBlock); const to = BigInt(filter.toBlock);
        if (logsOverride) return logsOverride(filter);
        const addresses = (Array.isArray(filter.address) ? filter.address : [filter.address]).map((x) => x.toLowerCase());
        return logs.filter((l) => addresses.includes(l.address.toLowerCase()) && BigInt(l.blockNumber) >= from && BigInt(l.blockNumber) <= to);
      }
      default: throw new Error(`fixture: unexpected RPC ${method}`);
    }
  };
  return { transport, calls, hashOf: h };
}
const readerFactory = async ({ transport }) => ({ read: async () => { const tag = await transport('eth_blockNumber', []); const b = await transport('eth_getBlockByNumber', [tag, false]); return pinnedSnapshot(Number(BigInt(tag)), { blockHash: b.hash }); } });

async function setup() { const dir = await mkdtemp(join(scratchDir(), 'v2-arc-finalized-')); const db = await createPgliteDb({ dataDir: dir }); await migrate(db); return { dir, db, store: createV2IndexerStore({ db, profile: ARC_TESTNET_PROFILE }), projected: [], sleeps: [] }; }
async function teardown(ctx) { await ctx.db.close(); await rm(ctx.dir, { recursive: true, force: true }); }
function engine(ctx, chain, options = {}) { return createLocalArcFinalizedIndexer({ db: ctx.db, transport: chain.transport, store: ctx.store, readerFactory, projector: async (_tx, c) => { ctx.projected.push({ events: c.events.length, rebuild: c.rebuild, source: c.prepared.source.blockTag }); }, sleep: async (ms) => { ctx.sleeps.push(ms); }, ...options }); }
async function dbSnapshot(ctx) { const out = {}; for (const t of ['v2_indexer_blocks_fork', 'v2_indexer_events_fork', 'v2_indexer_cursors']) out[t] = (await ctx.db.query(`SELECT * FROM ${t} ORDER BY 1,2,3`)).rows; return out; }
const logSpans = (chain) => chain.calls.filter((c) => c.method === 'eth_getLogs').map((c) => [BigInt(c.params[0].fromBlock), BigInt(c.params[0].toBlock)]);
const rowsAt = async (ctx, n) => (await ctx.db.query("SELECT block_hash,parent_hash,canonical FROM v2_indexer_blocks_fork WHERE stream='marketplace' AND block_number=$1", [String(n)])).rows;
const cur = (n, salt = 0) => ({ blockNumber: String(n), blockHash: hash(n, salt) });

test('10k inclusive cap: first range is exactly 10,000 blocks and later spans are contiguous', async () => {
  const ctx = await setup();
  try {
    assert.throws(() => engine(ctx, makeChain({ final: A + 1 }), { logRange: MAX_FINALIZED_LOG_RANGE + 1 }), /logRange/);
    const chain = makeChain({ final: A + 25_000 });
    const first = await engine(ctx, chain, { maxRanges: 1 }).syncOnce();
    assert.equal(first.status, 'catching_up');
    const [[from, to]] = logSpans(chain);
    assert.equal(from, BigInt(A + 1)); assert.equal(to - from + 1n, 10_000n);
    assert.deepEqual(await ctx.store.cursor(), cur(A + 10_000));
    const second = await engine(ctx, chain, { maxRanges: 8 }).syncOnce();
    assert.equal(second.status, 'healthy');
    const spans = logSpans(chain);
    for (let i = 0; i < spans.length; i += 1) { assert.ok(spans[i][1] - spans[i][0] + 1n <= 10_000n); if (i) assert.equal(spans[i][0], spans[i - 1][1] + 1n); }
    assert.equal(spans.at(-1)[1], BigInt(A + 25_000));
  } finally { await teardown(ctx); }
});

test('no legacy per-block header or receipt calls; health is explicit log-only finalized trust', async () => {
  const ctx = await setup();
  try {
    const chain = makeChain({ final: A + 25_000 });
    const indexer = engine(ctx, chain, { maxRanges: 8 });
    assert.equal((await indexer.syncOnce()).status, 'healthy');
    assert.equal(chain.calls.filter((c) => /receipt/i.test(c.method)).length, 0);
    const numericHeaders = chain.calls.filter((c) => c.method === 'eth_getBlockByNumber' && /^0x/.test(c.params[0])).length;
    assert.ok(numericHeaders <= 50, `numeric header reads ${numericHeaders}`);
    const rows = (await ctx.db.query("SELECT count(*)::int AS n FROM v2_indexer_blocks_fork WHERE stream='marketplace'")).rows[0].n;
    assert.ok(rows < 60, `sparse rows ${rows}`);
    const health = indexer.health();
    assert.equal(health.status, 'healthy'); assert.equal(health.stale, false); assert.equal(health.gap, null);
    assert.equal(health.verificationMode, LOCAL_ARC_FINALIZED_VERIFICATION_MODE);
    assert.equal(health.finalityTrust, 'provider-finalized-tag');
    assert.equal(health.evidence.perBlockReceipts, false); assert.equal(health.evidence.logsBloomProof, false);
    assert.equal(health.evidence.parentContinuity, 'adjacent-observed-heights-only');
    const denied = createFinalizedRangeTransport({ transport: async () => '0x0' });
    await assert.rejects(() => denied('eth_getBlockReceipts', ['0x1']), /denied/);
    await assert.rejects(() => denied('eth_getTransactionReceipt', [hash(1)]), /denied/);
    await assert.rejects(() => denied('eth_sendRawTransaction', ['0x00']), /denied/);
  } finally { await teardown(ctx); }
});

test('event-block header binding stores only observed heights; mismatched log block hash is rejected without mutation', async () => {
  const ctx = await setup();
  try {
    const logs = [policyLog(A + 5000, { transactionIndex: 0, logIndex: 0 }), policyLog(A + 5000, { transactionIndex: 1, logIndex: 1, minReward: 200n }), policyLog(A + 15_000)];
    const result = await engine(ctx, makeChain({ final: A + 20_000, logs })).syncOnce();
    assert.equal(result.status, 'healthy');
    assert.equal((await ctx.store.rawEvents()).length, 3);
    assert.equal((await rowsAt(ctx, A + 5000))[0].block_hash, hash(A + 5000));
    assert.equal((await rowsAt(ctx, A + 15_000))[0].block_hash, hash(A + 15_000));
    assert.equal((await rowsAt(ctx, A + 4999)).length, 0);
    assert.deepEqual(ctx.projected.map((p) => p.events), [2, 1]);
  } finally { await teardown(ctx); }
  const bad = await setup();
  try {
    const before = await dbSnapshot(bad);
    const result = await engine(bad, makeChain({ final: A + 20_000, logs: [policyLog(A + 5000, { blockHash: hash(A + 5000, 99) })] })).syncOnce();
    assert.equal(result.status, 'degraded'); assert.equal(result.error.code, 'INDEXER_VALIDATION_FAILED');
    assert.deepEqual(await dbSnapshot(bad), before);
  } finally { await teardown(bad); }
});

test('empty contiguous ranges advance the cursor only to observed boundaries and continue by parent hash', async () => {
  const ctx = await setup();
  try {
    const chain = makeChain({ final: A + 100 });
    assert.equal((await engine(ctx, chain, { logRange: 40, maxRanges: 1 }).syncOnce()).status, 'catching_up');
    assert.deepEqual(await ctx.store.cursor(), cur(A + 40));
    assert.equal((await rowsAt(ctx, A + 20)).length, 0);
    assert.equal((await engine(ctx, chain, { logRange: 40, maxRanges: 1 }).syncOnce()).status, 'catching_up');
    assert.deepEqual(await ctx.store.cursor(), cur(A + 80));
    assert.equal((await rowsAt(ctx, A + 41))[0].parent_hash, hash(A + 40));
    assert.equal((await rowsAt(ctx, A + 60)).length, 0);
  } finally { await teardown(ctx); }
});

test('next range gap, wrong parent, missing boundary, and stale cursor are rejected by the store', async () => {
  const ctx = await setup();
  try {
    await engine(ctx, makeChain({ final: A + 100 }), { logRange: 40, maxRanges: 1 }).syncOnce();
    const c = await ctx.store.cursor(); const n = Number(c.blockNumber);
    const header = (k, parent = hash(k - 1)) => ({ blockNumber: String(k), blockHash: hash(k), parentHash: parent, transactionCount: 0, header: {} });
    await assert.rejects(() => ctx.store.applyFinalizedLogRange({ expectedCursor: c, range: { from: String(n + 2), to: String(n + 5) }, headers: [header(n + 2), header(n + 5)] }), /does not continue/);
    await assert.rejects(() => ctx.store.applyFinalizedLogRange({ expectedCursor: c, range: { from: String(n + 1), to: String(n + 5) }, headers: [header(n + 1, hash(1, 5)), header(n + 5)] }), /does not continue/);
    await assert.rejects(() => ctx.store.applyFinalizedLogRange({ expectedCursor: c, range: { from: String(n + 1), to: String(n + 5) }, headers: [header(n + 1)] }), /end boundary/);
    await assert.rejects(() => ctx.store.applyFinalizedLogRange({ expectedCursor: cur(A + 1), range: { from: String(n + 1), to: String(n + 5) }, headers: [header(n + 1), header(n + 5)] }), /stale/);
    await assert.rejects(() => ctx.store.applyFinalizedLogRange({ range: { from: String(n + 1), to: String(n + 5) }, headers: [header(n + 1), header(n + 5)] }), /explicit expected cursor/);
    await assert.rejects(() => ctx.store.applyFinalizedLogRange({ expectedCursor: c, range: { from: String(n + 1), to: String(n + 10_001) }, headers: [header(n + 1), header(n + 10_001)] }), /1\.\.10000 blocks/);
    const before = await dbSnapshot(ctx);
    const broken = makeChain({ final: A + 100, hook: (method, params) => (method === 'eth_getBlockByNumber' && params[0] === qty(n + 1) ? { number: qty(n + 1), hash: hash(n + 1), parentHash: hash(n, 3), timestamp: '0x1', transactions: [] } : undefined) });
    assert.equal((await engine(ctx, broken, { logRange: 40, maxRanges: 1 }).syncOnce()).status, 'degraded');
    assert.deepEqual(await dbSnapshot(ctx), before);
  } finally { await teardown(ctx); }
});

test('exact replay is idempotent; conflicting header/event payloads and conflicting log identities are rejected', async () => {
  const ctx = await setup();
  try {
    const log = policyLog(A + 5);
    const ev = (data = log.data) => ({ stream: 'marketplace', emitter: market, blockNumber: String(A + 5), blockHash: hash(A + 5), transactionHash: log.transactionHash, transactionIndex: 0, logIndex: 0, topics: log.topics, data, decoded: { args: { minReward: '100', feeBps: '250' } }, eventName: 'PolicyChanged' });
    const header = (k, txCount = 0) => ({ blockNumber: String(k), blockHash: hash(k), parentHash: hash(k - 1), transactionCount: txCount, header: {} });
    const range = { from: String(A + 1), to: String(A + 10) };
    let projectionCalls = 0; const projector = async () => { projectionCalls += 1; };
    await ctx.store.applyFinalizedLogRange({ expectedCursor: null, initialVerifiedAnchor: cur(A), range, headers: [header(A + 1), header(A + 5, 1), header(A + 10)], events: [ev()], projector });
    const replay = await ctx.store.applyFinalizedLogRange({ expectedCursor: cur(A + 10), range, headers: [header(A + 1), header(A + 5, 1), header(A + 10)], events: [ev()], projector });
    assert.equal(projectionCalls, 1, 'exact replay must not reapply projection side effects');
    assert.equal(replay.replay, true); assert.equal((await ctx.store.rawEvents()).length, 1); assert.deepEqual(await ctx.store.cursor(), cur(A + 10));
    await assert.rejects(() => ctx.store.applyFinalizedLogRange({ expectedCursor: cur(A + 10), range, headers: [header(A + 1), header(A + 5, 2), header(A + 10)], events: [ev()] }), /conflicts/);
    await assert.rejects(() => ctx.store.applyFinalizedLogRange({ expectedCursor: cur(A + 10), range, headers: [header(A + 1), header(A + 5, 1), header(A + 10)], events: [ev(`0x${'00'.repeat(64)}`)] }), /conflicting event/);
  } finally { await teardown(ctx); }
  const dup = await setup();
  try {
    const before = await dbSnapshot(dup);
    const logs = [policyLog(A + 5), { ...policyLog(A + 5, { minReward: 999n }) }];
    const result = await engine(dup, makeChain({ final: A + 50, logs })).syncOnce();
    assert.equal(result.status, 'degraded'); assert.deepEqual(await dbSnapshot(dup), before);
  } finally { await teardown(dup); }
});

test('end boundary source change and projector failure roll back without cursor advancement', async () => {
  const ctx = await setup();
  try {
    const end = qty(A + 10_000); let reads = 0;
    const before = await dbSnapshot(ctx);
    const chain = makeChain({ final: A + 30_000, hook: (method, params) => { if (method === 'eth_getBlockByNumber' && params[0] === end && ++reads >= 3) return { number: end, hash: hash(A + 10_000, 9), parentHash: hash(A + 9999), timestamp: '0x1', transactions: [] }; return undefined; } });
    const result = await engine(ctx, chain, { maxRanges: 1 }).syncOnce();
    assert.equal(result.status, 'degraded'); assert.equal(result.error.code, 'INDEXER_SOURCE_CHANGED');
    assert.deepEqual(await dbSnapshot(ctx), before);
    const failing = createLocalArcFinalizedIndexer({ db: ctx.db, transport: makeChain({ final: A + 50, logs: [policyLog(A + 5)] }).transport, store: ctx.store, readerFactory, projector: async () => { throw new Error('projection failed'); }, sleep: async () => {} });
    const failed = await failing.syncOnce();
    assert.equal(failed.status, 'degraded'); assert.equal(failed.error.code, 'INDEXER_STORE_REJECTED');
    assert.deepEqual(await dbSnapshot(ctx), before);
    assert.equal(failing.health().gap.reason, 'failed_finalized_log_range');
  } finally { await teardown(ctx); }
});

test('near-head reorg within 32 blocks rolls back to an observed ancestor; deeper reorg halts without mutation', async () => {
  const ctx = await setup();
  try {
    assert.equal((await engine(ctx, makeChain({ final: A + 100 })).syncOnce()).status, 'healthy');
    const forked = makeChain({ final: A + 103, forkFrom: A + 96 });
    const indexer = engine(ctx, forked);
    assert.equal((await indexer.syncOnce()).status, 'healthy');
    assert.deepEqual(await ctx.store.cursor(), cur(A + 103, 7));
    assert.equal(indexer.health().reorg.depth, 5);
    assert.equal((await rowsAt(ctx, A + 98)).find((r) => r.block_hash === hash(A + 98)).canonical, false);
    assert.equal(ctx.projected.at(-1).rebuild, true);
  } finally { await teardown(ctx); }
  const deep = await setup();
  try {
    await engine(deep, makeChain({ final: A + 100 })).syncOnce();
    const before = await dbSnapshot(deep);
    const result = await engine(deep, makeChain({ final: A + 110, forkFrom: A + 60 })).syncOnce();
    assert.equal(result.status, 'degraded'); assert.equal(result.error.code, 'INDEXER_DEEP_REORG');
    assert.deepEqual(await dbSnapshot(deep), before);
  } finally { await teardown(deep); }
});

test('pinned chain and pinned emitter/ABI: malformed logs never mutate state', async (t) => {
  const base = policyLog(A + 5);
  const cases = [
    ['chain mismatch', { chainIdHex: '0x1' }],
    ['foreign emitter', { logsOverride: () => [{ ...base, address: address(0x99) }] }],
    ['removed=true', { logsOverride: () => [{ ...base, removed: true }] }],
    ['removed omitted', { logsOverride: () => { const copy = { ...base }; delete copy.removed; return [copy]; } }],
    ['unknown topic', { logsOverride: () => [{ ...base, topics: [hash(1)] }] }],
    ['truncated data', { logsOverride: () => [{ ...base, data: '0x00' }] }],
    ['log outside requested range', { logsOverride: (f) => [{ ...policyLog(Number(BigInt(f.toBlock)) + 5) }] }],
    ['non-array logs', { logsOverride: () => ({}) }],
  ];
  for (const [label, options] of cases) await t.test(label, async () => {
    const ctx = await setup();
    try {
      const before = await dbSnapshot(ctx);
      const result = await engine(ctx, makeChain({ final: A + 50, logs: [base], ...options })).syncOnce();
      assert.equal(result.status, 'degraded'); assert.deepEqual(await dbSnapshot(ctx), before);
    } finally { await teardown(ctx); }
  });
});

test('-32005 rate limits back off exponentially with real waits and never advance the cursor falsely', async () => {
  const ctx = await setup();
  try {
    const before = await dbSnapshot(ctx);
    const limited = makeChain({ final: A + 50, hook: (method) => (method === 'eth_getLogs' ? Object.assign(new Error('limited'), { code: -32005 }) : undefined) });
    const result = await engine(ctx, limited, { maxRateLimitRetries: 3, baseBackoffMs: 100 }).syncOnce();
    assert.equal(result.status, 'degraded'); assert.equal(result.error.code, 'INDEXER_RATE_LIMITED');
    assert.deepEqual(ctx.sleeps, [100, 200, 400]);
    assert.deepEqual(await dbSnapshot(ctx), before);
    ctx.sleeps.length = 0; let failures = 0;
    const transient = makeChain({ final: A + 50, hook: (method) => (method === 'eth_getLogs' && failures++ < 2 ? Object.assign(new Error('limited'), { code: -32005 }) : undefined) });
    assert.equal((await engine(ctx, transient, { maxRateLimitRetries: 3, baseBackoffMs: 100 }).syncOnce()).status, 'healthy');
    assert.deepEqual(ctx.sleeps, [100, 200]);
    assert.deepEqual(await ctx.store.cursor(), cur(A + 50));
  } finally { await teardown(ctx); }
});

test('range-too-large shrinks the end only and commits contiguous honest ranges; missing finality halts', async () => {
  const ctx = await setup();
  try {
    const chain = makeChain({ final: A + 12_000, hook: (method, params) => (method === 'eth_getLogs' && BigInt(params[0].toBlock) - BigInt(params[0].fromBlock) + 1n > 2500n ? Object.assign(new Error('too large'), { code: -32012 }) : undefined) });
    await engine(ctx, chain, { maxRanges: 1 }).syncOnce();
    assert.deepEqual(await ctx.store.cursor(), cur(A + 2500));
    const before = await dbSnapshot(ctx);
    const noFinality = makeChain({ final: A + 12_000, finalityUnsupported: true });
    const result = await engine(ctx, noFinality).syncOnce();
    assert.equal(result.status, 'degraded'); assert.equal(result.error.code, 'INDEXER_FINALITY_UNAVAILABLE');
    assert.equal(noFinality.calls.filter((c) => c.method === 'eth_getLogs').length, 0);
    assert.deepEqual(await dbSnapshot(ctx), before);
  } finally { await teardown(ctx); }
});

test('fixture request-count harness: legacy createV2Indexer vs finalized engine over exactly 1000 empty blocks', { timeout: 180_000 }, async (t) => {
  const report = await runRpcCountProbe({ blocks: 1000, scratchRoot: scratchDir() });
  t.diagnostic(JSON.stringify(report));
  const { legacyReceiptBloom: legacy, finalizedLogRange: next } = report;
  assert.equal(report.fixtureBased, true); assert.equal(report.liveMeasurement, false);
  const final = { blockNumber: String(A + 1000), blockHash: probeHash(A + 1000) };
  assert.equal(legacy.status, 'healthy'); assert.deepEqual(legacy.cursor, final);
  assert.equal(next.status, 'healthy'); assert.deepEqual(next.cursor, final);
  assert.ok(legacy.numericHeaderCallsUpperBound >= 1000);
  assert.equal(next.receiptCalls, 0); assert.equal(next.logical.eth_getLogs, 1);
  assert.equal(legacy.storedBlockRows, 1001); assert.equal(next.storedBlockRows, 34);
  for (const side of [legacy, next]) assert.equal(side.wire.requests, 2 * side.logicalTotal - (side.logical.eth_chainId ?? 0));
  assert.ok(next.logicalTotal * 10 < legacy.logicalTotal);
});

test('parent: advancing finalized tag is rechecked against a fresh head', async () => {
  const ctx = await setup(); let headReads = 0;
  try {
    const chain = makeChain({ final: A + 10, hook: method => method === 'eth_blockNumber' ? qty(A + (++headReads === 1 ? 9 : 10)) : undefined });
    assert.equal((await engine(ctx, chain).syncOnce()).status, 'healthy');
  } finally { await teardown(ctx); }
});

test('parent: latest header resolves a lagging eth_blockNumber without inventing a head', async () => {
  const ctx = await setup();
  try {
    const chain = makeChain({ final: A + 10, hook: (method, params) => method === 'eth_blockNumber' ? qty(A + 9) : method === 'eth_getBlockByNumber' && params[0] === 'latest' ? { number: qty(A + 10), hash: hash(A + 10), parentHash: hash(A + 9), transactions: [], timestamp: '0x1' } : undefined });
    assert.equal((await engine(ctx, chain).syncOnce()).status, 'healthy');
  } finally { await teardown(ctx); }
});

test('parent: event transaction hash must match its actual header position', async () => {
  const ctx = await setup();
  try {
    const logs = [policyLog(A + 2)];
    const chain = makeChain({ final: A + 10, logs, hook: (method, params) => method === 'eth_getBlockByNumber' && params[0] === qty(A + 2) ? { number: qty(A + 2), hash: hash(A + 2), parentHash: hash(A + 1), timestamp: '0x1', transactions: [hash(99999999)] } : undefined });
    const before = await dbSnapshot(ctx);
    assert.equal((await engine(ctx, chain).syncOnce()).status, 'degraded');
    assert.deepEqual(await dbSnapshot(ctx), before);
  } finally { await teardown(ctx); }
});

test('parent: replay cannot omit an already committed event', async () => {
  const ctx = await setup();
  try {
    assert.equal((await engine(ctx, makeChain({ final: A + 10, logs: [policyLog(A + 2)] })).syncOnce()).status, 'healthy');
    const cursor = await ctx.store.cursor();
    const headers = (await ctx.store.canonicalBlocks()).filter(r => BigInt(r.block_number) > BigInt(A)).map(r => ({ blockNumber: String(r.block_number), blockHash: r.block_hash, parentHash: r.parent_hash, transactionCount: Number(r.transaction_count), header: r.header }));
    await assert.rejects(ctx.store.applyFinalizedLogRange({ range: { from: String(A + 1), to: String(A + 10) }, headers, events: [], expectedCursor: cursor }), /replay.*event|event.*replay/);
  } finally { await teardown(ctx); }
});

test('parent: a changed finalized cursor far behind head must halt rather than rewind', async () => {
  const ctx = await setup();
  try {
    assert.equal((await engine(ctx, makeChain({ final: A + 50 })).syncOnce()).status, 'healthy');
    const before = await dbSnapshot(ctx);
    const result = await engine(ctx, makeChain({ final: A + 10000, forkFrom: A + 45 })).syncOnce();
    assert.equal(result.status, 'degraded');
    assert.equal(result.error.code, 'INDEXER_DEEP_REORG');
    assert.deepEqual(await dbSnapshot(ctx), before);
  } finally { await teardown(ctx); }
});
