import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

const root = path.join(os.homedir(), 'AppData', 'Local', 'hermes', 'state', 'alphaboard-v2-local-arc');
const require = createRequire(path.join(root, 'tools', 'package.json'));
const { PGlite } = require('@electric-sql/pglite');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');
const dataDir = path.join(root, 'database');
await fs.mkdir(dataDir, { recursive: true });
const db = await PGlite.create(dataDir);
const server = new PGLiteSocketServer({ db, host: '127.0.0.1', port: 54329, maxConnections: 8, inspect: false, debug: false });
await server.start();
console.log(JSON.stringify({ service: 'v2-arc-db', host: '127.0.0.1', port: 54329, dataDir, mode: 'pglite-socket', ready: true }));
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await server.stop();
  await db.close();
  process.exit(0);
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
process.on('message', message => { if (message === 'shutdown') stop(); });
