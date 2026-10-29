import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { encodeAbiParameters, encodeEventTopics, hexToBytes, keccak256 } from 'viem';
import manifest from '../lib/v2/indexer-event-manifest.json' with { type: 'json' };
import { createPgliteDb, migrate } from '../lib/v2/server/db.mjs';
import { createV2Indexer, snapshotTransactionHashes } from '../lib/v2/server/indexer.mjs';
import { createV2IndexerStore } from '../lib/v2/server/indexer-store.mjs';

import { snapshot as pinnedSnapshot, pinnedReader } from './fixtures/v2-indexer-snapshot.mjs';
import { scratchDir } from './scratch-dir.mjs';

const chainId = 5042002;
const market = manifest.emitters.marketplace;
const vault = manifest.emitters.vault;
const anchor = 68072733;
const target = 68072744;
const hash = (n) => `0x${BigInt(n).toString(16).padStart(64, '0')}`;
const address = (n) => `0x${BigInt(n).toString(16).padStart(40, '0')}`;
const argsFor = { PolicyChanged: { minReward: 100n, feeBps: 250n } };
function eventAbi(source, name) { return manifest.abis[source].find((x) => x.name === name); }
function canonicalLog(source, name, number, transactionIndex = 0, logIndex = 0) {
  const abi = eventAbi(source, name); const args = argsFor[name];
  const values = abi.inputs.map((input) => { assert.notEqual(args[input.name], undefined, `${name}.${input.name}`); return args[input.name]; });
  const topics = encodeEventTopics({ abi: [abi], eventName: name, args: values.filter((_, i) => abi.inputs[i].indexed) });
  const nonIndexed = abi.inputs.filter((input) => !input.indexed);
  const data = encodeAbiParameters(nonIndexed.map((input) => ({ type: input.type })), nonIndexed.map((input) => args[input.name]));
  return { address: source === 'marketplace' ? market : vault, blockNumber: `0x${BigInt(number).toString(16)}`, blockHash: hash(number), transactionHash: hash(100000 + number * 10 + transactionIndex), transactionIndex: `0x${transactionIndex.toString(16)}`, logIndex: `0x${logIndex.toString(16)}`, removed: false, topics, data };
}
function bloomFixture(values) {
  const out = new Uint8Array(256); const setBitIndices = [];
  for (const value of values) {
    const bytes = hexToBytes(keccak256(hexToBytes(value)));
    for (let i = 0; i < 3; i += 1) {
      // Independent reference calculation: the Ethereum bloom uses the low
      // 11 bits of each big-endian hash word, then addresses bits MSB-first.
      const word = BigInt((bytes[i * 2] << 8) | bytes[i * 2 + 1]);
      const bit = Number(word & 2047n);
      setBitIndices.push(bit);
      out[255 - Math.floor(bit / 8)] |= 1 << (bit % 8);
    }
  }
  return { bloom: `0x${Buffer.from(out).toString('hex')}`, setBitIndices };
}
function bloom(logs) { return bloomFixture(logs.flatMap((log) => [log.address, ...(log.topics ?? [])])).bloom; }
function header(number, parentHash = hash(number - 1), transactions = [], logs = []) { return { number: `0x${BigInt(number).toString(16)}`, hash: hash(number), parentHash, timestamp: '0x1', transactions, logsBloom: bloom(logs) }; }
function snapshot(blockNumber, blockHash = hash(blockNumber)) { return pinnedSnapshot(blockNumber, { blockHash }); }
function readerFactory({ blockNumber = target, blockHashes = {} } = {}) { return async ({ toBlockTag } = {}) => { const n = toBlockTag === undefined ? blockNumber : Number(BigInt(toBlockTag)); return { read: async () => pinnedSnapshot(n, { blockHash: blockHashes[n] ?? hash(n) }) }; }; }
function rpcFixture({ head = target, logs = [], receipts = [], blocks = {}, receiptError = null, mutateTarget = false } = {}) { let targetReads = 0; return async (method, params) => { if (method === 'eth_chainId') return '0x4cef52'; if (method === 'eth_blockNumber') return `0x${BigInt(head).toString(16)}`; if (method === 'eth_getBlockByNumber') { if (params[0] === 'finalized' || params[0] === 'safe') throw Object.assign(new Error('unsupported'), { code: -32602 }); const n = Number(BigInt(params[0])); if (blocks[n]) return blocks[n]; const blockLogs = logs.filter((log) => Number(BigInt(log.blockNumber)) === n); const receiptTxs = receipts.filter((receipt) => Number(BigInt(receipt.blockNumber ?? `0x${n.toString(16)}`)) === n).map((receipt) => receipt.transactionHash); const txs = [...new Set([...blockLogs.map((log) => log.transactionHash), ...receiptTxs])]; if (n === target && mutateTarget && ++targetReads > 1) return { ...header(n, hash(n - 1), txs, blockLogs), hash: hash(999999) }; return header(n, hash(n - 1), txs, blockLogs); } if (method === 'eth_getLogs') { const from = Number(BigInt(params[0].fromBlock)); const to = Number(BigInt(params[0].toBlock)); return logs.filter((log) => log.address.toLowerCase() === params[0].address.toLowerCase() && Number(BigInt(log.blockNumber)) >= from && Number(BigInt(log.blockNumber)) <= to); } if (method === 'eth_getBlockReceipts') { if (receiptError) throw receiptError; return receipts; } throw new Error(`unexpected RPC ${method}`); }; }
async function setup() { const dir = await mkdtemp(join(scratchDir(), 'v2-reorg-complete-')); const db = await createPgliteDb({ dataDir: dir }); await migrate(db); return { dir, db, store: createV2IndexerStore({ db, chainId, marketplace: market, vault }) }; }
async function teardown(ctx) { await ctx.db.close(); await rm(ctx.dir, { recursive: true, force: true }); }
function makeIndexer(ctx, transport, options = {}) { return createV2Indexer({ db: ctx.db, transport, store: ctx.store, readerFactory: readerFactory(), initialAnchor: { blockNumber: String(anchor), blockHash: hash(anchor) }, confirmations: 0, batchSize: 32, maxBatches: 1, projector: async () => {}, ...options }); }
async function dbSnapshot(ctx) { const result = {}; for (const table of ['v2_indexer_blocks_fork', 'v2_indexer_events_fork', 'v2_indexer_cursors']) result[table] = (await ctx.db.query(`SELECT * FROM ${table} ORDER BY 1,2,3`)).rows; return result; }

// Real PGlite/store/indexer RPC fixture acceptance; not live-EVM proof.
test('Ethereum bloom reference fixture is nonempty and has the known set bits', () => {
  const fixture = bloomFixture([
    '0x0000000000000000000000000000000000000001',
    '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
  ]);
  assert.notEqual(fixture.bloom, `0x${'00'.repeat(256)}`);
  assert.deepEqual(fixture.setBitIndices, [1128, 128, 1585, 1443, 481, 1060]);
});
test('transaction preflight snapshots an exact-cap dense own-data hash array', () => {
  const hashes = Array.from({ length: 10_000 }, (_, index) => hash(index + 1));
  const snapshot = snapshotTransactionHashes(hashes);
  assert.equal(snapshot.length, 10_000);
  assert.equal(snapshot[0], hashes[0]);
  assert.equal(snapshot.at(-1), hashes.at(-1));
  assert.equal(Object.isFrozen(snapshot), true);
});
test('transaction preflight never inspects thrown proxy error properties', () => {
  let errorGetterCalls = 0;
  const hostileError = Object.defineProperty({}, 'message', { get() { errorGetterCalls += 1; throw new Error('SECRET_PROVIDER_ERROR'); } });
  const input = new Proxy([], { get() { throw hostileError; } });
  assert.throws(() => snapshotTransactionHashes(input), { message: 'invalid block transactions' });
  assert.equal(errorGetterCalls, 0);
});
test('transaction preflight rejects holes and accessors without invoking item getters', () => {
  const hole = [hash(1), hash(2)]; delete hole[1];
  assert.throws(() => snapshotTransactionHashes(hole), /invalid block transactions/);
  let invoked = 0;
  const accessor = [hash(1)];
  Object.defineProperty(accessor, '0', { get: () => { invoked += 1; return hash(1); }, enumerable: true });
  assert.throws(() => snapshotTransactionHashes(accessor), /invalid block transactions/);
  assert.equal(invoked, 0);
});
test('oversized transaction proxy is rejected before numeric descriptor access', () => {
  let descriptorCalls = 0;
  const oversized = new Proxy(new Array(10_001), { getOwnPropertyDescriptor(target, key) { descriptorCalls += /^\d+$/.test(String(key)) ? 1 : 0; return Reflect.getOwnPropertyDescriptor(target, key); } });
  assert.throws(() => snapshotTransactionHashes(oversized), /invalid block transactions/);
  assert.equal(descriptorCalls, 0);
});
test('valid nonempty block accepts two canonical ABI logs, receipt order, metadata, and independently computed bloom', async () => { const ctx = await setup(); try { const logs = [canonicalLog('marketplace', 'PolicyChanged', target, 0, 0), canonicalLog('marketplace', 'PolicyChanged', target, 1, 1)]; const receipts = logs.map((log, i) => ({ blockHash: hash(target), blockNumber: `0x${target.toString(16)}`, transactionHash: log.transactionHash, transactionIndex: `0x${i.toString(16)}`, logs: [log] })); const result = await makeIndexer(ctx, rpcFixture({ logs, receipts })).syncOnce(); assert.equal(result.status, 'healthy'); assert.deepEqual(await ctx.store.cursor(), { blockNumber: String(target), blockHash: hash(target) }); assert.equal((await ctx.store.rawEvents()).length, 2); } finally { await teardown(ctx); } });

test('explicit empty transactions with an exact all-zero bloom remain a verified empty block', async () => { const ctx = await setup(); try { const empty = header(target, hash(target - 1), [], []); const result = await makeIndexer(ctx, rpcFixture({ blocks: { [target]: empty } })).syncOnce(); assert.equal(result.status, 'healthy'); assert.deepEqual(await ctx.store.cursor(), { blockNumber: String(target), blockHash: hash(target) }); } finally { await teardown(ctx); } });

for (const [label, mutate] of [
  ['missing transactions', (block) => { const copy = { ...block }; delete copy.transactions; return copy; }],
  ['null transactions', (block) => ({ ...block, transactions: null })],
  ['non-array transactions', (block) => ({ ...block, transactions: { length: 0 } })],
  ['string transactions', (block) => ({ ...block, transactions: '0x' })],
  ['object transactions', (block) => ({ ...block, transactions: { hash: hash(target) } })],
  ['missing logsBloom', (block) => { const copy = { ...block }; delete copy.logsBloom; return copy; }],
  ['null logsBloom', (block) => ({ ...block, logsBloom: null })],
  ['short logsBloom', (block) => ({ ...block, logsBloom: '0x00' })],
  ['non-hex logsBloom', (block) => ({ ...block, logsBloom: `0x${'gg'.repeat(256)}` })],
]) test(`real pipeline rejects ${label} before database mutation`, async () => { const ctx = await setup(); try { const before = await dbSnapshot(ctx); const result = await makeIndexer(ctx, rpcFixture({ blocks: { [target]: mutate(header(target)) } })).syncOnce(); assert.equal(result.status, 'degraded'); assert.deepEqual(await dbSnapshot(ctx), before); } finally { await teardown(ctx); } });

for (const [label, removed] of [['queried removed=true', true], ['queried removed omitted', undefined], ['queried removed=0', 0], ['queried removed="false"', 'false'], ['queried removed=null', null]]) {
  test(`real pipeline rejects ${label} before database mutation`, async () => {
    const ctx = await setup();
    try {
      const queried = canonicalLog('marketplace', 'PolicyChanged', target);
      if (removed === undefined) delete queried.removed; else queried.removed = removed;
      const receiptLog = canonicalLog('marketplace', 'PolicyChanged', target);
      const receipts = [{ blockHash: hash(target), blockNumber: `0x${target.toString(16)}`, transactionHash: receiptLog.transactionHash, transactionIndex: '0x0', logs: [receiptLog] }];
      const before = await dbSnapshot(ctx);
      const result = await makeIndexer(ctx, rpcFixture({ logs: [queried], receipts })).syncOnce();
      assert.equal(result.status, 'degraded');
      assert.deepEqual(await dbSnapshot(ctx), before);
    } finally { await teardown(ctx); }
  });
}
const completenessCases = [['queried log absent from receipts', (logs, receipts) => ({ logs, receipts: receipts.map((r) => ({ ...r, logs: [] })) })], ['receipt log absent from queried logs', (logs, receipts) => ({ logs: [], receipts })], ['swapped receipt order', (logs, receipts) => ({ logs, receipts: [...receipts].reverse() })], ['receipt transaction hash mismatch', (logs, receipts) => ({ logs, receipts: receipts.map((r, i) => i ? { ...r, transactionHash: hash(9991) } : r) })], ['receipt block number mismatch', (logs, receipts) => ({ logs, receipts: receipts.map((r, i) => i ? { ...r, blockNumber: '0x1' } : r) })], ['receipt transaction index mismatch', (logs, receipts) => ({ logs, receipts: receipts.map((r, i) => i ? { ...r, transactionIndex: '0x0' } : r) })]];
for (const [label, alter] of completenessCases) test(`real pipeline rejects ${label} without database mutation`, async () => { const ctx = await setup(); try { const logs = [canonicalLog('marketplace', 'PolicyChanged', target, 0, 0), canonicalLog('marketplace', 'PolicyChanged', target, 1, 1)]; const receipts = logs.map((log, i) => ({ blockHash: hash(target), blockNumber: `0x${target.toString(16)}`, transactionHash: log.transactionHash, transactionIndex: `0x${i.toString(16)}`, logs: [log] })); const before = await dbSnapshot(ctx); const result = await makeIndexer(ctx, rpcFixture(alter(logs, receipts))).syncOnce(); assert.equal(result.status, 'degraded'); assert.deepEqual(await dbSnapshot(ctx), before); } finally { await teardown(ctx); } });
test('zero transactions require empty bloom; a nonzero bloom is rejected before store mutation', async () => { const ctx = await setup(); try { const result = await makeIndexer(ctx, rpcFixture({ blocks: { [target]: { ...header(target), logsBloom: `0x${'01'.padEnd(512, '0')}` } } })).syncOnce(); assert.equal(result.status, 'degraded'); assert.equal(await ctx.store.cursor(), null); } finally { await teardown(ctx); } });
test('one-bit bloom mismatch is rejected independently of production bloom computation', async () => { const ctx = await setup(); try { const log = canonicalLog('marketplace', 'PolicyChanged', target); const receipt = { blockHash: hash(target), blockNumber: `0x${target.toString(16)}`, transactionHash: log.transactionHash, transactionIndex: '0x0', logs: [log] }; const bad = { ...header(target, hash(target - 1), [log.transactionHash], [log]), logsBloom: `0x${'00'.repeat(255)}01` }; const result = await makeIndexer(ctx, rpcFixture({ logs: [log], receipts: [receipt], blocks: { [target]: bad } })).syncOnce(); assert.equal(result.status, 'degraded'); assert.equal(await ctx.store.cursor(), null); } finally { await teardown(ctx); } });
test('unsupported block-receipts RPC with nonempty transactions degrades and does not advance', async () => { const ctx = await setup(); try { const log = canonicalLog('marketplace', 'PolicyChanged', target); const result = await makeIndexer(ctx, rpcFixture({ blocks: { [target]: header(target, hash(target - 1), [log.transactionHash], []) }, receiptError: Object.assign(new Error('unsupported'), { code: -32602 }) })).syncOnce(); assert.equal(result.status, 'degraded'); assert.equal(await ctx.store.cursor(), null); } finally { await teardown(ctx); } });
async function seedChain(ctx, through) { let parent = hash(anchor); await ctx.store.applyBatch({ initialVerifiedAnchor: { blockNumber: String(anchor), blockHash: parent }, headers: [{ blockNumber: String(anchor + 1), blockHash: hash(anchor + 1), parentHash: parent, transactionCount: 0, header: {} }] }); parent = hash(anchor + 1); for (let n = anchor + 2; n <= through; n += 1) { await ctx.store.applyBatch({ expectedCursor: await ctx.store.cursor(), headers: [{ blockNumber: String(n), blockHash: hash(n), parentHash: parent, transactionCount: 0, header: {} }] }); parent = hash(n); } }
function forkBlocks(from, through, prefix) { const blocks = {}; let parent = hash(from - 1); for (let n = from; n <= through; n += 1) { const blockHash = hash(prefix + n); blocks[n] = header(n, parent); blocks[n].hash = blockHash; parent = blockHash; } return blocks; }
test('actual indexer same-height restart is healthy and fork detection never silently rewrites the cursor', async () => { const ctx = await setup(); try { await seedChain(ctx, target); assert.equal((await makeIndexer(ctx, rpcFixture({ head: target })).syncOnce()).status, 'healthy'); const fork = { ...header(target), hash: hash(70000) }; const result = await makeIndexer(ctx, rpcFixture({ head: target, blocks: { [target]: fork } })).syncOnce(); assert.equal(result.status, 'degraded'); assert.deepEqual(await ctx.store.cursor(), { blockNumber: String(target), blockHash: hash(target) }); } finally { await teardown(ctx); } });
test('post-deployment reorg boundary accepts depth 32 with a partial fork catch-up', async () => { const ctx = await setup(); try {
  const commonAncestor = anchor + 11; const forkFirst = commonAncestor + 1; const oldHead = commonAncestor + 32; const forkHead = oldHead + 1;
  await seedChain(ctx, oldHead);
  const blocks = forkBlocks(forkFirst, forkHead, 81000);
  const result = await makeIndexer(ctx, rpcFixture({ head: forkHead, blocks }), { batchSize: 1, maxBatches: 1, readerFactory: readerFactory({ blockHashes: { [forkFirst]: blocks[forkFirst].hash } }) }).syncOnce();
  assert.equal(result.status, 'catching_up');
  assert.deepEqual(await ctx.store.cursor(), { blockNumber: String(forkFirst), blockHash: blocks[forkFirst].hash });
} finally { await teardown(ctx); } });

test('post-deployment reorg boundary rejects depth 33 without mutation', async () => { const ctx = await setup(); try {
  const commonAncestor = anchor + 11; const forkFirst = commonAncestor + 1; const oldHead = commonAncestor + 33; const forkHead = oldHead + 1;
  await seedChain(ctx, oldHead); const before = await dbSnapshot(ctx);
  const blocks = forkBlocks(forkFirst, forkHead, 82000);
  const result = await makeIndexer(ctx, rpcFixture({ head: forkHead, blocks }), { batchSize: 1, maxBatches: 1, readerFactory: readerFactory({ blockHashes: { [forkFirst]: blocks[forkFirst].hash } }) }).syncOnce();
  assert.equal(result.status, 'degraded'); assert.deepEqual(await dbSnapshot(ctx), before);
} finally { await teardown(ctx); } });
test('source hash change between prepare and commit degrades with state intact', async () => { const ctx = await setup(); try { const before = await dbSnapshot(ctx); const result = await makeIndexer(ctx, rpcFixture({ mutateTarget: true })).syncOnce(); assert.equal(result.status, 'degraded'); assert.deepEqual(await dbSnapshot(ctx), before); } finally { await teardown(ctx); } });

test('receipt metadata is a strict canonical tuple, including block number and removed=false', async (t) => {
  const cases = [
    ['wrong log block number', (log) => ({ ...log, blockNumber: '0x1' })],
    ['missing log block number', (log) => { const copy = { ...log }; delete copy.blockNumber; return copy; }],
    ['removed omitted', (log) => { const copy = { ...log }; delete copy.removed; return copy; }],
    ['removed true', (log) => ({ ...log, removed: true })],
    ['wrong log transaction index', (log) => ({ ...log, transactionIndex: '0x1' })],
    ['wrong log transaction hash', (log) => ({ ...log, transactionHash: hash(999999) })],
    ['metadata-only topics mismatch', (log) => ({ ...log, topics: [log.topics[0].slice(0, -1) + (log.topics[0].endsWith('0') ? '1' : '0'), ...log.topics.slice(1)] })],
    ['metadata-only data mismatch', (log) => ({ ...log, data: `${log.data.slice(0, -1)}${log.data.endsWith('0') ? '1' : '0'}` })],
  ];
  for (const [label, mutate] of cases) await t.test(label, async () => {
    const ctx = await setup();
    try {
      const log = canonicalLog('marketplace', 'PolicyChanged', target);
      const receipt = { blockHash: hash(target), blockNumber: `0x${target.toString(16)}`, transactionHash: log.transactionHash, transactionIndex: '0x0', logs: [mutate(log)] };
      const before = await dbSnapshot(ctx);
      const result = await makeIndexer(ctx, rpcFixture({ logs: [log], receipts: [receipt] })).syncOnce();
      assert.equal(result.status, 'degraded');
      assert.deepEqual(await dbSnapshot(ctx), before);
    } finally { await teardown(ctx); }
  });
});

test('health is complete and never serializes transport or reader secrets', async () => {
  const ctx = await setup();
  try {
    const indexer = makeIndexer(ctx, () => { throw new Error('SECRET-health-transport'); });
    await indexer.syncOnce();
    const health = indexer.health();
    assert.equal(JSON.stringify(health).includes('SECRET-health-transport'), false);
    for (const key of ['status', 'stale', 'gap', 'code', 'reason']) assert.ok(Object.hasOwn(health, key));
    assert.equal(health.status, 'degraded');
    assert.equal(health.code, 'INDEXER_RPC_FAILED');
    assert.equal(health.reason, 'indexer sync failed');

    const factoryIndexer = makeIndexer(ctx, rpcFixture(), { readerFactory: async () => { throw new Error('SECRET-reader-factory'); } });
    await factoryIndexer.syncOnce();
    assert.equal(JSON.stringify(factoryIndexer.health()).includes('SECRET-reader-factory'), false);

    const getterError = {};
    Object.defineProperty(getterError, 'message', { get() { throw new Error('SECRET-message-getter'); } });
    const getterIndexer = makeIndexer(ctx, () => { throw getterError; });
    await getterIndexer.syncOnce();
    assert.equal(JSON.stringify(getterIndexer.health()).includes('SECRET-message-getter'), false);
  } finally { await teardown(ctx); }
});