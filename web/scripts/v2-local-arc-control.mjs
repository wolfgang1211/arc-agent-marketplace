import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import { Pool } from 'pg';
import { createPgDb, migrate } from '../lib/v2/server/db.mjs';

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = path.join(os.homedir(), 'AppData', 'Local', 'hermes', 'state', 'alphaboard-v2-local-arc');
const require = createRequire(path.join(process.env.APPDATA, 'npm', 'package.json'));
const pm2 = require('pm2');
const names = { db: 'alphaboard-v2-arc-db', indexer: 'alphaboard-v2-arc-indexer', web: 'alphaboard-v2-arc-web' };
const invoke = (name, ...args) => new Promise((resolve, reject) => pm2[name](...args, (error, value) => error ? reject(error) : resolve(value)));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const safeInherited = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'HOME', 'HOMEDRIVE', 'HOMEPATH', 'TEMP', 'TMP', 'TMPDIR', 'OS', 'LANG', 'NUMBER_OF_PROCESSORS']);
const filterEnv = Object.keys(process.env).filter(key => !safeInherited.has(key.toUpperCase()));
const env = { V2_LOCAL_ARC: '1', V2_CHAIN_PROFILE: 'arc-testnet', NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: '3102', V2_LOCAL_ARC_DB_PORT: '54329' };
async function start(kind, script, args = []) {
  const existing = (await invoke('list')).find(row => row.name === names[kind]);
  if (existing) {
    if (existing.pm2_env.status !== 'online') await invoke('restart', names[kind]);
    return;
  }
  await invoke('start', { name: names[kind], cwd: web, script, args, interpreter: process.execPath, filter_env: filterEnv, env, autorestart: false, kill_timeout: kind === 'indexer' ? 75000 : 15000, shutdown_with_message: kind !== 'web', out_file: path.join(home, 'logs', kind + '-out.log'), error_file: path.join(home, 'logs', kind + '-error.log'), time: true });
}
async function poolReady() {
  for (let attempt = 0; attempt < 60; attempt++) {
    const pool = new Pool({ host: '127.0.0.1', port: 54329, database: 'postgres', user: 'postgres', ssl: false, max: 1, connectionTimeoutMillis: 1000 });
    try { await pool.query('SELECT 1'); return pool; } catch { await pool.end(); await pause(500); }
  }
  throw new Error('LOCAL_DB_NOT_READY');
}
const command = process.argv[2];
if (!['db', 'migrate', 'start', 'stop', 'status'].includes(command)) throw new Error('Use db | migrate | start | stop | status');
await fs.mkdir(path.join(home, 'logs'), { recursive: true });
await invoke('connect');
try {
  if (command === 'db' || command === 'start') {
    await start('db', 'scripts/v2-local-arc-db.mjs');
    const pool = await poolReady(); await pool.end();
  }
  if (command === 'migrate') {
    const pool = await poolReady();
    try { console.log(JSON.stringify({ migration: await migrate(createPgDb({ pool })), separateStep: true })); } finally { await pool.end(); }
  }
  if (command === 'start') {
    const pool = await poolReady();
    try { const result = await pool.query('SELECT count(*)::integer AS count FROM v2_schema_migrations'); if (result.rows[0].count !== 3) throw new Error('RUN_EXPLICIT_MIGRATE_STEP_FIRST'); } finally { await pool.end(); }
    await start('indexer', 'scripts/v2-local-arc-indexer.mjs');
    await start('web', 'node_modules/next/dist/bin/next', ['start', '--hostname', '127.0.0.1', '--port', '3102']);
    console.log('Application: http://127.0.0.1:3102/v2');
    console.log('Indexer: http://127.0.0.1:3103/health');
  }
  if (command === 'stop') {
    const rows = await invoke('list');
    for (const kind of ['web', 'indexer', 'db']) if (rows.some(row => row.name === names[kind])) await invoke('stop', names[kind]);
  }
  const rows = (await invoke('list')).filter(row => Object.values(names).includes(row.name));
  console.log(JSON.stringify(rows.map(row => ({ name: row.name, pid: row.pid, status: row.pm2_env.status }))));
  if (command === 'start' || command === 'status') {
    let profile = null;
    for (let attempt = 0; attempt < (command === 'start' ? 30 : 1); attempt++) {
      try { const response = await fetch('http://127.0.0.1:3102/api/v2/profile', { signal: AbortSignal.timeout(2000) }); if (response.ok) { profile = (await response.json()).profile; break; } } catch {}
      await pause(500);
    }
    let health = null;
    try { health = await (await fetch('http://127.0.0.1:3103/health', { signal: AbortSignal.timeout(2000) })).json(); } catch {}
    const testReady = profile?.chainId === '5042002' && health?.status === 'healthy' && health?.stale === false && health?.gap == null;
    console.log(JSON.stringify({ profile: profile?.id ?? null, testReady, health, note: testReady ? 'Reader gate passed; counterpart signer readiness is separate.' : 'Do not begin M3-M8: indexer is not fresh.' }));
  }
} finally { pm2.disconnect(); }
