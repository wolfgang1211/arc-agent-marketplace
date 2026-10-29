import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { createPgDb, createPgliteDb, migrate } from '../lib/v2/server/db.mjs';
import { scratchDir } from './scratch-dir.mjs';

const scratch = scratchDir();
async function dbAt() {
  const dir = await mkdtemp(join(scratch, 'v2-db-'));
  const db = await createPgliteDb({ dataDir: dir });
  return { db, dir };
}
async function dispose({ db, dir }) { await db.close(); await rm(dir, { recursive: true, force: true }); }

 test('PGlite migration is idempotent and records its checksum', async () => {
  const ctx = await dbAt();
  try {
    const first = await migrate(ctx.db); const second = await migrate(ctx.db);
    assert.equal(first.applied, true); assert.equal(second.applied, false);
    assert.match(first.checksum, /^[0-9a-f]{64}$/);
    assert.equal((await ctx.db.query('SELECT count(*)::int AS n FROM v2_schema_migrations')).rows[0].n, 3);
  } finally { await dispose(ctx); }
});

test('schema preserves NUMERIC(78,0) uint256 values as strings and fork identity is unique', async () => {
  const ctx = await dbAt();
  try {
    await migrate(ctx.db);
    const max = '115792089237316195423570985008687907853269984665640564039457584007913129639935';
    const inserted = await ctx.db.query('INSERT INTO v2_jobs (chain_id,marketplace,job_id,reward,status,terms_hash,client,data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING job_id', [1, '0xmarket', max, '7', 'open', '0xterms', '0xclient', '{}']);
    assert.equal(inserted.rows[0].job_id, max);
    await ctx.db.query('INSERT INTO v2_indexed_blocks VALUES ($1,$2,$3,$4)', [1, '10', '0xhash', '0xparent']);
    await assert.rejects(ctx.db.query('INSERT INTO v2_indexed_blocks VALUES ($1,$2,$3,$4)', [1, '11', '0xhash', '0xother']));
  } finally { await dispose(ctx); }
});

test('migration checksum drift fails closed', async () => {
  const ctx = await dbAt();
  try {
    await migrate(ctx.db);
    await ctx.db.query("UPDATE v2_schema_migrations SET checksum='0' WHERE migration_id='001-core'");
    await assert.rejects(migrate(ctx.db), /migration checksum drift/);
  } finally { await dispose(ctx); }
});

test('transaction commits, rolls back, and queue heals after failure', async () => {
  const ctx = await dbAt();
  try {
    await migrate(ctx.db);
    await ctx.db.transaction((tx) => tx.query("INSERT INTO v2_audit_events(id,event_type,entity_type,entity_id,payload) VALUES ('a','x','y','z','{}')"));
    await assert.rejects(ctx.db.transaction(async (tx) => { await tx.query("INSERT INTO v2_audit_events(id,event_type,entity_type,entity_id,payload) VALUES ('b','x','y','z','{}')"); throw new Error('boom'); }));
    assert.equal((await ctx.db.query('SELECT count(*)::int AS n FROM v2_audit_events')).rows[0].n, 1);
    await assert.rejects(ctx.db.transaction(async () => {
      await ctx.db.transaction(() => Promise.resolve());
    }), /nested transactions/);
    await ctx.db.query("INSERT INTO v2_audit_events(id,event_type,entity_type,entity_id,payload) VALUES ('c','x','y','z','{}')");
    assert.equal((await ctx.db.query('SELECT count(*)::int AS n FROM v2_audit_events')).rows[0].n, 2);
  } finally { await dispose(ctx); }
});

test('async-context nesting rejects only a true nested call; concurrent work queues', async () => {
  const ctx = await dbAt();
  try {
    await migrate(ctx.db);
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const first = ctx.db.transaction(async (tx) => {
      await gate;
      await tx.query("INSERT INTO v2_audit_events(id,event_type,entity_type,entity_id,payload) VALUES ('async-a','x','y','z','{}')");
    });
    await Promise.resolve();
    const second = ctx.db.transaction((tx) => tx.query("INSERT INTO v2_audit_events(id,event_type,entity_type,entity_id,payload) VALUES ('async-b','x','y','z','{}')"));
    release();
    await Promise.all([first, second]);
    assert.equal((await ctx.db.query("SELECT count(*)::int AS n FROM v2_audit_events WHERE id LIKE 'async-%'")).rows[0].n, 2);
  } finally { await dispose(ctx); }
});

test('transaction handles expire before commit/release and never query a released client', async () => {
  const calls = [];
  const client = {
    async query(sql) { calls.push(sql); return { rows: [], rowCount: 0 }; },
    release() { calls.push('RELEASE'); },
  };
  const db = createPgDb({ pool: { connect: async () => client } });
  let tx;
  await db.transaction((handle) => { tx = handle; assert.equal(Object.isFrozen(handle), true); });
  assert.deepEqual(calls, ['BEGIN', 'COMMIT', 'RELEASE']);
  await assert.rejects(tx.query('SELECT 1'), /TRANSACTION_CLOSED/);
  await assert.rejects(tx[Symbol.for('arc-agent-marketplace.v2.transactionExec')]('SELECT 1'), /TRANSACTION_CLOSED/);
  assert.deepEqual(calls, ['BEGIN', 'COMMIT', 'RELEASE']);
  let rolledBack;
  await assert.rejects(db.transaction((handle) => { rolledBack = handle; throw new Error('rollback'); }), /rollback/);
  assert.deepEqual(calls, ['BEGIN', 'COMMIT', 'RELEASE', 'BEGIN', 'ROLLBACK', 'RELEASE']);
  await assert.rejects(rolledBack.query('SELECT 1'), /TRANSACTION_CLOSED/);
  assert.deepEqual(calls, ['BEGIN', 'COMMIT', 'RELEASE', 'BEGIN', 'ROLLBACK', 'RELEASE']);
});

test('serialized auth challenge consumption has one winner', async () => {
  const ctx = await dbAt();
  try {
    await migrate(ctx.db);
    await ctx.db.query("INSERT INTO v2_auth_challenges VALUES ('c','0xwallet',1,'d','o','m','n',CURRENT_TIMESTAMP + interval '1 hour',NULL)");
    const consume = () => ctx.db.query("UPDATE v2_auth_challenges SET consumed_at=CURRENT_TIMESTAMP WHERE id='c' AND consumed_at IS NULL RETURNING id");
    const results = await Promise.all([consume(), consume()]);
    assert.equal(results.filter((r) => r.rows.length === 1).length, 1);
  } finally { await dispose(ctx); }
});

test('filesystem persistence survives close and reopen', async () => {
  const dir = await mkdtemp(join(scratch, 'v2-reopen-'));
  try {
    const one = await createPgliteDb({ dataDir: dir }); await migrate(one);
    await one.query("INSERT INTO v2_idempotency_keys(scope,idempotency_key,request_hash) VALUES ('s','k','h')"); await one.close();
    const two = await createPgliteDb({ dataDir: dir });
    assert.equal((await two.query('SELECT request_hash FROM v2_idempotency_keys WHERE scope=$1 AND idempotency_key=$2', ['s', 'k'])).rows[0].request_hash, 'h');
    await two.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('close waits and then rejects new work; repeated close is safe', async () => {
  const ctx = await dbAt();
  await migrate(ctx.db); await ctx.db.close(); await ctx.db.close();
  await assert.rejects(ctx.db.query('SELECT 1'), /database is closed/);
});
