import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { encodeAbiParameters, encodeEventTopics, hexToBytes, keccak256 } from 'viem';
import manifest from '../lib/v2/indexer-event-manifest.json' with { type: 'json' };
import { createPgliteDb, migrate } from '../lib/v2/server/db.mjs';
import { createV2Indexer } from '../lib/v2/server/indexer.mjs';
import { createV2IndexerProjector } from '../lib/v2/server/indexer-projection.mjs';
import { createV2IndexerStore } from '../lib/v2/server/indexer-store.mjs';
import { decodeIndexerLog } from '../lib/v2/indexer-events.mjs';
import { snapshot as pinnedSnapshot, pinnedReader } from './fixtures/v2-indexer-snapshot.mjs';
import { scratchDir } from './scratch-dir.mjs';

const chainId = 5042002;
const market = manifest.emitters.marketplace;
const vault = manifest.emitters.vault;
const ZERO = `0x${'00'.repeat(32)}`;
const hash = (n) => `0x${BigInt(n).toString(16).padStart(64, '0')}`;
const fixtureReader = pinnedReader();
const address = (n) => `0x${BigInt(n).toString(16).padStart(40, '0')}`;
const eventAbi = (source, name) => manifest.abis[source].find((event) => event.name === name);
const argsFor = (name) => ({
  JobPosted: { jobId: 7n, client: address(0x11), reward: 12345n, applyBy: 999999n, criteriaHash: hash(21), descriptionHash: hash(22), testJob: false, house: true },
  JobTerms: { jobId: 7n, canonicalTermsHash: hash(23), reward: 12345n, feeBps: 250n, treasury: address(0x12), minReward: 100n, resolver: address(0x13), deliveryDuration: 100n, reviewDuration: 200n, revisionDuration: 300n, revisionLimit: 2, unlimitedRevisions: false, collateralPolicy: 0n },
  JobState: { jobId: 7n, stateVersion: 2n, status: 3, clockPack: 0n, deliveryVersion: 1n, counters: 0n, faultDeadline: 0n },
  JobAwarded: { jobId: 7n, operator: address(0x14), stake: 500n, termsHash: hash(23) },
  PolicyChanged: { minReward: 100n, feeBps: 250n },
})[name];
function canonicalLog(source, name, blockNumber, transactionIndex = 0, logIndex = 0) {
  const event = eventAbi(source, name);
  const args = argsFor(name);
  const indexed = event.inputs.filter((input) => input.indexed);
  const nonIndexed = event.inputs.filter((input) => !input.indexed);
  const values = event.inputs.map((input) => { assert.notEqual(args[input.name], undefined, `${name}.${input.name} fixture arg`); return args[input.name]; });
  const topics = encodeEventTopics({ abi: [event], eventName: name, args: values.filter((_, index) => event.inputs[index].indexed) });
  const data = encodeAbiParameters(nonIndexed.map((input) => ({ type: input.type })), nonIndexed.map((input) => args[input.name]));
  assert.equal(topics.length, indexed.length + 1, `${name} fixture topic count`);
  return { address: source === 'marketplace' ? market : vault, blockNumber: `0x${BigInt(blockNumber).toString(16)}`, blockHash: hash(blockNumber), transactionHash: hash(1000 + blockNumber), transactionIndex: `0x${transactionIndex.toString(16)}`, logIndex: `0x${logIndex.toString(16)}`, removed: false, topics, data };
}
function bloomFor(logs) {
  const bloom = new Uint8Array(256);
  for (const log of logs) for (const value of [log.address, ...(log.topics ?? [])]) {
    const bytes = hexToBytes(keccak256(hexToBytes(value)));
    for (let i = 0; i < 3; i += 1) { const bit = ((bytes[i * 2] << 8) | bytes[i * 2 + 1]) & 2047; bloom[255 - (bit >> 3)] |= 1 << (bit & 7); }
  }
  return `0x${Buffer.from(bloom).toString('hex')}`;
}
function header(number, parentHash = hash(number - 1), transactions = [], logs = []) { return { number: `0x${BigInt(number).toString(16)}`, hash: hash(number), parentHash, timestamp: '0x1', transactions, logsBloom: bloomFor(logs) }; }
function makeTransport({ head = 68072744, logs = [], blocks = {}, errors = {} } = {}) {
  const calls = [];
  const transport = async (method, params) => {
    calls.push({ method, params });
    if (errors[method]) throw errors[method];
    if (method === 'eth_chainId') return '0x4cef52';
    if (method === 'eth_blockNumber') return `0x${BigInt(head).toString(16)}`;
    if (method === 'eth_getBlockByNumber') {
      const tag = params[0];
      if (tag === 'finalized' || tag === 'safe') throw Object.assign(new Error('unsupported'), { code: -32602 });
      const n = Number(BigInt(tag));
      if (blocks[n]) return blocks[n];
      const blockLogs = logs.filter((log) => Number(log.blockNumber) === n);
      const txs = [...new Set(blockLogs.map((log) => log.transactionHash))];
      return header(n, hash(n - 1), txs, blockLogs);
    }
    if (method === 'eth_getLogs') {
      const from = Number(BigInt(params[0].fromBlock)); const to = Number(BigInt(params[0].toBlock));
      return logs.filter((log) => log.address.toLowerCase() === params[0].address.toLowerCase() && Number(log.blockNumber) >= from && Number(log.blockNumber) <= to);
    }
    if (method === 'eth_getBlockReceipts') {
      const blockNumber = Number(BigInt(params[0]));
      const blockLogs = logs.filter((log) => Number(log.blockNumber) === blockNumber);
      const txs = [...new Set(blockLogs.map((log) => log.transactionHash))];
      return txs.map((transactionHash, transactionIndex) => ({
        blockHash: hash(blockNumber), blockNumber: `0x${BigInt(blockNumber).toString(16)}`,
        transactionHash, transactionIndex: `0x${transactionIndex.toString(16)}`,
        logs: blockLogs.filter((log) => log.transactionHash === transactionHash)
          .map((log) => ({ ...log, transactionIndex: `0x${transactionIndex.toString(16)}` })),
      }));
    }
    throw new Error(`unexpected RPC ${method}`);
  };
  return { transport, calls };
}
async function setup() {
  const dir = await mkdtemp(join(scratchDir(), 'v2-pipeline-'));
  const db = await createPgliteDb({ dataDir: dir }); await migrate(db);
  const store = createV2IndexerStore({ db, chainId, marketplace: market, vault });
  return { dir, db, store };
}
async function teardown(ctx) { await ctx.db.close(); await rm(ctx.dir, { recursive: true, force: true }); }
async function snapshot(ctx) {
  const result = {};
  for (const table of ['v2_indexer_blocks_fork', 'v2_indexer_events_fork', 'v2_indexer_cursors', 'v2_jobs', 'v2_operator_projection', 'v2_credit_projection']) result[table] = (await ctx.db.query(`SELECT * FROM ${table}`)).rows;
  return result;
}

test('canonical JobPosted + JobTerms + JobState + JobAwarded logs increment raw events, jobs, and cursor atomically', async () => {
  const ctx = await setup();
  try {
    const logs = ['JobPosted', 'JobTerms', 'JobState', 'JobAwarded'].map((name, index) => canonicalLog('marketplace', name, 68072744, 0, index));
    const rpc = makeTransport({ head: 68072744, logs });
    const indexer = createV2Indexer({ readerFactory: fixtureReader, db: ctx.db, transport: rpc.transport, store: ctx.store, initialAnchor: { blockNumber: '68072733', blockHash: hash(68072733) }, batchSize: 1000, confirmations: 0 });
    const result = await indexer.syncOnce();
    assert.equal(result.status, 'healthy');
    assert.equal((await ctx.store.rawEvents()).length, 4);
    assert.equal((await ctx.db.query('SELECT count(*)::int AS n FROM v2_jobs')).rows[0].n, 1);
    assert.deepEqual(await ctx.store.cursor(), { blockNumber: '68072744', blockHash: hash(68072744) });
  } finally { await teardown(ctx); }
});

test('foreign token logs remain in bloom proof but not marketplace event completeness', async () => {
  const ctx = await setup();
  try {
    const logs = ['JobPosted', 'JobTerms', 'JobState', 'JobAwarded'].map((name, index) => canonicalLog('marketplace', name, 68072744, 0, index));
    const transfer = {
      ...logs[0], address: address(0xdead), logIndex: '0x4',
      topics: [keccak256(new TextEncoder().encode('Transfer(address,address,uint256)')), encodeAbiParameters([{ type: 'address' }], [address(0x11)]), encodeAbiParameters([{ type: 'address' }], [market])],
      data: encodeAbiParameters([{ type: 'uint256' }], [12345n]),
    };
    const rpc = makeTransport({ head: 68072744, logs: [...logs, transfer] });
    const indexer = createV2Indexer({ readerFactory: fixtureReader, db: ctx.db, transport: rpc.transport, store: ctx.store, initialAnchor: { blockNumber: '68072733', blockHash: hash(68072733) }, confirmations: 0 });
    assert.equal((await indexer.syncOnce()).status, 'healthy');
    assert.equal((await ctx.store.rawEvents()).length, 4);
    assert.equal((await ctx.db.query('SELECT count(*)::int AS n FROM v2_jobs')).rows[0].n, 1);
  } finally { await teardown(ctx); }
});

test('foreign-only nonempty blocks advance without fabricating marketplace events', async () => {
  const ctx = await setup();
  try {
    const foreign = { ...canonicalLog('marketplace', 'JobPosted', 68072744), address: address(0xdead) };
    const rpc = makeTransport({ head: 68072744, logs: [foreign] });
    const indexer = createV2Indexer({ readerFactory: fixtureReader, db: ctx.db, transport: rpc.transport, store: ctx.store, initialAnchor: { blockNumber: '68072733', blockHash: hash(68072733) }, confirmations: 0 });
    assert.equal((await indexer.syncOnce()).status, 'healthy');
    assert.equal((await ctx.store.rawEvents()).length, 0);
    assert.equal((await ctx.db.query('SELECT count(*)::int AS n FROM v2_jobs')).rows[0].n, 0);
    assert.deepEqual(await ctx.store.cursor(), { blockNumber: '68072744', blockHash: hash(68072744) });
  } finally { await teardown(ctx); }
});

test('verified empty range advances the real pipeline cursor without fabricated logs', async () => {
  const ctx = await setup();
  try {
    const rpc = makeTransport({ head: 68072744 });
    const indexer = createV2Indexer({ readerFactory: fixtureReader, db: ctx.db, transport: rpc.transport, store: ctx.store, initialAnchor: { blockNumber: '68072733', blockHash: hash(68072733) }, confirmations: 0 });
    await indexer.syncOnce();
    assert.deepEqual(await ctx.store.cursor(), { blockNumber: '68072744', blockHash: hash(68072744) });
    assert.equal((await ctx.store.rawEvents()).length, 0);
  } finally { await teardown(ctx); }
});

test('readerFactory is invoked for runtime attestation and wrong chain never reaches healthy', async () => {
  const ctx = await setup(); let readerCalls = 0;
  try {
    const rpc = makeTransport({ head: 68072744, errors: { eth_chainId: Object.assign(new Error('wrong chain'), { code: -32000 }) } });
    const indexer = createV2Indexer({ db: ctx.db, transport: rpc.transport, store: ctx.store, readerFactory: () => { readerCalls += 1; return { verify: true }; }, initialAnchor: { blockNumber: '68072733', blockHash: hash(68072733) }, confirmations: 0 });
    const result = await indexer.syncOnce();
    assert.equal(result.status, 'degraded');
    assert.equal(readerCalls, 0, 'chain identity is checked before runtime reader attestation');
  } finally { await teardown(ctx); }
});

test('requested ranges are bounded to one configured batch and do not chase an unbounded head', async () => {
  const ctx = await setup();
  try {
    const rpc = makeTransport({ head: 68072744 });
    const indexer = createV2Indexer({ readerFactory: fixtureReader, db: ctx.db, transport: rpc.transport, store: ctx.store, initialAnchor: { blockNumber: '68072733', blockHash: hash(68072733) }, batchSize: 1, confirmations: 0 });
    await indexer.syncOnce();
    const ranges = rpc.calls.filter((call) => call.method === 'eth_getLogs').map((call) => [call.params[0].fromBlock, call.params[0].toBlock]);
    assert.equal(ranges.length, 2, 'marketplace and vault are queried independently');
    for (const [from, to] of ranges) assert.equal(from, to, 'configured batchSize=1 must bound each RPC range');
  } finally { await teardown(ctx); }
});

test('deployment anchors preserve the explicit 68072734 and marketplace 68072744 fixture pair', async () => {
  assert.equal(manifest.deployments.marketplace.startingBlock, 68072744);
  assert.equal(manifest.deployments.vault.startingBlock, 68072734);
  assert.equal(market, '0xFA156B7A5205B123c8a22A807ba98405e36130f1');
  assert.equal(vault, '0xD5B271b7Bf4696d662B2bcB1a94b408887c6C423');
});

test('adaptive -32005 provider limits shrink the requested range rather than repeat the same range', async () => {
  const ctx = await setup(); const seen = [];
  try {
    const base = makeTransport({ head: 68072735 });
    const transport = async (method, params) => { if (method === 'eth_getLogs') { const from = BigInt(params[0].fromBlock); const to = BigInt(params[0].toBlock); seen.push([params[0].fromBlock, params[0].toBlock]); if (from < to) throw Object.assign(new Error('too many results'), { code: -32005 }); } return base.transport(method, params); };
    const indexer = createV2Indexer({ readerFactory: fixtureReader, db: ctx.db, transport, store: ctx.store, initialAnchor: { blockNumber: '68072733', blockHash: hash(68072733) }, batchSize: 2, confirmations: 0, retries: 1, sleep: async () => {} });
    const result = await indexer.syncOnce();
    assert.equal(result.status, 'healthy');
    assert.ok(seen.some(([from, to]) => from !== to), 'initial bounded range must be attempted');
    assert.ok(seen.some(([from, to]) => from === to), 'provider-limited range must shrink to a single block');
  } finally { await teardown(ctx); }
});

test('429 retries are bounded, finalized unsupported falls back, and unknown errors are not broadly retried', async () => {
  const ctx = await setup(); let sleeps = 0; let attempts = 0;
  try {
    const base = makeTransport({ head: 68072744 });
    const transport = async (method, params) => { if (method === 'eth_getBlockByNumber' && params[0] !== 'finalized' && params[0] !== 'safe' && attempts++ < 2) throw Object.assign(new Error('rate'), { code: 429 }); return base.transport(method, params); };
    const indexer = createV2Indexer({ readerFactory: fixtureReader, db: ctx.db, transport, store: ctx.store, initialAnchor: { blockNumber: '68072733', blockHash: hash(68072733) }, confirmations: 0, retries: 2, sleep: async () => { sleeps += 1; } });
    await indexer.syncOnce();
    assert.equal(sleeps, 2);
    const unknown = createV2Indexer({ readerFactory: fixtureReader, db: ctx.db, transport: async () => { throw Object.assign(new Error('unknown'), { code: -32000 }); }, store: ctx.store, confirmations: 0 });
    const unknownResult = await unknown.syncOnce();
    assert.equal(unknownResult.status, 'degraded');
    assert.equal(unknownResult.error.message, 'indexer RPC request failed');
  } finally { await teardown(ctx); }
});

test('missing receipt logs despite a successful range is rejected as an observed completeness inconsistency', async () => {
  const ctx = await setup();
  try {
    const base = makeTransport({ head: 68072744, logs: [] });
    const transport = async (method, params) => {
      if (method === 'eth_getBlockByNumber' && params[0] === `0x${BigInt(68072744).toString(16)}`) return { ...header(68072744), transactions: [hash(1000 + 68072744)] };
      if (method === 'eth_getBlockReceipts') return [{ blockHash: hash(68072744), transactionHash: hash(1000 + 68072744), logs: [canonicalLog('marketplace', 'JobPosted', 68072744)] }];
      return base.transport(method, params);
    };
    const indexer = createV2Indexer({ readerFactory: fixtureReader, db: ctx.db, transport, store: ctx.store, initialAnchor: { blockNumber: '68072733', blockHash: hash(68072733) }, confirmations: 0 });
    const result = await indexer.syncOnce();
    assert.equal(result.status, 'degraded');
    assert.equal(result.error.message, 'indexer RPC request failed');
  } finally { await teardown(ctx); }
});

test('restart replay detects a reorg at the 32-block common ancestor and deep reorg degrades instead of stopping silently', async () => {
  const ctx = await setup();
  try {
    const blocks = {}; for (let n = 68072734; n <= 68072744; n += 1) blocks[n] = header(n, hash(n - 1));
    await ctx.store.applyBatch({ initialVerifiedAnchor: { blockNumber: '68072733', blockHash: hash(68072733) }, headers: Object.values(blocks).map((b) => ({ blockNumber: String(Number(BigInt(b.number))), blockHash: b.hash, parentHash: b.parentHash, transactionCount: 0, header: {} })) });
    await assert.rejects(ctx.store.applyBatch({ expectedCursor: await ctx.store.cursor(), reorgAncestor: { blockNumber: '68072712', blockHash: hash(68072712) } }), /ancestor|depth/);
  } finally { await teardown(ctx); }
});

test('projector crash rolls back raw events, projection rows, and cursor together', async () => {
  const ctx = await setup();
  try {
    const b = { blockNumber: '0', blockHash: hash(0), parentHash: ZERO, transactionCount: 0 };
    const before = await snapshot(ctx);
    await assert.rejects(ctx.store.applyBatch({ headers: [b], projector: async () => { throw new Error('injected projector crash'); } }), /injected projector crash/);
    assert.deepEqual(await snapshot(ctx), before);
  } finally { await teardown(ctx); }
});

test('duplicate canonical log is idempotent while same identity with changed payload conflicts', async () => {
  const ctx = await setup();
  try {
    const b = { blockNumber: '0', blockHash: hash(0), parentHash: ZERO, transactionCount: 0 };
    const base = { emitter: vault, blockNumber: '0', blockHash: hash(0), transactionHash: hash(1), transactionIndex: 0, logIndex: 0, topics: [], data: '0x', decoded: { x: '1' }, eventName: 'VaultEvent' };
    await ctx.store.applyBatch({ headers: [b], events: [base] });
    await ctx.store.applyBatch({ expectedCursor: await ctx.store.cursor(), headers: [b], events: [base] });
    await assert.rejects(ctx.store.applyBatch({ expectedCursor: await ctx.store.cursor(), headers: [b], events: [{ ...base, decoded: { x: '2' } }] }), /conflicting|replay/);
  } finally { await teardown(ctx); }
});

test('real pipeline rejects conflicting duplicate log identity before store mutation', async () => {
  const ctx = await setup();
  try {
    const first = canonicalLog('marketplace', 'JobPosted', 68072744, 0, 0);
    const conflicting = { ...first, topics: [first.topics[0], hash(8), ...first.topics.slice(2)] };
    const block = { ...header(68072744), transactions: [first.transactionHash] };
    const receipts = [{ blockHash: first.blockHash, transactionHash: first.transactionHash, logs: [first, conflicting] }];
    const base = makeTransport({ head: 68072744, logs: [first, conflicting], blocks: { 68072744: block } });
    const transport = async (method, params) => {
      if (method === 'eth_getBlockReceipts') return receipts;
      return base.transport(method, params);
    };
    const indexer = createV2Indexer({ readerFactory: fixtureReader, db: ctx.db, transport, store: ctx.store, initialAnchor: { blockNumber: '68072733', blockHash: hash(68072733) }, confirmations: 0 });
    const before = await snapshot(ctx);
    const result = await indexer.syncOnce();
    assert.equal(result.status, 'degraded');
    assert.equal(result.error.message, 'indexer RPC request failed');
    assert.deepEqual(await ctx.store.cursor(), null);
    assert.equal((await ctx.store.rawEvents()).length, 0);
    assert.equal(await ctx.store.cursor(), null);
  } finally { await teardown(ctx); }
});

test('policy events traverse the real pipeline into the mutual-policy projection row', async () => {
  const ctx = await setup();
  try {
    const logs = [canonicalLog('marketplace', 'PolicyChanged', 68072744)];
    const rpc = makeTransport({ head: 68072744, logs });
    const indexer = createV2Indexer({ readerFactory: fixtureReader, db: ctx.db, transport: rpc.transport, store: ctx.store, initialAnchor: { blockNumber: '68072733', blockHash: hash(68072733) }, confirmations: 0 });
    assert.equal((await indexer.syncOnce()).status, 'healthy');
    const rows = (await ctx.db.query('SELECT scope,policy_key,data FROM v2_policy_projection WHERE chain_id=$1 AND marketplace=$2', [chainId, market])).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].scope, 'global');
    assert.equal(rows[0].policy_key, 'getters');
  } finally { await teardown(ctx); }
});

test('store rejects swapped marketplace and vault deployment configuration', async () => {
  const ctx = await setup();
  try { assert.throws(() => createV2IndexerStore({ db: ctx.db, chainId, marketplace: vault, vault: market }), /configured Arc chain and deployments/); }
  finally { await teardown(ctx); }
});

// Cross-check the canonical encoding fixture itself independently from the pipeline.
test('canonical fixture round-trip uses manifest ABI and public decimal decoded arguments', () => {
  const raw = canonicalLog('marketplace', 'JobPosted', 68072744);
  const decoded = decodeIndexerLog({ ...raw, blockNumber: String(68072744), transactionIndex: '0', logIndex: '0' }, { chainId: BigInt(chainId) });
  assert.equal(decoded.event, 'JobPosted');
  assert.equal(decoded.args.jobId, '7');
});
