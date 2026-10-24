import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createPgliteDb, MIGRATIONS, migrate } from '../lib/v2/server/db.mjs';

const scratch = process.env.TMPDIR ?? join(process.cwd(), '.hermes-scratch');
async function fresh() { const dir = await mkdtemp(join(scratch, 'v2-migration-')); const db = await createPgliteDb({ dataDir: dir }); return { db, dir }; }
async function dispose(ctx) { await ctx.db.close(); await rm(ctx.dir, { recursive: true, force: true }); }
const EXPECTED_MIGRATIONS = ['001-core', '002-indexer', '003-indexer-projection'];

 test('real PGlite migrations 001, 002, and 003 run in one atomic transaction and preserve legacy rows', async () => {
  const ctx = await fresh();
  try {
    const first = await migrate(ctx.db);
    assert.deepEqual(first.results.map((result) => result.migrationId), EXPECTED_MIGRATIONS);
    await ctx.db.query("INSERT INTO v2_deployments VALUES (5042002, 'legacy-market', 'legacy-deployment')");
    await ctx.db.query("INSERT INTO v2_jobs(chain_id,marketplace,job_id,reward,status,terms_hash,client,data) VALUES (5042002,'legacy-market','7','9','open','terms','client','{}')");
    await ctx.db.close();
    const reopened = await createPgliteDb({ dataDir: ctx.dir });
    const second = await migrate(reopened);
    assert.equal(second.applied, false);
    assert.equal((await reopened.query("SELECT count(*)::int AS n FROM v2_indexer_blocks_fork")).rows[0].n, 0);
    assert.equal((await reopened.query("SELECT deployment_address FROM v2_deployments WHERE marketplace='legacy-market'")).rows[0].deployment_address, 'legacy-deployment');
    assert.equal((await reopened.query("SELECT job_id FROM v2_jobs WHERE marketplace='legacy-market'")).rows[0].job_id, '7');
    await reopened.close();
  } finally { try { await rm(ctx.dir, { recursive: true, force: true }); } catch {} }
});

test('fresh 002 execution failure rolls back 001 and 002 together, then retry succeeds', async () => {
  const ctx = await fresh();
  try {
    await assert.rejects(migrate(ctx.db, { migrationExec: async (id, sql, tx) => { await tx[Symbol.for('arc-agent-marketplace.v2.transactionExec')](sql); if (id === '002-indexer') throw new Error('injected 002 failure'); } }), /injected 002 failure/);
    assert.equal((await ctx.db.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name='v2_jobs'")).rows[0].n, 0);
    await assert.rejects(ctx.db.query('SELECT count(*)::int AS n FROM v2_schema_migrations'), /does not exist/);
    const retried = await migrate(ctx.db);
    assert.equal(retried.applied, true);
    assert.equal((await ctx.db.query("SELECT count(*)::int AS n FROM v2_schema_migrations")).rows[0].n, EXPECTED_MIGRATIONS.length);
  } finally { await dispose(ctx); }
});

test('checksum drift is checked independently for all three migration records', async () => {
  const ctx = await fresh();
  try {
    await migrate(ctx.db);
    for (const id of EXPECTED_MIGRATIONS) {
      await ctx.db.query('UPDATE v2_schema_migrations SET checksum=$1 WHERE migration_id=$2', ['drift', id]);
      await assert.rejects(migrate(ctx.db), new RegExp(`migration checksum drift: ${id}`));
      const checksum = createHash('sha256').update(await (await import('node:fs/promises')).readFile(MIGRATIONS.find((m) => m.id === id).url, 'utf8')).digest('hex');
      await ctx.db.query('UPDATE v2_schema_migrations SET checksum=$1 WHERE migration_id=$2', [checksum, id]);
    }
  } finally { await dispose(ctx); }
});
