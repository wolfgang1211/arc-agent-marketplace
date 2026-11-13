import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import pg from 'pg';
import http from 'node:http';
const origin = 'http://127.0.0.1:3102';
const routes = [];
for (const route of ['/v2', '/jobs', '/api/v2/profile', '/api/v2/health', '/api/v2/jobs']) {
  const response = await fetch(origin + route, { signal: AbortSignal.timeout(10000) });
  if (response.status !== 200) throw new Error('LOCAL_HTTP_FAILED:' + route);
  routes.push({ route, status: response.status, ...(route.startsWith('/api/') ? { body: await response.json() } : {}) });
}
const profile = routes.find(row => row.route === '/api/v2/profile').body.profile;
if (profile.chainId !== '5042002' || profile.id !== 'arc-testnet') throw new Error('PROFILE_MISMATCH');
const wrongHost = await new Promise((resolve, reject) => {
  const request = http.request(origin + '/api/v2/profile', { headers: { Host: 'localhost:3102' } }, response => { response.resume(); resolve({ status: response.statusCode }); });
  request.on('error', reject);
  request.end();
});
if (wrongHost.status !== 403) throw new Error('HOST_GUARD_FAILED');
const shutdown = await fetch('http://127.0.0.1:3103/shutdown', { method: 'POST' });
if (shutdown.status !== 404) throw new Error('HTTP_SHUTDOWN_MUST_NOT_EXIST');
const health = await (await fetch('http://127.0.0.1:3103/health')).json();
const client = new pg.Client({ host: '127.0.0.1', port: 54329, user: 'postgres', database: 'postgres', ssl: false });
await client.connect();
let migrationRows, jobs, cursors;
try {
  migrationRows = (await client.query('SELECT migration_id, checksum FROM v2_schema_migrations ORDER BY migration_id')).rows;
  jobs = (await client.query('SELECT job_id FROM v2_jobs ORDER BY job_id')).rows;
  cursors = (await client.query('SELECT cursor FROM v2_indexer_cursors')).rows;
} finally { await client.end(); }
const evidence = { timestamp: new Date().toISOString(), routes, hostGuardStatus: wrongHost.status, shutdownStatus: shutdown.status, migrationRows, indexedJobCount: jobs.length, indexedJobs: jobs.map(row => row.job_id), cursors, indexerHealth: health, readerReady: health.status === 'healthy' && health.stale === false && health.gap == null, signerReadiness: 'not_verified_by_this_probe', publicChainTransactionsSentByThisProbe: 0 };
const output = path.join(os.homedir(), 'AppData', 'Local', 'hermes', 'state', 'alphaboard-v2-local-arc', 'last-smoke.json');
await fs.writeFile(output, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify({ ...evidence, routes: routes.map(({ route, status }) => ({ route, status })), output }, null, 2));
