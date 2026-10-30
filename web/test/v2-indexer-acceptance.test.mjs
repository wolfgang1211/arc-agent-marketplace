import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { createPgliteDb, migrate } from '../lib/v2/server/db.mjs';
import { createV2IndexerStore } from '../lib/v2/server/indexer-store.mjs';
import { scratchDir } from './scratch-dir.mjs';

const chainId = 5042002;
const marketplace = '0xFA156B7A5205B123c8a22A807ba98405e36130f1';
const vault = '0xD5B271b7Bf4696d662B2bcB1a94b408887c6C423';
const zero = `0x${'00'.repeat(32)}`;
const hash = (n) => `0x${String(n).padStart(64, '0')}`;
const block = (number, parentHash = zero, id = number, extra = {}) => ({ blockNumber: String(number), blockHash: hash(id), parentHash, transactionCount: 1, ...extra });
const event = (b, id = 1, extra = {}) => ({ emitter: vault, blockNumber: b.blockNumber, blockHash: b.blockHash, transactionHash: hash(1000 + id), transactionIndex: 0, logIndex: 0, topics: [], data: '0x', decoded: { n: String(id) }, eventName: 'VaultEvent', ...extra });
const scratch = scratchDir();

async function setup() {
  const dir = await mkdtemp(join(scratch, 'v2-indexer-acceptance-'));
  const db = await createPgliteDb({ dataDir: dir });
  await migrate(db);
  return { dir, db, store: createV2IndexerStore({ db, chainId, marketplace, vault }) };
}
async function dispose(ctx) { await ctx.db.close(); await rm(ctx.dir, { recursive: true, force: true }); }
async function snapshot(db) {
  const tables = ['v2_indexer_blocks_fork', 'v2_indexer_events_fork', 'v2_indexer_cursors'];
  const result = {};
  for (const table of tables) result[table] = (await db.query(`SELECT * FROM ${table}`)).rows;
  return result;
}
async function seedLinear(ctx, through = 2) {
  let parent = zero;
  for (let n = 0; n <= through; n += 1) {
    const b = block(n, parent);
    await ctx.store.applyBatch({ headers: [b], events: n ? [event(b, n)] : [] });
    parent = b.blockHash;
  }
}

 test('verified empty ranges advance only with matching cursor and no unverified jump', async () => {
  const ctx = await setup();
  try {
    await ctx.store.applyBatch({ headers: [block(0)] });
    const cursor = await ctx.store.cursor();
    await ctx.store.applyBatch({ expectedCursor: cursor, nextCursor: cursor });
    await assert.rejects(ctx.store.applyBatch({ nextCursor: { blockNumber: '1', blockHash: hash(1) } }), /empty batches cannot advance/);
    assert.deepEqual(await ctx.store.cursor(), cursor);
  } finally { await dispose(ctx); }
});

test('exact replay is idempotent, never rewinds, and reordered JSONB keys are semantic equality', async () => {
  const ctx = await setup();
  try {
    const b0 = block(0, zero, 10, { header: { z: 2, a: { y: true, x: 1 } } });
    await ctx.store.applyBatch({ headers: [b0] });
    const replay = { ...b0, header: { a: { x: 1, y: true }, z: 2 } };
    await ctx.store.applyBatch({ expectedCursor: await ctx.store.cursor(), headers: [replay] });
    await assert.rejects(ctx.store.applyBatch({ expectedCursor: await ctx.store.cursor(), headers: [block(0, zero, 10)], nextCursor: { blockNumber: '0', blockHash: hash(10) } }), /historical replay conflicts|next cursor/);
    await assert.rejects(ctx.store.applyBatch({ expectedCursor: await ctx.store.cursor(), nextCursor: { blockNumber: '0', blockHash: hash(11) } }), /cursor|empty batches/);
    assert.deepEqual(await ctx.store.cursor(), { blockNumber: '0', blockHash: hash(10) });
  } finally { await dispose(ctx); }
});

test('same event identity with changed payload rejects without state mutation', async () => {
  const ctx = await setup();
  try {
    const b0 = block(0); const b1 = block(1, b0.blockHash);
    await ctx.store.applyBatch({ headers: [b0] });
    await ctx.store.applyBatch({ expectedCursor: await ctx.store.cursor(), headers: [b1], events: [event(b1)] });
    const before = await snapshot(ctx.db);
    await assert.rejects(ctx.store.applyBatch({ expectedCursor: await ctx.store.cursor(), headers: [b1], events: [{ ...event(b1), decoded: { altered: true } }] }), /historical replay conflicts|conflicting/);
    assert.deepEqual(await snapshot(ctx.db), before);
  } finally { await dispose(ctx); }
});

test('batch validation snapshots nested header, topics, and decoded payloads before async database work', async () => {
  const ctx = await setup();
  try {
    const b0 = block(0, zero, 0, { header: { source: 'original' } });
    const e0 = event(b0, 31, { topics: [hash(31)], decoded: { source: 'original' } });
    const pending = ctx.store.applyBatch({ headers: [b0], events: [e0] });
    b0.header.source = 'mutated'; e0.topics[0] = hash(32); e0.decoded.source = 'mutated';
    await pending;
    const blockRow = (await ctx.db.query('SELECT header FROM v2_indexer_blocks_fork WHERE block_number=$1', ['0'])).rows[0];
    const eventRow = (await ctx.db.query('SELECT topics,decoded FROM v2_indexer_events_fork WHERE block_number=$1', ['0'])).rows[0];
    assert.deepEqual([blockRow.header, eventRow.topics, eventRow.decoded], [{ source: 'original' }, [hash(31)], { source: 'original' }]);
  } finally { await dispose(ctx); }
});

test('hash identities are canonical lowercase in persisted block and event keys', async () => {
  const ctx = await setup();
  try {
    const upperBlockHash = `0x${'AB'.repeat(32)}`;
    const b0 = { ...block(0, zero), blockHash: upperBlockHash };
    await ctx.store.applyBatch({ headers: [b0] });
    const row = (await ctx.db.query('SELECT block_hash FROM v2_indexer_blocks_fork')).rows[0];
    assert.equal(row.block_hash, upperBlockHash.toLowerCase());
  } finally { await dispose(ctx); }
});

test('conflicting event identity is rejected and all rows remain unchanged', async () => {
  const ctx = await setup();
  try {
    const b0 = block(0); const b1 = block(1, b0.blockHash);
    await ctx.store.applyBatch({ headers: [b0] });
    await ctx.store.applyBatch({ expectedCursor: await ctx.store.cursor(), headers: [b1], events: [event(b1)] });
    const before = await snapshot(ctx.db);
    await assert.rejects(ctx.store.applyBatch({ expectedCursor: await ctx.store.cursor(), headers: [{ ...b1, header: { changed: true } }], events: [{ ...event(b1), decoded: { changed: true } }] }), /historical replay conflicts|conflicting/);
    assert.deepEqual(await snapshot(ctx.db), before);
  } finally { await dispose(ctx); }
});

test('next cursor contradictions and fabricated or noncanonical ancestors are denied', async () => {
  const ctx = await setup();
  try {
    await seedLinear(ctx, 2);
    await assert.rejects(ctx.store.applyBatch({ expectedCursor: await ctx.store.cursor(), headers: [block(3, hash(2))], nextCursor: { blockNumber: '4', blockHash: hash(4) } }), /next cursor/);
    await assert.rejects(ctx.store.applyBatch({ expectedCursor: await ctx.store.cursor(), headers: [block(3, hash(2))], reorgAncestor: { blockNumber: '1', blockHash: hash(999) } }), /ancestor/);
    await assert.rejects(ctx.store.applyBatch({ expectedCursor: await ctx.store.cursor(), headers: [block(3, hash(2))], reorgAncestor: { blockNumber: '3', blockHash: hash(3) } }), /ancestor/);
  } finally { await dispose(ctx); }
});

test('verified ancestor is canonical, depth 32 is accepted, depth 33 is rejected atomically', async () => {
  const ctx = await setup();
  try {
    await seedLinear(ctx, 40);
    const before = await snapshot(ctx.db);
    const ancestor32 = { blockNumber: '8', blockHash: hash(8) };
    await ctx.store.applyBatch({ expectedCursor: await ctx.store.cursor(), reorgAncestor: ancestor32 });
    assert.deepEqual(await ctx.store.cursor(), ancestor32);
    const stable = await snapshot(ctx.db);
    const replayHeaders = Array.from({ length: 32 }, (_, i) => block(String(9 + i), hash(8 + i)));
    await ctx.store.applyBatch({ expectedCursor: ancestor32, headers: replayHeaders, reorgAncestor: ancestor32 });
    const cursor40 = await ctx.store.cursor();
    const beforeTooDeep = await snapshot(ctx.db);
    await assert.rejects(ctx.store.applyBatch({ expectedCursor: cursor40, reorgAncestor: { blockNumber: '7', blockHash: hash(7) } }), /depth/);
    assert.deepEqual(await snapshot(ctx.db), beforeTooDeep);
    assert.notDeepEqual(beforeTooDeep, before);
  } finally { await dispose(ctx); }
});

test('orphan fork blocks and events are retained, reactivated, and canonical flags track both identities', async () => {
  const ctx = await setup();
  try {
    const b0 = block(0); const b1 = block(1, b0.blockHash, 11); const b1fork = block(1, b0.blockHash, 12); const b2fork = block(2, b1fork.blockHash, 13);
    await ctx.store.applyBatch({ headers: [b0] });
    await ctx.store.applyBatch({ expectedCursor: await ctx.store.cursor(), headers: [b1], events: [event(b1, 11)] });
    await ctx.store.applyBatch({ expectedCursor: await ctx.store.cursor(), headers: [b1fork, b2fork], events: [event(b1fork, 12), event(b2fork, 13)], reorgAncestor: b0 });
    let rows = await ctx.store.rawEvents(); assert.equal(rows.length, 3); assert.equal(rows.filter((r) => r.canonical).length, 2);
    await ctx.store.applyBatch({ expectedCursor: await ctx.store.cursor(), headers: [b1, block(2, b1.blockHash, 14)], events: [event(b1, 11), event(block(2, b1.blockHash, 14), 14)], reorgAncestor: b0 });
    rows = await ctx.store.rawEvents(); assert.equal(rows.length, 4); assert.equal(rows.filter((r) => r.canonical).length, 2);
    assert.equal((await ctx.db.query('SELECT count(*)::int AS n FROM v2_indexer_blocks_fork WHERE canonical')).rows[0].n, 3);
  } finally { await dispose(ctx); }
});

test('rewind-only reorg updates ancestor cursor and canonical flags atomically', async () => {
  const ctx = await setup();
  try {
    await seedLinear(ctx, 3);
    await ctx.store.applyBatch({ expectedCursor: await ctx.store.cursor(), reorgAncestor: { blockNumber: '1', blockHash: hash(1) } });
    assert.deepEqual(await ctx.store.cursor(), { blockNumber: '1', blockHash: hash(1) });
    assert.deepEqual((await ctx.store.canonicalBlocks()).map((r) => [r.block_number, r.canonical]), [['0', true], ['1', true]]);
    assert.equal((await ctx.store.rawEvents()).filter((r) => r.canonical).length, 1);
  } finally { await dispose(ctx); }
});

test('initial nonzero verified anchor links the first supplied header', async () => {
  const ctx = await setup();
  try {
    const anchor = { blockNumber: '9', blockHash: hash(9) }; const b10 = block(10, anchor.blockHash);
    await ctx.store.applyBatch({ initialVerifiedAnchor: anchor, headers: [b10] });
    assert.deepEqual(await ctx.store.cursor(), { blockNumber: '10', blockHash: hash(10) });
    assert.equal((await ctx.store.canonicalBlocks()).length, 2);
  } finally { await dispose(ctx); }
});

test('transaction crash after batch writes rolls back headers, events, flags, and cursor', async () => {
  const ctx = await setup();
  try {
    await seedLinear(ctx, 1); const before = await snapshot(ctx.db);
    const crashingDb = { ...ctx.db, transaction: async (fn) => ctx.db.transaction(async (tx) => { await fn(tx); throw new Error('injected crash before commit'); }) };
    const crashingStore = createV2IndexerStore({ db: crashingDb, chainId, marketplace, vault });
    const b2 = block(2, hash(1));
    await assert.rejects(crashingStore.applyBatch({ expectedCursor: await ctx.store.cursor(), headers: [b2], events: [event(b2, 2)] }), /injected crash/);
    assert.deepEqual(await snapshot(ctx.db), before);
    await ctx.store.applyBatch({ expectedCursor: await ctx.store.cursor(), headers: [b2], events: [event(b2, 2)] });
  } finally { await dispose(ctx); }
});

test('filesystem reopen and duplicate retry remain idempotent', async () => {
  const ctx = await setup();
  try {
    const b0 = block(0); await ctx.store.applyBatch({ headers: [b0] }); await ctx.db.close();
    const db = await createPgliteDb({ dataDir: ctx.dir }); const store = createV2IndexerStore({ db, chainId, marketplace, vault });
    await store.applyBatch({ expectedCursor: await store.cursor(), headers: [b0] });
    assert.deepEqual(await store.cursor(), { blockNumber: '0', blockHash: hash(0) });
    await db.close();
  } finally { await rm(ctx.dir, { recursive: true, force: true }); }
});

test('off-chain documents, deliveries, applications, and sessions survive reorg', async () => {
  const ctx = await setup();
  try {
    await ctx.db.query("INSERT INTO v2_job_documents (id,chain_id,marketplace,job_id,version,content_hash,content,visibility) VALUES ('doc',5042002,$1,1,1,'h','{}','private')", [marketplace]);
    await ctx.db.query("INSERT INTO v2_deliveries (id,chain_id,marketplace,job_id,version,content_hash,content,visibility,receipt_refs) VALUES ('del',5042002,$1,1,1,'h','{}','private','[]')", [marketplace]);
    await ctx.db.query("INSERT INTO v2_applications (id,chain_id,marketplace,job_id,operator,digest,payload,signature,pitch,epoch,op_nonce) VALUES ('app',5042002,$1,1,'op','dig','{}','sig','pitch',0,0)", [marketplace]);
    await ctx.db.query("INSERT INTO v2_sessions VALUES ('ses','wallet','token',CURRENT_TIMESTAMP + interval '1 hour',NULL,'origin',5042002)");
    await seedLinear(ctx, 1); await ctx.store.applyBatch({ expectedCursor: await ctx.store.cursor(), headers: [block(1, zero, 21)], reorgAncestor: block(0) });
    for (const table of ['v2_job_documents', 'v2_deliveries', 'v2_applications', 'v2_sessions']) assert.equal((await ctx.db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, 1);
  } finally { await dispose(ctx); }
});

test('all three state-version columns retain the full uint256 maximum as NUMERIC text', async () => {
  const ctx = await setup();
  try {
    const max = '115792089237316195423570985008687907853269984665640564039457584007913129639935';
    await ctx.db.query("INSERT INTO v2_jobs (chain_id,marketplace,job_id,reward,status,state_version,terms_hash,client) VALUES (5042002,$1,1,0,'open',$2,'terms','client')", [marketplace, max]);
    await ctx.db.query("INSERT INTO v2_operator_projection (chain_id,marketplace,operator,state_version) VALUES (5042002,$1,'operator',$2)", [marketplace, max]);
    await ctx.db.query("INSERT INTO v2_credit_projection (chain_id,marketplace,wallet,state_version,balance) VALUES (5042002,$1,'wallet',$2,0)", [marketplace, max]);
    const rows = await ctx.db.query('SELECT state_version::text AS state_version FROM v2_jobs UNION ALL SELECT state_version::text FROM v2_operator_projection UNION ALL SELECT state_version::text FROM v2_credit_projection');
    assert.deepEqual(rows.rows.map((row) => row.state_version), [max, max, max]);
  } finally { await dispose(ctx); }
});

test('validation rejects oversized arrays before numeric access, bad bounds, and wrong configuration', async () => {
  const ctx = await setup();
  try {
    let accesses = 0; const oversized = new Proxy(new Array(1001), { get(target, property, receiver) { if (/^\\d+$/.test(String(property))) accesses += 1; return Reflect.get(target, property, receiver); } });
    await assert.rejects(ctx.store.applyBatch({ headers: oversized }), /at most/); assert.equal(accesses, 0);
    for (const bad of ["-1", "1.5", "NaN", "1e3", '9'.repeat(79)]) await assert.rejects(ctx.store.applyBatch({ headers: [{ ...block(0), blockNumber: bad }] }), /blockNumber|uint256/);
    await ctx.store.applyBatch({ headers: [{ ...block(0), header: { blob: 'x'.repeat(16_001) } }] });
    const b0 = block(0); for (const bad of ['0x0', '0xabc', '0xzz']) await assert.rejects(ctx.store.applyBatch({ headers: [b0], events: [event(b0, 1, { data: bad })] }), /data/);
    await assert.rejects(ctx.store.applyBatch({ headers: [b0], events: [event(b0, 1, { topics: [hash(1), hash(2), hash(3), hash(4), hash(5)] })] }), /topics/);
    for (const bad of [-1, Number.NaN, 1.5, 2_147_483_648]) await assert.rejects(ctx.store.applyBatch({ headers: [b0], events: [event(b0, 1, { transactionIndex: bad })] }), /transactionIndex|finite JSON values/);
    await assert.rejects(ctx.store.applyBatch({ headers: [{ ...b0, chainId: 1 }] }), /chain/);
    await assert.rejects(Promise.resolve().then(() => createV2IndexerStore({ db: ctx.db, chainId, marketplace: vault, vault: marketplace })), /configured/);
  } finally { await dispose(ctx); }
});

test('batch header cap is 1000 and uint256 maximum parses without precision loss', async () => {
  const ctx = await setup();
  try {
    const max = '115792089237316195423570985008687907853269984665640564039457584007913129639935';
    const anchor = { blockNumber: max, blockHash: hash(77) };
    await ctx.store.applyBatch({ initialVerifiedAnchor: anchor });
    assert.deepEqual(await ctx.store.cursor(), null);
    await assert.rejects(ctx.store.applyBatch({ headers: new Array(1001).fill(block(0)) }), /at most 1000/);
  } finally { await dispose(ctx); }
});

test('hostile proxy inspection errors are fixed and secret-safe before database work', async () => {
  const ctx = await setup();
  try {
    const evil = new Proxy({}, { getPrototypeOf() { throw new Error('SECRET-PROTO'); } });
    await assert.rejects(
      ctx.store.applyBatch({ headers: [evil] }),
      (error) => error instanceof TypeError && error.message === 'invalid indexer input' && !error.stack.includes('SECRET-PROTO') && !('cause' in error),
    );
    assert.deepEqual(await snapshot(ctx.db), { v2_indexer_blocks_fork: [], v2_indexer_events_fork: [], v2_indexer_cursors: [] });
  } finally { await dispose(ctx); }
});

test('plain accessors are rejected without invoking their bodies', async () => {
  const ctx = await setup();
  try {
    let accesses = 0;
    const header = { get secret() { accesses += 1; return 'SECRET-ACCESSOR'; } };
    await assert.rejects(ctx.store.applyBatch({ headers: [{ ...block(0), header }] }), /data properties/);
    assert.equal(accesses, 0);
    assert.deepEqual(await snapshot(ctx.db), { v2_indexer_blocks_fork: [], v2_indexer_events_fork: [], v2_indexer_cursors: [] });
  } finally { await dispose(ctx); }
});

test('non-finite numbers in headers and decoded payloads reject atomically before database work', async () => {
  const ctx = await setup();
  try {
    let transactionCalls = 0;
    const spyDb = {
      ...ctx.db,
      transaction: async (...args) => {
        transactionCalls += 1;
        return ctx.db.transaction(...args);
      },
    };
    const store = createV2IndexerStore({ db: spyDb, chainId, marketplace, vault });
    const nonFinite = [
      ['NaN', Number.NaN],
      ['+Infinity', Number.POSITIVE_INFINITY],
      ['-Infinity', Number.NEGATIVE_INFINITY],
    ];
    const cases = nonFinite.flatMap(([name, value]) => [
      [`direct header ${name}`, { headers: [{ ...block(0), header: value }], events: [] }],
      [`direct decoded ${name}`, { headers: [block(0)], events: [event(block(0), 1, { decoded: value })] }],
    ]);
    for (const [name, input] of cases) {
      await assert.rejects(store.applyBatch(input), /finite JSON values/, name);
    }
    assert.equal(transactionCalls, 0);
    assert.deepEqual(await snapshot(ctx.db), { v2_indexer_blocks_fork: [], v2_indexer_events_fork: [], v2_indexer_cursors: [] });
  } finally { await dispose(ctx); }
});
