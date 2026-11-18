import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { keccak256, stringToHex } from 'viem';
import { createPgliteDb, migrate } from '../lib/v2/server/db.mjs';
import { createV2RevisionNotesApi } from '../lib/v2/server/revision-notes-api.mjs';
import { scratchDir } from './scratch-dir.mjs';

const ORIGIN = 'https://app.example.test';
const CHAIN = '5042002';
const MARKET = '0xfa156b7a5205b123c8a22a807ba98405e36130f1';
const CLIENT = '0x1111111111111111111111111111111111111111';
const OPERATOR = '0x2222222222222222222222222222222222222222';
const RESOLVER = '0x3333333333333333333333333333333333333333';
const OUTSIDER = '0x4444444444444444444444444444444444444444';
const SOURCE = `0x${'aa'.repeat(32)}`;
const CRITERION = 'criterion one';
const NOTE = 'fixed the issue';
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
const hash = value => keccak256(stringToHex(canonical(value)));

async function fixture({ status = 2, readerJob = {}, mutateAuth = null, readAuth = CLIENT } = {}) {
  const dir = await mkdtemp(path.join(scratchDir(), 'revision-notes-'));
  const db = await createPgliteDb({ dataDir: dir }); await migrate(db);
  await db.query(`INSERT INTO v2_jobs(chain_id,marketplace,job_id,reward,status,state_version,terms_hash,client,operator,resolver,source_block,source_hash,data) VALUES($1,$2,1,100,$3,7,$4,$5,$6,$7,100,$8,$9)`, [CHAIN, MARKET, String(status), `0x${'bb'.repeat(32)}`, CLIENT, OPERATOR, RESOLVER, SOURCE, { correctionDeadline: '1234', revisionLimit: '3', revisionsUsed: '1', unlimitedRevisions: false }]);
  const canonicalJob = { chainId: 5042002n, marketplace: MARKET, jobId: 1n, client: CLIENT, operator: OPERATOR, resolver: RESOLVER, status, stateVersion: 7n, deliveryVersion: 4n, correctionDeadline: 1234n, revisionLimit: 3n, revisionsUsed: 1n, unlimitedRevisions: false, canonicalTermsHash: `0x${'bb'.repeat(32)}`, revisionCriterionHash: hash(CRITERION), revisionReferenceHash: hash(NOTE), ...readerJob };
  const readerFactory = options => { assert.equal(options.toBlockTag, '0x64'); return { read: async () => ({ chainId: 5042002n, blockTag: '0x64', blockHash: SOURCE, readJob: async () => canonicalJob }) }; };
  const auth = { authenticateRequest: async () => ({ wallet: readAuth }), authorizeMutation: async request => { if (request.headers.get('x-v2-csrf') !== 'fixture-csrf') throw Object.assign(new Error('CSRF_INVALID'), { code: 'CSRF_INVALID' }); return { wallet: mutateAuth ?? CLIENT }; } };
  const api = createV2RevisionNotesApi({ db, auth, readerFactory, getHealth: async () => ({ status: 'healthy', stale: false, gap: null }), origin: ORIGIN });
  return { db, dir, api, readerFactory, canonicalJob };
}
async function close(f) { await f.db.close(); await rm(f.dir, { recursive: true, force: true }); }
function req(method, body, headers = {}, url = '/api/v2/jobs/1/revision-notes') { return new Request(`${ORIGIN}${url}`, { method, headers: { origin: ORIGIN, ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined }); }
async function call(f, method, body, headers = {}) { const response = await f.api(req(method, body, headers)); return { response, body: await response.json() }; }

const payload = () => ({ expectedStateVersion: '7', deliveryVersion: '4', criterionReference: CRITERION, note: NOTE });

test('revision note POST persists exact distinct hashes and returns the contract schema', async () => {
  const f = await fixture(); try {
    const out = await call(f, 'POST', payload(), { 'x-v2-csrf': 'fixture-csrf' });
    assert.equal(out.response.status, 201);
    assert.deepEqual(out.body.note, { id: out.body.note.id, jobId: '1', expectedStateVersion: '7', requestStateVersion: '8', deliveryVersion: '4', criterionReference: CRITERION, note: NOTE, criterionHash: hash(CRITERION), referenceHash: hash(NOTE) });
    assert.notEqual(out.body.note.criterionHash, out.body.note.referenceHash);
    const row = (await f.db.query("SELECT event_type,entity_type,entity_id,payload FROM v2_audit_events WHERE event_type='revision.note.created'")).rows[0];
    assert.equal(row.entity_type, 'job'); assert.equal(row.entity_id, '1'); assert.equal(row.payload.sourceHash, SOURCE); assert.equal(row.payload.requestStateVersion, '8');
  } finally { await close(f); }
});

test('GET exposes canonical context and saved note as pending, while ACL excludes outsider', async () => {
  const f = await fixture(); try {
    const posted = await call(f, 'POST', payload(), { 'x-v2-csrf': 'fixture-csrf' }); assert.equal(posted.response.status, 201);
    const out = await call(f, 'GET'); assert.equal(out.response.status, 200); assert.deepEqual(out.body.context, { jobId: '1', stateVersion: '7', deliveryVersion: '4', correctionDeadline: '1234', revisionLimit: '3', revisionsUsed: '1', unlimitedRevisions: false, status: 2, revisionCriterionHash: hash(CRITERION), revisionReferenceHash: hash(NOTE) });    assert.equal(out.body.notes[0].verification, 'pending');
    for (const party of [OPERATOR, RESOLVER]) { const partyApi = createV2RevisionNotesApi({ db: f.db, auth: { authenticateRequest: async () => ({ wallet: party }) }, readerFactory: f.readerFactory, getHealth: async () => ({ status: 'healthy', stale: false, gap: null }), origin: ORIGIN }); const partyResponse = await partyApi(req('GET')); assert.equal(partyResponse.status, 200); }
    const denied = await call({ ...f, api: createV2RevisionNotesApi({ db: f.db, auth: { authenticateRequest: async () => ({ wallet: OUTSIDER }), authorizeMutation: async () => ({ wallet: OUTSIDER }) }, readerFactory: f.readerFactory, getHealth: async () => ({ status: 'healthy', stale: false, gap: null }), origin: ORIGIN }) }, 'GET'); assert.equal(denied.response.status, 403);
  } finally { await close(f); }
});

test('version, status, origin, CSRF/auth and input binding fail closed without writes', async () => {
  for (const body of [{ ...payload(), expectedStateVersion: '6' }, { ...payload(), deliveryVersion: '3' }, { ...payload(), note: '' }, { ...payload(), criterionReference: 'x'.repeat(10001) }]) {
    const f = await fixture(); try { const out = await call(f, 'POST', body, { 'x-v2-csrf': 'fixture-csrf' }); assert.notEqual(out.response.status, 201); assert.equal((await f.db.query('SELECT count(*)::int AS n FROM v2_audit_events')).rows[0].n, 0); } finally { await close(f); }
  }
  const stale = await fixture({ status: 1 }); try { const out = await call(stale, 'POST', payload(), { 'x-v2-csrf': 'fixture-csrf' }); assert.equal(out.response.status, 409); } finally { await close(stale); }
  const f = await fixture(); try { const csrf = await call(f, 'POST', payload()); assert.equal(csrf.response.status, 403); assert.equal(csrf.body.error, 'CSRF_INVALID'); const badOrigin = await f.api(req('POST', payload(), { origin: 'https://evil.example' })); assert.equal(badOrigin.status, 403); } finally { await close(f); }
});

test('deterministic idempotency is immutable and mismatches remain readable to parties', async () => {
  const f = await fixture(); try {
    const first = await call(f, 'POST', payload(), { 'x-v2-csrf': 'fixture-csrf' }); const second = await call(f, 'POST', payload(), { 'x-v2-csrf': 'fixture-csrf' }); assert.equal(first.response.status, 201); assert.equal(second.response.status, 200); assert.deepEqual(second.body, first.body); assert.equal((await f.db.query("SELECT count(*)::int AS n FROM v2_audit_events WHERE event_type='revision.note.created'")).rows[0].n, 1);
    await f.db.query('UPDATE v2_audit_events SET payload = jsonb_set(payload, \'{criterionHash}\', to_jsonb($1::text)) WHERE event_type=\'revision.note.created\'', ['0x' + 'ff'.repeat(32)]);
    const read = await call(f, 'GET'); assert.equal(read.response.status, 200); assert.equal(read.body.notes[0].verification, 'mismatch'); assert.equal(read.body.notes[0].note, NOTE);
  } finally { await close(f); }
});

test('canonical RevisionPending with the exact request state and delivery verifies the saved note', async () => {
  const f = await fixture({ status: 3, readerJob: { stateVersion: 8n } }); try {
    await f.db.query("UPDATE v2_jobs SET state_version=8");assert.equal('requestStateVersion' in f.canonicalJob,false);
    await f.db.query("INSERT INTO v2_audit_events(id,actor_wallet,event_type,entity_type,entity_id,payload) VALUES($1,$2,$3,$4,$5,$6)", ['verified-note', CLIENT, 'revision.note.created', 'job', '1', { id: 'verified-note', chain: CHAIN, market: MARKET.toLowerCase(), job: '1', jobId: '1', canonicalTermsHash: '0x' + 'bb'.repeat(32), expectedStateVersion: '7', requestStateVersion: '8', deliveryVersion: '4', criterionReference: CRITERION, note: NOTE, criterionHash: hash(CRITERION), referenceHash: hash(NOTE), sourceHash: SOURCE }]);
    const out = await call(f, 'GET'); assert.equal(out.response.status, 200); assert.equal(out.body.notes[0].verification, 'verified');
  } finally { await close(f); }
});

test('real POST with nonzero source hash and zero on-chain revision commitments remains pending before broadcast',async()=>{
 const zero='0x'+'00'.repeat(32),f=await fixture({readerJob:{revisionCriterionHash:zero,revisionReferenceHash:zero}});try{
 const posted=await call(f,'POST',payload(),{'x-v2-csrf':'fixture-csrf'});assert.equal(posted.response.status,201);
 const row=(await f.db.query('SELECT payload FROM v2_audit_events WHERE id=$1',[posted.body.note.id])).rows[0];assert.equal(row.payload.sourceHash,SOURCE);
 const out=await call(f,'GET');assert.equal(out.response.status,200);assert.equal(out.body.notes[0].verification,'pending');
 }finally{await close(f);}
});

test('GET filters audit rows by canonical chain, market and job identity', async () => {
  const f = await fixture(); try {
    await f.db.query("INSERT INTO v2_audit_events(id,actor_wallet,event_type,entity_type,entity_id,payload) VALUES($1,$2,$3,$4,$5,$6)", ['foreign-note', CLIENT, 'revision.note.created', 'job', '1', { id: 'foreign-note', chain: CHAIN, market: '0x' + '99'.repeat(20), job: '1', jobId: '1', expectedStateVersion: '7', requestStateVersion: '8', deliveryVersion: '4', criterionReference: CRITERION, note: 'foreign', criterionHash: hash(CRITERION), referenceHash: hash('foreign'), sourceHash: SOURCE }]);
    const out = await call(f, 'GET'); assert.equal(out.response.status, 200); assert.equal(out.body.notes.length, 0);
  } finally { await close(f); }
});

test('tampered persisted note text is a mismatch while the original content remains readable', async () => {
  const f = await fixture(); try {
    const posted = await call(f, 'POST', payload(), { 'x-v2-csrf': 'fixture-csrf' }); assert.equal(posted.response.status, 201);
    await f.db.query("UPDATE v2_audit_events SET payload = jsonb_set(payload, '{note}', to_jsonb($1::text)) WHERE id=$2", ['tampered persisted text', posted.body.note.id]);
    const out = await call(f, 'GET'); assert.equal(out.response.status, 200); assert.equal(out.body.notes[0].verification, 'mismatch'); assert.equal(out.body.notes[0].note, 'tampered persisted text');
  } finally { await close(f); }
});

test('missing required canonical boolean is unavailable, never defaulted to false', async () => {
  const f = await fixture({ readerJob: { unlimitedRevisions: undefined } }); try {
    const out = await call(f, 'GET'); assert.equal(out.response.status, 503); assert.equal(out.body.error, 'STALE_DATA');
  } finally { await close(f); }
});

test('health is checked before and after the canonical reader snapshot', async () => {
  const f = await fixture(); let calls = 0; try {
    const api = createV2RevisionNotesApi({ db: f.db, auth: { authenticateRequest: async () => ({ wallet: CLIENT }) }, readerFactory: f.readerFactory, getHealth: async () => (++calls === 1 ? { status: 'healthy', stale: false, gap: null } : { status: 'healthy', stale: true, gap: null }), origin: ORIGIN });
    const response = await api(req('GET')); assert.equal(response.status, 503); assert.equal((await response.json()).error, 'STALE_DATA'); assert.equal(calls, 2);
  } finally { await close(f); }
});
