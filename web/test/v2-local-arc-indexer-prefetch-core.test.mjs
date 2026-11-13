import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { scratchDir } from './scratch-dir.mjs';
import { createPgliteDb, migrate } from '../lib/v2/server/db.mjs';
import { createV2Indexer } from '../lib/v2/server/indexer.mjs';
import { createV2IndexerStore } from '../lib/v2/server/indexer-store.mjs';
import { createLocalArcPrefetchTransport } from '../scripts/local-arc-prefetch-transport.mjs';
import { snapshot } from './fixtures/v2-indexer-snapshot.mjs';
import manifest from '../lib/v2/indexer-event-manifest.json' with { type: 'json' };
const anchor = 68072733;
const hash = n => `0x${BigInt(n).toString(16).padStart(64, '0')}`;
const header = n => ({ number: `0x${BigInt(n).toString(16)}`, hash: hash(n), parentHash: hash(n - 1), timestamp: '0x1', transactions: [], logsBloom: `0x${'00'.repeat(256)}` });
for (const mode of ['verified empty history', 'source changes after prefetch', 'missing receipt in batch']) {
  test(`real indexer/store through prefetch: ${mode}`, async () => {
    const dataDir = await mkdtemp(join(scratchDir(), 'v2-prefetch-core-'));
    const db = await createPgliteDb({ dataDir }); await migrate(db);
    try {
      const store = createV2IndexerStore({ db, chainId: 5042002, marketplace: manifest.emitters.marketplace, vault: manifest.emitters.vault });
      let batches = 0; let repeatedEnd = 0;
      const end = anchor + 4;
      const scalar = async (method, params = [], fromBatch = false) => {
        if (method === 'eth_chainId') return '0x4cef52';
        if (method === 'eth_blockNumber') return `0x${(anchor + 100).toString(16)}`;
        if (method === 'eth_getLogs') return [];
        if (method === 'eth_getBlockReceipts') return [];
        if (method === 'eth_getBlockByNumber') {
          const n = ['finalized', 'safe', 'latest'].includes(params[0]) ? anchor + 100 : Number(BigInt(params[0]));
          if (fromBatch !== true && n === end) {
            repeatedEnd += 1;
            if (mode === 'source changes after prefetch') return { ...header(n), hash: hash(999999) };
          }
          return header(n);
        }
        throw new Error(`unexpected fixture method ${method}`);
      };
      const transport = createLocalArcPrefetchTransport({ transport: scalar, batchTransport: async requests => {
        batches += 1;
        return Promise.all(requests.map(r => mode === 'missing receipt in batch' && r.method === 'eth_getBlockReceipts' ? null : scalar(r.method, r.params, true)));
      } });
      const readerFactory = async ({ toBlockTag } = {}) => ({ read: async () => snapshot(toBlockTag === undefined ? anchor + 100 : Number(BigInt(toBlockTag))) });
      const indexer = createV2Indexer({ db, store, transport, readerFactory, initialAnchor: { blockNumber: String(anchor), blockHash: hash(anchor) }, confirmations: 0, batchSize: 4, maxBatches: 1, projector: async () => {} });
      const tables = ['v2_indexer_blocks_fork', 'v2_indexer_events_fork', 'v2_indexer_cursors'];
      const dump = async () => Object.fromEntries(await Promise.all(tables.map(async name => [name, (await db.query(`SELECT * FROM ${name} ORDER BY 1,2,3`)).rows])));
      const before = await dump();
      const result = await indexer.syncOnce();
      assert.ok(batches > 0, 'test must actually exercise the prefetch path');
      if (mode === 'verified empty history') {
        assert.equal(result.status, 'catching_up');
        assert.equal((await store.cursor()).blockNumber, String(end));
        assert.ok(repeatedEnd > 0, 'end header must be freshly checked after prefetch');
      } else {
        assert.equal(result.status, 'degraded');
        assert.deepEqual(await dump(), before, 'failed range must not change cursor, blocks or events');
        if (mode === 'source changes after prefetch') assert.ok(repeatedEnd > 0, 'mutation must occur on a fresh network barrier');
      }
      transport.clear();
    } finally { await db.close(); }
  });
}
