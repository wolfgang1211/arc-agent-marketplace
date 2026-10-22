import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { createPgliteDb, migrate } from '../lib/v2/server/db.mjs';
import { createV2IndexerStore } from '../lib/v2/server/indexer-store.mjs';

const market = '0xFA156B7A5205B123c8a22A807ba98405e36130f1';
const vault = '0xD5B271b7Bf4696d662B2bcB1a94b408887c6C423';
const zero = `0x${'00'.repeat(32)}`;
const block = (number, parentHash = zero, suffix = String(number)) => ({ blockNumber: String(number), blockHash: `0x${suffix.padStart(64, '0')}`, parentHash, transactionCount: 1 });
async function setup() { const dir = await mkdtemp(join(process.env.TMPDIR ?? join(process.cwd(), '.hermes-scratch'), 'v2-indexer-')); const db = await createPgliteDb({ dataDir: dir }); await migrate(db); return { db, dir, store: createV2IndexerStore({ db, chainId: 5042002, marketplace: market, vault }) }; }
async function teardown({ db, dir }) { await db.close(); await rm(dir, { recursive: true, force: true }); }

test('batch persistence is atomic, idempotent, ordered, and retains reorg orphans', async () => {
  const ctx = await setup();
  try {
    await ctx.store.applyBatch({ headers: [block(0)] });
    await ctx.store.applyBatch({ headers: [block(1, block(0).blockHash)], events: [{ emitter: vault, blockNumber: '1', blockHash: block(1, block(0).blockHash).blockHash, transactionHash: `0x${'11'.repeat(32)}`, transactionIndex: 0, logIndex: 0, topics: [], data: '0x', decoded: { n: '1' }, eventName: 'VaultEvent' }] });
    await ctx.store.applyBatch({ expectedCursor: await ctx.store.cursor(), headers: [block(1, block(0).blockHash, 'a')], reorgAncestor: block(0) });
    await assert.rejects(ctx.store.applyBatch({ expectedCursor: block(0), headers: [block(2, block(1, block(0).blockHash, 'a').blockHash)] }), /stale|continu/);
    const rows = (await ctx.db.query('SELECT block_number,canonical FROM v2_indexer_blocks_fork ORDER BY block_number,block_hash')).rows;
    assert.deepEqual(rows.map((row) => [row.block_number, row.canonical]), [['0', true], ['1', false], ['1', true]]);
    assert.equal((await ctx.store.rawEvents()).length, 1);
  } finally { await teardown(ctx); }
});

test('indexer rejects wrong chain, emitter, gaps, and malformed identities before mutation', async () => {
  const ctx = await setup();
  try {
    await assert.rejects(ctx.store.applyBatch({ headers: [{ ...block(0), chainId: 1 }] }), /chain/);
    await assert.rejects(ctx.store.applyBatch({ headers: [block(0)], events: [{ emitter: '0x0000000000000000000000000000000000000001', blockNumber: '0', blockHash: block(0).blockHash, transactionHash: `0x${'22'.repeat(32)}`, transactionIndex: 0, logIndex: 0, topics: [], data: '0x', eventName: 'Bad' }] }), /emitter/);
    await assert.rejects(ctx.store.applyBatch({ headers: [block(0), block(2)] }), /contiguous/);
    assert.equal((await ctx.db.query('SELECT count(*)::int AS n FROM v2_indexer_blocks_fork')).rows[0].n, 0);
  } finally { await teardown(ctx); }
});
