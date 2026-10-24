import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { createPgliteDb, migrate } from '../lib/v2/server/db.mjs';
import { createV2Indexer } from '../lib/v2/server/indexer.mjs';
import { createV2IndexerStore } from '../lib/v2/server/indexer-store.mjs';

const chainId = 5042002;
const marketplace = '0xFA156B7A5205B123c8a22A807ba98405e36130f1';
const vault = '0xD5B271b7Bf4696d662B2bcB1a94b408887c6C423';
const anchor = 68072733;
const hash = (n) => `0x${BigInt(n).toString(16).padStart(64, '0')}`;

function block(number) {
  return { number: `0x${BigInt(number).toString(16)}`, hash: hash(number), parentHash: hash(number - 1), timestamp: '0x1', transactions: [], logsBloom: `0x${'00'.repeat(256)}` };
}

function fixtureSnapshot(number) {
  return {
    chainId: BigInt(chainId),
    blockTag: `0x${BigInt(number).toString(16)}`,
    blockHash: hash(number),
    hashes: { marketplaceNormalized: hash(1), vaultNormalized: hash(2) },
    getters: { owner: `0x${'11'.repeat(20)}`, treasury: `0x${'22'.repeat(20)}`, minReward: '1', nextJobId: '53', feeBps: '100' },
    readJob: async () => ({ client: `0x${'11'.repeat(20)}`, operator: `0x${'22'.repeat(20)}`, resolver: `0x${'00'.repeat(20)}`, reward: '1000', status: '1', stateVersion: '2', canonicalTermsHash: hash(53) }),
    readMutual: async () => ({ proposer: `0x${'11'.repeat(20)}`, version: '1', active: false }),
    readAccount: async () => ({ stateVersion: '2', credits: '7', registered: true }),
    readClientPolicy: async () => ({ listedHouse: false, testClient: true }),
  };
}

async function setup() {
  const dir = await mkdtemp(join(process.env.TMPDIR ?? join(process.cwd(), '.hermes-scratch'), 'v2-preparation-'));
  const db = await createPgliteDb({ dataDir: dir });
  await migrate(db);
  return { dir, db, store: createV2IndexerStore({ db, chainId, marketplace, vault }) };
}

test('prepares a pinned immutable projection before the atomic store transaction', async () => {
  const ctx = await setup();
  let transactionActive = false;
  const originalTransaction = ctx.db.transaction.bind(ctx.db);
  ctx.db.transaction = (fn) => originalTransaction(async (tx) => {
    transactionActive = true;
    try { return await fn(tx); } finally { transactionActive = false; }
  });
  const snapshot = fixtureSnapshot(68072744);
  const transport = async (method, params) => {
    if (method === 'eth_chainId') return '0x4cef52';
    if (method === 'eth_blockNumber') return '0x40eb528';
    if (method === 'eth_getBlockByNumber') {
      const tag = params[0];
      if (tag === 'finalized' || tag === 'safe') throw Object.assign(new Error('unsupported'), { code: -32602 });
      return block(Number(BigInt(tag)));
    }
    if (method === 'eth_getLogs') return [];
    if (method === 'eth_getBlockReceipts') return [];
    throw new Error(`unexpected RPC ${method}`);
  };
  try {
    const result = await createV2Indexer({
      db: ctx.db, store: ctx.store, transport, confirmations: 0, batchSize: 1000,
      initialAnchor: { blockNumber: String(anchor), blockHash: hash(anchor) },
      readerFactory: async () => ({ read: async () => {
        assert.equal(transactionActive, false, 'snapshot preparation must precede db.transaction');
        return snapshot;
      } }),
    }).syncOnce();
    assert.equal(result.status, 'healthy');
    const rows = await ctx.db.query('SELECT source_block,source_hash,data FROM v2_policy_projection WHERE chain_id=$1 AND marketplace=$2', [chainId, marketplace]);
    assert.equal(rows.rows.length, 1);
    assert.equal(String(rows.rows[0].source_block), '68072744');
    assert.equal(rows.rows[0].source_hash, hash(68072744));
    assert.deepEqual(rows.rows[0].data, { owner: `0x${'11'.repeat(20)}`, treasury: `0x${'22'.repeat(20)}`, minReward: '1', nextJobId: '53', feeBps: '100' });
  } finally {
    await ctx.db.close();
    await rm(ctx.dir, { recursive: true, force: true });
  }
});
