import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { PGlite } from '@electric-sql/pglite';

const MIGRATION_ID = '001-core';
const MIGRATIONS = Object.freeze([
  Object.freeze({ id: '001-core', url: new URL('../../../db/v2/migrations/001-core.sql', import.meta.url) }),
  Object.freeze({ id: '002-indexer', url: new URL('../../../db/v2/migrations/002-indexer.sql', import.meta.url) }),
  Object.freeze({ id: '003-indexer-projection', url: new URL('../../../db/v2/migrations/003-indexer-projection.sql', import.meta.url) }),
]);
const UINT256_MAX = '115792089237316195423570985008687907853269984665640564039457584007913129639935';
export const DEFAULT_PGLITE_DATA_DIR = path.join(os.homedir(), 'AppData', 'Local', 'hermes', 'state', 'alphaboard-v2', 'pglite');

// Kept out of the public contract: migration execution needs multi-statement SQL.
export const MIGRATION_EXEC = Symbol.for('arc-agent-marketplace.v2.migrationExec');
const TRANSACTION_EXEC = Symbol.for('arc-agent-marketplace.v2.transactionExec');

function resultShape(result) {
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  return { rows, rowCount: result?.rowCount ?? result?.affectedRows ?? rows.length };
}

function makeQueuedDb({ query, transaction, close, capabilities, execMigration }) {
  let tail = Promise.resolve();
  let closed = false;
  let closing = null;
  const transactionContext = new AsyncLocalStorage();
  const nestedError = () => new Error('nested transactions are not supported');
  const transactionQueryError = () => new Error('USE_TRANSACTION_HANDLE');

  const enqueue = (work) => {
    if (closed || closing) return Promise.reject(new Error('database is closed'));
    const run = tail.then(work);
    tail = run.catch(() => {});
    return run;
  };

  const db = {
    capabilities: Object.freeze({ ...capabilities }),
    query(sql, params = []) {
      if (transactionContext.getStore()?.active) return Promise.reject(transactionQueryError());
      return enqueue(() => query(sql, params));
    },
    transaction(fn) {
      if (transactionContext.getStore()?.active) return Promise.reject(nestedError());
      return enqueue(async () => {
        const state = { active: true };
        return transactionContext.run(state, () => transaction(fn, state));
      });
    },
    close() {
      if (closing) return closing;
      closing = tail.then(async () => {
        await close();
        closed = true;
      });
      return closing;
    },
  };
  Object.defineProperty(db, MIGRATION_EXEC, { value: (sql, params) => enqueue(() => execMigration(sql, params)) });
  return db;
}

function pgQueryResult(result) {
  return { rows: result?.rows ?? [], rowCount: result?.rowCount ?? result?.rows?.length ?? 0 };
}

export async function createPgliteDb({ dataDir = DEFAULT_PGLITE_DATA_DIR } = {}) {
  if (typeof dataDir !== 'string' || dataDir.length === 0) throw new TypeError('dataDir must be a non-empty string');
  const raw = new PGlite(dataDir);
  await raw.waitReady;
  const runRaw = async (sql, params = []) => resultShape(await raw.query(sql, params));
  return makeQueuedDb({
    query: runRaw,
    transaction: async (fn, state) => raw.transaction(async (rawTx) => {
      const assertActive = () => { if (!state.active) throw new Error('TRANSACTION_CLOSED'); };
      const tx = {
        query: async (sql, params = []) => { assertActive(); return resultShape(await rawTx.query(sql, params)); },
      };
      Object.defineProperty(tx, TRANSACTION_EXEC, { value: async (sql) => { assertActive(); return rawTx.exec(sql); } });
      Object.freeze(tx);
      try { return await fn(tx); } finally { state.active = false; }
    }),
    close: () => raw.close(),
    execMigration: async (sql) => { await raw.transaction((tx) => tx.exec(sql)); },
    capabilities: { adapter: 'pglite', persistent: !dataDir.startsWith('memory://'), serialized: true, extensions: false },
  });
}

export function createPgDb({ pool } = {}) {
  if (!pool || typeof pool.connect !== 'function') throw new TypeError('pool with connect() is required');
  return makeQueuedDb({
    query: async (sql, params = []) => {
      const client = await pool.connect();
      try { return pgQueryResult(await client.query(sql, params)); } finally { client.release(); }
    },
    transaction: async (fn, state) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const assertActive = () => { if (!state.active) throw new Error('TRANSACTION_CLOSED'); };
        const tx = {
          query: async (sql, params = []) => { assertActive(); return pgQueryResult(await client.query(sql, params)); },
        };
        Object.defineProperty(tx, TRANSACTION_EXEC, { value: async (sql) => { assertActive(); return client.query(sql); } });
        Object.freeze(tx);
        let value;
        try { value = await fn(tx); } finally { state.active = false; }
        await client.query('COMMIT');
        return value;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* preserve original failure */ }
        throw error;
      } finally { client.release(); }
    },
    close: async () => {},
    execMigration: async (sql) => {
      const client = await pool.connect();
      try { await client.query('BEGIN'); await client.query(sql); await client.query('COMMIT'); }
      catch (error) { try { await client.query('ROLLBACK'); } catch {} throw error; }
      finally { client.release(); }
    },
    capabilities: { adapter: 'pg', persistent: true, serialized: true, extensions: 'server-dependent' },
  });
}

export async function migrate(db, { migrationExec } = {}) {
  const migrations = [];
  for (const migration of MIGRATIONS) {
    const sql = await readFile(migration.url, 'utf8');
    migrations.push({ ...migration, sql, checksum: createHash('sha256').update(sql).digest('hex') });
  }
  return db.transaction(async (tx) => {
    await tx.query('CREATE TABLE IF NOT EXISTS v2_schema_migrations (migration_id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)');
    const results = [];
    for (const migration of migrations) {
      const existing = await tx.query('SELECT checksum FROM v2_schema_migrations WHERE migration_id = $1', [migration.id]);
      if (existing.rows.length > 0) {
        if (existing.rows[0].checksum !== migration.checksum) throw new Error(`migration checksum drift: ${migration.id}`);
        results.push({ migrationId: migration.id, checksum: migration.checksum, applied: false });
        continue;
      }
      if (migrationExec) await migrationExec(migration.id, migration.sql, tx);
      else await tx[TRANSACTION_EXEC](migration.sql);
      await tx.query('INSERT INTO v2_schema_migrations (migration_id, checksum) VALUES ($1, $2)', [migration.id, migration.checksum]);
      results.push({ migrationId: migration.id, checksum: migration.checksum, applied: true });
    }
    const latest = results.at(-1);
    return { ...latest, applied: results.some((result) => result.applied), results };
  });
}

export const v2Schema = Object.freeze({ migrationId: '002-indexer', uint256Max: UINT256_MAX });
export { MIGRATIONS };
