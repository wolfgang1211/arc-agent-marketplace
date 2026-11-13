import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalArcRuntime, verifyLocalArcMigrations } from '../lib/v2/server/local-arc-runtime.mjs';
import { options, startLocalArcIndexer } from '../scripts/v2-local-arc-indexer.mjs';

test('local Arc runtime is fail-closed at the environment boundary', async () => {
  await assert.rejects(() => createLocalArcRuntime({ env: { V2_LOCAL_ARC: '0', V2_CHAIN_PROFILE: 'arc-testnet' } }), /V2_LOCAL_ARC/);
  await assert.rejects(() => createLocalArcRuntime({ env: { V2_LOCAL_ARC: '1', V2_CHAIN_PROFILE: 'local-hardhat' } }), /V2_CHAIN_PROFILE/);
  await assert.rejects(() => createLocalArcRuntime({ env: { V2_LOCAL_ARC: '1', V2_CHAIN_PROFILE: 'arc-testnet', VERCEL: '1' } }), /Vercel/);
  await assert.rejects(() => startLocalArcIndexer({ env: { V2_LOCAL_ARC: '1', V2_CHAIN_PROFILE: 'arc-testnet', VERCEL: '1' }, argv: [] }), /Vercel/);
});

test('indexer defaults to a bounded Arc catch-up range and rejects unsafe overrides', () => {
  const config = options([], { V2_LOCAL_ARC_BATCH_SIZE: undefined, V2_LOCAL_ARC_MAX_BATCHES: undefined, V2_LOCAL_ARC_CONFIRMATIONS: undefined, V2_LOCAL_ARC_RETRIES: undefined, V2_LOCAL_ARC_RPC_TIMEOUT_MS: undefined, V2_LOCAL_ARC_TOTAL_BUDGET_MS: undefined, V2_LOCAL_ARC_INTERVAL_MS: undefined });
  assert.equal(config.batchSize, 25);
  assert.equal(config.maxBatches, 1);
  assert.equal(config.confirmations, 32);
  assert.throws(() => options(['--batch-size=0'], {}), /out of bounds/);
  assert.throws(() => options(['--max-batches=9'], {}), /out of bounds/);
  assert.throws(() => options(['--total-budget-ms=60001'], {}), /out of bounds/);
});

test('migration verification is read-only and fails missing or drifted checksums', async () => {
  const queries = [];
  const valid = {
    query: async (sql) => {
      queries.push(sql);
      return { rows: [
        { migration_id: '001-core', checksum: 'bad' },
        { migration_id: '002-indexer', checksum: 'bad' },
        { migration_id: '003-indexer-projection', checksum: 'bad' },
      ] };
    },
  };
  await assert.rejects(() => verifyLocalArcMigrations(valid), /checksum drift/);
  assert.equal(queries.length, 1);
  assert.match(queries[0], /^SELECT migration_id, checksum FROM v2_schema_migrations$/);
  assert.doesNotMatch(queries[0], /CREATE|INSERT|UPDATE|DELETE/i);
  await assert.rejects(() => verifyLocalArcMigrations({ query: async () => ({ rows: [] }) }), /missing/);
});
