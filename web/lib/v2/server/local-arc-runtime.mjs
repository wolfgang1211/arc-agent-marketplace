import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { ARC_TESTNET_PROFILE, assertV2Profile } from '../chain-profile.mjs';
import { MIGRATIONS, createPgDb } from './db.mjs';
import { createV2SignatureVerifier } from './api-signatures.mjs';
import { createV2Api, createReadOnlyV2Transport, defaultV2ReaderFactory } from './api-runtime.mjs';

const API_ORIGIN = 'http://127.0.0.1:3102';
const HEALTH_URL = 'http://127.0.0.1:3103/health';
const MAX_HEALTH_AGE_MS = 30_000;

function requiredLocalArcEnvironment(env) {
  if (env.V2_LOCAL_ARC !== '1') throw new Error('V2_LOCAL_ARC must equal 1');
  if (env.V2_CHAIN_PROFILE !== 'arc-testnet') throw new Error('V2_CHAIN_PROFILE must equal arc-testnet');
  if (env.VERCEL || env.VERCEL_ENV || env.VERCEL_URL) throw new Error('local Arc runtime is forbidden on Vercel');
}

async function migrationChecksums() {
  const result = [];
  for (const migration of MIGRATIONS) {
    const sql = await readFile(migration.url, 'utf8');
    result.push({ id: migration.id, checksum: createHash('sha256').update(sql).digest('hex') });
  }
  return result;
}

export async function verifyLocalArcMigrations(db) {
  const expected = await migrationChecksums();
  let rows;
  try {
    rows = (await db.query('SELECT migration_id, checksum FROM v2_schema_migrations')).rows;
  } catch (cause) {
    throw new Error('local Arc database migration state is unavailable', { cause });
  }
  const actual = new Map(rows.map((row) => [String(row.migration_id), String(row.checksum)]));
  for (const migration of expected) {
    if (!actual.has(migration.id)) throw new Error(`local Arc database migration missing: ${migration.id}`);
    if (actual.get(migration.id) !== migration.checksum) throw new Error(`local Arc database migration checksum drift: ${migration.id}`);
  }
}

function unavailableHealth() {
  return { status: 'unavailable', originalStatus: 'unavailable', stale: true, gap: null, cursor: null, reader: 'unavailable', code: 'READER_UNAVAILABLE' };
}

async function readIndexerHealth() {
  try {
    const response = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(2000), cache: 'no-store' });
    if (!response.ok) return unavailableHealth();
    const value = await response.json();
    if (!value || typeof value !== 'object') return unavailableHealth();
    const originalStatus = value.status === 'healthy' || value.status === 'degraded' || value.status === 'unavailable' || value.status === 'catching_up' ? value.status : 'unavailable';
    const timestamp = typeof value.lastSyncedAt === 'string' ? Date.parse(value.lastSyncedAt) : NaN;
    const fresh = originalStatus === 'healthy' && value.stale === false && value.gap == null && Number.isFinite(timestamp) && Date.now() - timestamp >= 0 && Date.now() - timestamp <= MAX_HEALTH_AGE_MS;
    return {
      status: fresh ? 'healthy' : (originalStatus === 'unavailable' ? 'unavailable' : 'degraded'),
      originalStatus,
      stale: !fresh,
      gap: value.gap ?? null,
      cursor: value.cursor ?? null,
      indexedBlock: value.indexedBlock ?? null,
      indexedHash: value.indexedHash ?? null,
      lastSyncedAt: value.lastSyncedAt ?? null,
      reader: fresh ? 'available' : 'unavailable',
      code: fresh ? null : (originalStatus === 'unavailable' ? 'READER_UNAVAILABLE' : 'STALE_READER'),
    };
  } catch {
    return unavailableHealth();
  }
}

export async function createLocalArcRuntime({ env = process.env, pool: suppliedPool } = {}) {
  requiredLocalArcEnvironment(env);
  const profile = ARC_TESTNET_PROFILE;
  assertV2Profile(profile);
  const pool = suppliedPool ?? new Pool({ host: '127.0.0.1', port: 54329, user: 'postgres', database: 'postgres', ssl: false, max: 1 });
  const db = createPgDb({ pool });
  try {
    await verifyLocalArcMigrations(db);
    const transport = createReadOnlyV2Transport({ profile });
    const readerFactory = (options = {}) => defaultV2ReaderFactory({ ...options, profile });
    const verifier = createV2SignatureVerifier({ transport, readerFactory });
    const api = createV2Api({ db, origin: API_ORIGIN, profile, readerFactory, getHealth: readIndexerHealth, transport, verifyWalletSignature: verifier.verifyWalletSignature, readSignature: verifier.readSignature });
    return Object.freeze({ ...api, db, pool, profile, origin: API_ORIGIN, readerFactory, getHealth: readIndexerHealth, transport });
  } catch (cause) {
    if (!suppliedPool) await pool.end().catch(() => {});
    throw new Error('V2_LOCAL_ARC_RUNTIME_UNAVAILABLE', { cause });
  }
}
