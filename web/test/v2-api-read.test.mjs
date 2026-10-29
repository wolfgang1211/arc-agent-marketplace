import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getAddress } from 'viem';
import { createPgliteDb, migrate } from '../lib/v2/server/db.mjs';
import { createV2ReadApi, MARKETPLACE } from '../lib/v2/server/api-read.mjs';
import { createV2IndexerProjector } from '../lib/v2/server/indexer-projection.mjs';

const chainId = 5042002;
const client = '0x0000000000000000000000000000000000000011';
const address = getAddress('0x0000000000000000000000000000000000000012');
const secret = 'private-sentinel-pitch-signature-token';

async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'arc-v2-read-'));
  const db = await createPgliteDb({ dataDir: dir });
  await migrate(db);
  await db.query(`INSERT INTO v2_jobs (chain_id, marketplace, job_id, reward, status, state_version, terms_hash, client, operator, resolver, source_block, source_hash, data) VALUES
    ($1,$2,'1','9007199254740993','open','7','0xterms1',$3,$4,$4,'12','0xsource1',$5),
    ($1,$2,'2','2','closed','8','0xterms2',$3,$4,$4,'13','0xsource2',$6),
    ($1,'other-market','1','99','open','1','0xother',$3,$4,$4,'1','0xother', $7)`, [chainId, MARKETPLACE, client, address,
    JSON.stringify({ createdAt: '1', description: secret, criteriaHash: '0xcriteria' }),
    JSON.stringify({ house: true }), JSON.stringify({ description: secret })]);
  await db.query(`INSERT INTO v2_job_documents (id, chain_id, marketplace, job_id, version, content_hash, content, visibility) VALUES ('doc-1',$1,$2,'1',1,'0xdoc',$3,'public'), ('doc-2',$1,$2,'2',1,'0xdoc',$4,'private')`, [chainId, MARKETPLACE, JSON.stringify({ title: 'Public title', description: 'Public description', secret }), JSON.stringify({ title: secret })]);
  const projector = createV2IndexerProjector({ chainId, marketplace: MARKETPLACE });
  await db.transaction((tx) => projector(tx, { prepared: { chainId, marketplace: MARKETPLACE, source: { blockTag: '13', blockHash: '0x' + '22'.repeat(32) }, jobs: [], accounts: [{ wallet: address, registered: true, maxActiveJobs: '4', activeJobs: '2', credits: '9007199254740993', nonceEpoch: '1', freeStake: '5', reservedStake: '6', applicationNonces: {} }], mutual: [], reservations: [], policies: [] } }));
  const api = createV2ReadApi({ db });
  return { db, api, dir };
}
async function call(api, path, init = {}) {
  const response = await api(new Request(`https://local.test${path}`, { method: 'GET', ...init }));
  return { response, body: await response.json() };
}
async function close(f) { await f.db.close(); await rm(f.dir, { recursive: true, force: true }); }

test('real PGlite list is fixed-context, keyset paginated, and preserves uint256 strings', async () => {
  const f = await fixture();
  try {
    let page = await call(f.api, '/api/v2/jobs?limit=1');
    assert.equal(page.response.status, 200);
    assert.deepEqual(page.body.data.items.map((x) => x.jobId), ['1']);
    assert.equal(page.body.data.items[0].reward, '9007199254740993');
    assert.equal(page.body.data.count, 1);
    assert.equal(page.body.data.nextCursor, '1');
    page = await call(f.api, `/api/v2/jobs?limit=1&cursor=${page.body.data.nextCursor}`);
    assert.deepEqual(page.body.data.items.map((x) => x.jobId), ['2']);
    assert.equal(page.body.data.nextCursor, null);
    assert.equal(JSON.stringify(page.body).includes(secret), false);
  } finally { await close(f); }
});

test('detail exposes only public document fields and no private payload', async () => {
  const f = await fixture();
  try {
    const { response, body } = await call(f.api, '/api/v2/jobs/1');
    assert.equal(response.status, 200);
    assert.deepEqual(body.data.document, { title: 'Public title', description: 'Public description' });
    assert.equal(JSON.stringify(body).includes(secret), false);
    const privateDoc = await call(f.api, '/api/v2/jobs/2');
    assert.equal(privateDoc.body.data.document, undefined);
  } finally { await close(f); }
});

test('account projection is truthful and source fields are explicit', async () => {
  const f = await fixture();
  try {
    const found = await call(f.api, `/api/v2/accounts/${address}`);
    assert.equal(found.response.status, 200);
    assert.equal(found.body.data.credits.balance, '9007199254740993');
    assert.deepEqual(found.body.data.source, { block: null, hash: null });
    assert.equal(found.body.data.address, address);
    const lower = await call(f.api, `/api/v2/accounts/${address.toLowerCase()}`);
    assert.equal(lower.response.status, 200);
    assert.equal(lower.body.data.address, address);
    const missing = await call(f.api, '/api/v2/accounts/0x0000000000000000000000000000000000000099');
    assert.equal(missing.body.data.operator, null);
    assert.equal(missing.body.data.credits, null);
  } finally { await close(f); }
});

test('health defaults unavailable and hostile errors do not leak provider text', async () => {
  const f = await fixture();
  try {
    const healthApi = createV2ReadApi({ db: f.db, getHealth: async () => { throw new Error(secret); } });
    const result = await call(healthApi, '/api/v2/health');
    assert.equal(result.response.status, 200);
    assert.equal(result.body.data.status, 'unavailable');
    assert.equal(result.body.data.stale, true);
    assert.equal(JSON.stringify(result.body).includes(secret), false);
    const getterApi = createV2ReadApi({ db: f.db, getHealth: async () => { throw Object.defineProperty({}, 'message', { get() { throw new Error('getter invoked'); } }); } });
    const getterResult = await call(getterApi, '/api/v2/health');
    assert.equal(getterResult.body.data.status, 'unavailable');
    for (const [url, status] of [['/api/v2/jobs/not-a-number', 400], ['/api/v2/jobs?limit=0', 400], ['/api/v2/jobs?x=1', 400], ['/api/v2/nope', 404]]) {
      assert.equal((await call(f.api, url)).response.status, status);
    }
    assert.equal((await f.api(new Request('https://local.test/api/v2/jobs', { method: 'POST' }))).status, 405);
  } finally { await close(f); }
});
