import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { createPgDb, migrate } from '../lib/v2/server/db.mjs';

const enabled = process.env.V2_RUN_REAL_PG === '1' && process.env.V2_REAL_PG_APPROVED === '1' && Boolean(process.env.V2_REAL_PG_DSN);
const gate = { skip: enabled ? false : 'gerçek Postgres bekliyor' };
async function withPool(fn) {
  const pool = new pg.Pool({ connectionString: process.env.V2_REAL_PG_DSN });
  const db = createPgDb({ pool });
  try { await migrate(db); return await fn({ db, pool }); } finally { await db.close(); await pool.end(); }
}
const key = (prefix) => `${prefix}-${randomUUID()}`;

test('[real-pg] real PostgreSQL: independent connection visibility', gate, async () => withPool(async ({ db, pool }) => {
  const value = key('visibility'); const c1 = await pool.connect(); const c2 = await pool.connect();
  try {
    await c1.query('BEGIN');
    await c1.query("INSERT INTO v2_idempotency_keys(scope,idempotency_key,request_hash) VALUES ('real-pg',$1,'visible')", [value]);
    await c1.query('COMMIT');
    assert.equal((await c2.query('SELECT request_hash FROM v2_idempotency_keys WHERE scope=$1 AND idempotency_key=$2', ['real-pg', value])).rows[0].request_hash, 'visible');
    await c1.query('BEGIN'); await c1.query('DELETE FROM v2_idempotency_keys WHERE scope=$1 AND idempotency_key=$2', ['real-pg', value]); await c1.query('COMMIT');
  } finally { c1.release(); c2.release(); }
}));

test('[real-pg] real PostgreSQL: multi-client challenge and idempotency race', gate, async () => withPool(async ({ db, pool }) => {
  const id = key('challenge'); await db.query("INSERT INTO v2_auth_challenges VALUES ($1,'0xwallet',1,'d','o','m',$1,CURRENT_TIMESTAMP + interval '1 hour',NULL)", [id]);
  const c1 = await pool.connect(); const c2 = await pool.connect();
  try {
    const consume = (client) => client.query("UPDATE v2_auth_challenges SET consumed_at=CURRENT_TIMESTAMP WHERE id=$1 AND consumed_at IS NULL RETURNING id", [id]);
    const [a, b] = await Promise.all([consume(c1), consume(c2)]);
    assert.equal([a, b].filter((result) => result.rows.length === 1).length, 1);
    await db.query('DELETE FROM v2_auth_challenges WHERE id=$1', [id]);
  } finally { c1.release(); c2.release(); }
}));

test('[real-pg] real PostgreSQL: advisory lock ownership and release', gate, async () => withPool(async ({ pool }) => {
  const c1 = await pool.connect(); const c2 = await pool.connect(); const lock = Math.floor(Math.random() * 2000000000);
  try {
    assert.equal((await c1.query('SELECT pg_try_advisory_lock($1) AS locked', [lock])).rows[0].locked, true);
    assert.equal((await c2.query('SELECT pg_try_advisory_lock($1) AS locked', [lock])).rows[0].locked, false);
    assert.equal((await c1.query('SELECT pg_advisory_unlock($1) AS released', [lock])).rows[0].released, true);
    assert.equal((await c2.query('SELECT pg_try_advisory_lock($1) AS locked', [lock])).rows[0].locked, true);
    assert.equal((await c2.query('SELECT pg_advisory_unlock($1) AS released', [lock])).rows[0].released, true);
  } finally { c1.release(); c2.release(); }
}));

test('[real-pg] real PostgreSQL: SELECT FOR UPDATE isolation blocking', gate, async () => withPool(async ({ db, pool }) => {
  const value = key('row-lock'); await db.query("INSERT INTO v2_idempotency_keys(scope,idempotency_key,request_hash) VALUES ('real-pg',$1,'lock')", [value]);
  const c1 = await pool.connect(); const c2 = await pool.connect();
  try {
    await c1.query('BEGIN'); await c1.query('SELECT * FROM v2_idempotency_keys WHERE scope=$1 AND idempotency_key=$2 FOR UPDATE', ['real-pg', value]);
    await c2.query('BEGIN'); await c2.query("SET LOCAL statement_timeout='2000ms'");
    const waiting = c2.query('SELECT * FROM v2_idempotency_keys WHERE scope=$1 AND idempotency_key=$2 FOR UPDATE', ['real-pg', value]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal((await c1.query('SELECT 1 AS still_owner')).rows[0].still_owner, 1); await c1.query('COMMIT');
    assert.equal((await waiting).rows.length, 1); await c2.query('COMMIT');
    await db.query('DELETE FROM v2_idempotency_keys WHERE scope=$1 AND idempotency_key=$2', ['real-pg', value]);
  } finally { await c1.query('ROLLBACK').catch(() => {}); await c2.query('ROLLBACK').catch(() => {}); c1.release(); c2.release(); }
}));

test('[real-pg] real PostgreSQL: pool reconnect behavior', gate, async () => withPool(async ({ pool }) => {
  const c1 = await pool.connect(); const firstPid = (await c1.query('SELECT pg_backend_pid() AS pid')).rows[0].pid; await c1.end(); await pool.end();
  const replacement = new pg.Pool({ connectionString: process.env.V2_REAL_PG_DSN }); const c2 = await replacement.connect();
  try { assert.notEqual((await c2.query('SELECT pg_backend_pid() AS pid')).rows[0].pid, firstPid); } finally { c2.release(); await replacement.end(); }
}));

test('[real-pg] real PostgreSQL: LISTEN/NOTIFY and extension availability', gate, async () => withPool(async ({ pool }) => {
  const channel = `v2_gate_${randomUUID().replaceAll('-', '')}`; const payload = `payload-${randomUUID()}`;
  const listener = await pool.connect(); const sender = await pool.connect(); const notifications = [];
  const handler = (message) => { if (message.channel === channel) notifications.push(message.payload); };
  try {
    listener.on('notification', handler); await listener.query(`LISTEN "${channel}"`); await sender.query('SELECT pg_notify($1, $2)', [channel, payload]);
    await new Promise((resolve, reject) => { const deadline = setTimeout(() => reject(new Error('LISTEN/NOTIFY timeout')), 2000); const poll = () => notifications.includes(payload) ? (clearTimeout(deadline), resolve()) : setTimeout(poll, 10); poll(); });
    assert.deepEqual(notifications, [payload]);
    assert.equal(typeof (await sender.query("SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name='pgcrypto') AS available")).rows[0].available, 'boolean');
  } finally { listener.removeListener('notification', handler); await listener.query(`UNLISTEN "${channel}"`).catch(() => {}); listener.release(); sender.release(); }
}));
