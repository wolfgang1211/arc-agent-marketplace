import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { verifyMessage } from 'viem';
import { createPgliteDb, migrate } from '../lib/v2/server/db.mjs';
import { createV2AuthApi } from '../lib/v2/server/api-auth.mjs';
import { createV2PrivateApi } from '../lib/v2/server/api-private.mjs';
import { APPLICATION_TYPES, applicationDomain, hashApplication } from '../lib/v2/applications.mjs';

const ORIGIN = 'https://app.example.test';
const MARKETPLACE = '0xfa156b7a5205b123c8a22a807ba98405e36130f1';
const CHAIN_ID = '5042002';
const HASH = `0x${'ab'.repeat(32)}`;
const BLOCK = `0x${'cd'.repeat(32)}`;
const scratch = process.env.TMPDIR ?? path.join(process.cwd(), '.hermes-scratch');

async function fixture({ assigned = false, account = {}, readSignature } = {}) {
  const dir = await mkdtemp(path.join(scratch, 'v2-private-'));
  const db = await createPgliteDb({ dataDir: dir }); await migrate(db);
  const client = privateKeyToAccount(generatePrivateKey());
  const operator = privateKeyToAccount(generatePrivateKey());
  const outsider = privateKeyToAccount(generatePrivateKey());
  const resolver = privateKeyToAccount(generatePrivateKey());
  const job = { id: '1', status: assigned ? '1' : '0', operator: assigned ? operator.address : null };
  await db.query(`INSERT INTO v2_jobs(chain_id,marketplace,job_id,reward,status,state_version,terms_hash,client,operator,resolver,source_block,source_hash,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [CHAIN_ID, MARKETPLACE, job.id, '100', job.status, '53', HASH, client.address, job.operator, resolver.address, '100', BLOCK, { applyBy: '2000000000' }]);
  const readerFactory = (options = {}) => { assert.equal(options.toBlockTag, '0x64'); return { async read() { return { chainId: 5042002n, blockTag: '0x64', blockHash: BLOCK, async readJob() { return { status: Number(job.status), stateVersion: 53n, canonicalTermsHash: HASH, client: client.address, operator: job.operator, resolver: resolver.address }; }, async readAccount() { return { registered: true, maxActiveJobs: 4n, activeJobs: 0n, credits: 0n, nonceEpoch: 0n, freeStake: 1n, reservedStake: 0n, applicationNonce: async () => 0n, ...account }; } }; } }; };
  let now = 1700000000000;
  const auth = createV2AuthApi({ db, origin: ORIGIN, now: () => now, verifyWalletSignature: ({ wallet, message, signature }) => verifyMessage({ address: wallet, message, signature }) });
  const api = createV2PrivateApi({ db, auth, readerFactory, readSignature, origin: ORIGIN, now: () => now, getHealth: async () => ({ status: 'healthy', stale: false, gap: null }) });
  return { db, dir, client, operator, outsider, resolver, api, auth, job, now: () => now, advance(ms) { now += ms; } };
}
async function close(f) { await f.db.close(); await rm(f.dir, { recursive: true, force: true }); }
function request(f, path, init = {}) { return new Request(`${ORIGIN}${path}`, { ...init, headers: { origin: ORIGIN, ...(init.headers ?? {}) } }); }
async function call(f, path, init = {}) { const response = await f.api(request(f, path, init)); return { response, body: await response.json() }; }
function jsonInit(body, headers = {}) { return { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }; }
async function login(f, account) {
  const challenge = await f.auth.handle(request(f, '/api/v2/auth/challenge', jsonInit({ wallet: account.address, chainId: CHAIN_ID })));
  const c = await challenge.json(); const signature = await account.signMessage({ message: c.message });
  const verified = await f.auth.handle(request(f, '/api/v2/auth/verify', jsonInit({ challengeId: c.challengeId, wallet: account.address, chainId: CHAIN_ID, signature })));
  const v = await verified.json(); return { cookie: verified.headers.get('set-cookie'), csrf: v.csrf };
}
function typedApplication(f, account) { return { jobId: 1n, operator: account.address, termsHash: HASH, validAfter: 1699999900n, validBefore: 1800000000n, nonceEpoch: 0n, operatorNonce: 0n }; }
async function appPostApplication(f, account, application, auth, key = 'app-1', pitch = 'real pitch', signatureOverride = null) { const signature = signatureOverride ?? await account.signTypedData({ domain: applicationDomain(5042002n, MARKETPLACE), types: APPLICATION_TYPES, primaryType: 'Application', message: application }); return call(f, '/api/v2/jobs/1/applications', jsonInit({ application: Object.fromEntries(Object.entries(application).map(([k,v]) => [k, typeof v === 'bigint' ? v.toString() : v])), signature, pitch }, { cookie: auth.cookie, 'x-v2-csrf': auth.csrf, 'idempotency-key': key })); }
async function appPost(f, account, key = 'app-1', pitch = 'real pitch', signatureOverride = null) { const auth = await login(f, account); return appPostApplication(f, account, typedApplication(f, account), auth, key, pitch, signatureOverride); }

test('real PGlite application write verifies the exact EIP-712 domain and stores wire decimal strings', async () => {
  const f = await fixture(); try { const out = await appPost(f, f.operator); assert.equal(out.response.status, 201); assert.equal(out.body.application.payload.jobId, '1'); assert.equal(typeof out.body.application.payload.operatorNonce, 'string'); const row = (await f.db.query('SELECT payload,epoch,op_nonce FROM v2_applications')).rows[0]; assert.equal(row.payload.jobId, '1'); assert.equal(row.epoch, '0'); assert.equal(row.op_nonce, '0'); } finally { await close(f); }
});

test('application idempotency replays exactly and conflicts without a second audit row', async () => {
  const f = await fixture(); try { const first = await appPost(f, f.operator, 'same'); const second = await appPost(f, f.operator, 'same'); assert.equal(first.response.status, 201); assert.equal(second.response.status, 200); assert.deepEqual(second.body, first.body); const conflict = await appPost(f, f.operator, 'same', 'different'); assert.equal(conflict.response.status, 409); assert.equal((await f.db.query("SELECT count(*)::int AS n FROM v2_audit_events WHERE event_type='application.created'")).rows[0].n, 1); } finally { await close(f); }
});

test('ACL rejects an outsider and an assigned operator cannot read other operators applications', async () => {
  const f = await fixture({ assigned: true }); try { await f.db.query('INSERT INTO v2_applications(id,chain_id,marketplace,job_id,operator,digest,payload,signature,pitch,epoch,op_nonce) VALUES($1,$2,$3,1,$4,$5,$6,$7,$8,0,0)', ['a', CHAIN_ID, MARKETPLACE, f.outsider.address, HASH, '{}', `0x${'11'.repeat(65)}`, 'private']); const outsider = await login(f, f.outsider); const denied = await call(f, '/api/v2/jobs/1/applications', { headers: { cookie: outsider.cookie, 'x-v2-csrf': outsider.csrf } }); assert.equal(denied.response.status, 403); const own = await login(f, f.operator); const visible = await call(f, '/api/v2/jobs/1/applications', { headers: { cookie: own.cookie, 'x-v2-csrf': own.csrf } }); assert.equal(visible.response.status, 200); assert.equal(visible.body.count, 0); } finally { await close(f); }
});

test('freshness is pinned to the canonical DB block and stale hash/version fails closed before writes', async () => {
  const f = await fixture(); try { const auth = await login(f, f.operator); await f.db.query('UPDATE v2_jobs SET source_hash=$1 WHERE job_id=1', [`0x${'ef'.repeat(32)}`]); const out = await call(f, '/api/v2/jobs/1/applications', { headers: { cookie: auth.cookie, 'x-v2-csrf': auth.csrf } }); assert.equal(out.response.status, 503); assert.equal(out.body.error, 'STALE_DATA'); } finally { await close(f); }
});

test('missing applyBy never falls back to the signed validBefore field', async () => {
  const f = await fixture(); try { await f.db.query("UPDATE v2_jobs SET data='{}'::jsonb"); const out = await appPost(f, f.operator); assert.equal(out.response.status, 503); assert.equal(out.body.error, 'STALE_DATA'); assert.equal((await f.db.query('SELECT count(*)::int AS n FROM v2_applications')).rows[0].n, 0); } finally { await close(f); }
});

test('delivery and revision writes require explicit kind and derive monotonic versions inside the transaction', async () => {
  const f = await fixture({ assigned: true });
  try {
    const auth = await login(f, f.operator);
    const first = await call(f, '/api/v2/jobs/1/deliveries', jsonInit({ kind: 'delivery', revision: false, version: '1', content: { result: 'one' } }, { cookie: auth.cookie, 'x-v2-csrf': auth.csrf, 'idempotency-key': 'delivery-1' }));
    assert.equal(first.response.status, 201);
    await f.db.query("INSERT INTO v2_deliveries(id,chain_id,marketplace,job_id,version,content_hash,content,visibility,receipt_refs) VALUES('seed', $1,$2,1,2,$3,'{}','private','[]')", [CHAIN_ID, MARKETPLACE, HASH]);
    f.job.status = '3'; await f.db.query('UPDATE v2_jobs SET status=$1 WHERE job_id=1', ['3']);
    const revision = await call(f, '/api/v2/jobs/1/deliveries', jsonInit({ kind: 'revision', revision: true, version: '3', content: { result: 'three' } }, { cookie: auth.cookie, 'x-v2-csrf': auth.csrf, 'idempotency-key': 'delivery-3' }));
    assert.equal(revision.response.status, 201);
    const bad = await call(f, '/api/v2/jobs/1/deliveries', jsonInit({ kind: 'delivery', revision: false, version: '4', content: {} }, { cookie: auth.cookie, 'x-v2-csrf': auth.csrf, 'idempotency-key': 'bad-kind' }));
    assert.equal(bad.response.status, 403);
  } finally { await close(f); }
});

test('delivery idempotency binds the requested version and rejects changed versions without mutation', async () => {
  const f = await fixture({ assigned: true });
  try {
    const auth = await login(f, f.operator);
    const headers = { cookie: auth.cookie, 'x-v2-csrf': auth.csrf, 'idempotency-key': 'version-bound' };
    const first = await call(f, '/api/v2/jobs/1/deliveries', jsonInit({ kind: 'delivery', revision: false, version: '1', content: { result: 'same' } }, headers));
    assert.equal(first.response.status, 201);
    const changedVersion = await call(f, '/api/v2/jobs/1/deliveries', jsonInit({ kind: 'delivery', revision: false, version: '2', content: { result: 'same' } }, headers));
    assert.equal(changedVersion.response.status, 409);
    assert.equal(changedVersion.body.error, 'IDEMPOTENCY_CONFLICT');
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM v2_deliveries')).rows[0].n, 1);
    assert.equal((await f.db.query("SELECT count(*)::int AS n FROM v2_audit_events WHERE event_type='delivery.created'")).rows[0].n, 1);
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM v2_idempotency_keys')).rows[0].n, 1);
  } finally { await close(f); }
});

test('unexpected provider and database errors are redacted to the fixed private error contract', async () => {
  const f = await fixture(); try { const hostile = Object.defineProperty(new Error('secret-provider-text'), 'code', { get() { throw new Error('getter-secret'); } }); const broken = createV2PrivateApi({ db: { query: async () => { throw hostile; }, transaction: async () => { throw hostile; } }, auth: { authenticateRequest: async () => ({ wallet: f.outsider.address }) }, readerFactory: () => ({ read: async () => { throw hostile; } }), origin: ORIGIN, getHealth: async () => ({ status: 'healthy', stale: false, gap: null }) }); const response = await broken(request(f, '/api/v2/jobs/1/applications', { headers: { cookie: 'bad' } })); const text = await response.text(); assert.equal(response.status, 500); assert.equal(text, '{"error":"INTERNAL_ERROR"}'); assert.equal(text.includes('secret-provider-text'), false); } finally { await close(f); }
});

test('private GET permits browser-shaped same-origin requests without Origin and rejects empty path segments', async () => {
  const f = await fixture(); try { const auth = await login(f, f.client); const noOrigin = new Request(`${ORIGIN}/api/v2/jobs/1/applications`, { headers: { cookie: auth.cookie, 'x-v2-csrf': auth.csrf } }); assert.equal((await f.api(noOrigin)).status, 200); const malformed = await call(f, '/api//v2/jobs/1/applications', { headers: { cookie: auth.cookie, 'x-v2-csrf': auth.csrf } }); assert.equal(malformed.response.status, 404); } finally { await close(f); }
});

test('resolver lookup is case insensitive and count reflects returned rows', async () => {
  const f = await fixture(); try { const auth = await login(f, f.resolver); const out = await call(f, '/api/v2/resolver', { headers: { cookie: auth.cookie, 'x-v2-csrf': auth.csrf } }); assert.equal(out.response.status, 200); assert.equal(out.body.count, out.body.items.length); assert.equal(out.body.count, 0); await f.db.query('UPDATE v2_jobs SET resolver=upper(resolver)'); const second = await call(f, '/api/v2/resolver', { headers: { cookie: auth.cookie, 'x-v2-csrf': auth.csrf } }); assert.equal(second.response.status, 200); assert.equal(second.body.count, second.body.items.length); } finally { await close(f); }
});

test('application admission rejects unregistered and at-capacity operators before idempotency or audit writes', async () => {
  for (const account of [{ registered: false }, { registered: true, maxActiveJobs: 1n, activeJobs: 1n }]) { const f = await fixture({ account }); try { const out = await appPost(f, f.operator); assert.equal(out.response.status, 403); assert.equal((await f.db.query('SELECT count(*)::int AS n FROM v2_applications')).rows[0].n, 0); assert.equal((await f.db.query('SELECT count(*)::int AS n FROM v2_audit_events')).rows[0].n, 0); assert.equal((await f.db.query('SELECT count(*)::int AS n FROM v2_idempotency_keys')).rows[0].n, 0); } finally { await close(f); } }
});

test('application admission preserves finite capacity and fails closed for malformed account data', async () => {
  for (const account of [{ registered: true, maxActiveJobs: 1n, activeJobs: 0n }, { registered: true, maxActiveJobs: 1n, activeJobs: 2n }, { registered: false, maxActiveJobs: 0n, activeJobs: 5n }]) { const f = await fixture({ account }); try { const out = await appPost(f, f.operator, `admission-${account.activeJobs}`); assert.equal(out.response.status, account.activeJobs === 0n ? 201 : 403); } finally { await close(f); } }
  for (const account of [{ maxActiveJobs: null }, { activeJobs: null }]) { const f = await fixture({ account }); try { const out = await appPost(f, f.operator, `malformed-${String(account.maxActiveJobs)}-${String(account.activeJobs)}`); assert.equal(out.response.status, 503); assert.equal(out.body.error, 'READER_UNAVAILABLE'); } finally { await close(f); } }
});

test('zero maxActiveJobs means unlimited admission even with active jobs', async () => {
  const f = await fixture({ account: { registered: true, maxActiveJobs: 0n, activeJobs: 5n } });
  try { const out = await appPost(f, f.operator, 'unlimited'); assert.equal(out.response.status, 201); assert.equal((await f.db.query('SELECT count(*)::int AS n FROM v2_applications')).rows[0].n, 1); assert.equal((await f.db.query("SELECT count(*)::int AS n FROM v2_audit_events WHERE event_type='application.created'")).rows[0].n, 1); } finally { await close(f); }
});

test('application uint fields require canonical decimal strings and reject non-canonical values without writes', async () => {
  const fields = ['jobId', 'validAfter', 'validBefore', 'nonceEpoch', 'operatorNonce'];
  const invalid = [1, true, null, [], {}, ' 1', '01', '-1', 9007199254740992, '115792089237316195423570985008687907853269984665640564039457584007913129639936', '1'.padEnd(79, '0')];
  const f = await fixture();
  try {
    const auth = await login(f, f.operator);
    for (const field of fields) for (const value of invalid) {
      const application = typedApplication(f, f.operator); application[field] = value;
      let signature = `0x${'11'.repeat(65)}`;
      try { const signed = { ...application, [field]: BigInt(value) }; signature = await f.operator.signTypedData({ domain: applicationDomain(5042002n, MARKETPLACE), types: APPLICATION_TYPES, primaryType: 'Application', message: signed }); } catch {}
      const out = await appPostApplication(f, f.operator, application, auth, `invalid-${field}-${invalid.indexOf(value)}`, 'real pitch', signature);
      assert.equal(out.response.status, 400, `${field}=${String(value)}`);
    }
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM v2_applications')).rows[0].n, 0);
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM v2_audit_events')).rows[0].n, 0);
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM v2_idempotency_keys')).rows[0].n, 0);
  } finally { await close(f); }
});

test('pinned ERC1271 verification accepts magic value and binds digest and block tag', async () => {
  let seen;
  const f = await fixture({ readSignature: async (...args) => { seen = args; return '0x1626ba7e'; } }); try { const signature = `0x${'11'.repeat(65)}`; const out = await appPost(f, f.operator, 'erc1271', 'real pitch', signature); assert.equal(out.response.status, 201); const typed = typedApplication(f, f.operator); const expectedDigest = hashApplication(typed, applicationDomain(5042002n, MARKETPLACE)); assert.deepEqual(seen, [f.operator.address.toLowerCase(), expectedDigest, signature, '0x64']); } finally { await close(f); }
});

test('ERC1271 wrong magic and reverting callbacks fail closed without writes', async () => {
  for (const readSignature of [async () => '0x00000000', async () => { throw new Error('revert'); }]) { const f = await fixture({ readSignature }); try { const out = await appPost(f, f.operator, `bad-${Math.random()}`, 'real pitch', `0x${'11'.repeat(65)}`); assert.equal(out.response.status, 400); assert.equal((await f.db.query('SELECT count(*)::int AS n FROM v2_applications')).rows[0].n, 0); } finally { await close(f); } }
});
