import assert from 'node:assert/strict';
import test from 'node:test';
import { createV2ReadApi, MARKETPLACE } from '../lib/v2/server/api-read.mjs';

const client = '0x0000000000000000000000000000000000000011';
const operator = '0x0000000000000000000000000000000000000012';
const resolver = '0x0000000000000000000000000000000000000013';
const blockTimestamp = 1_800_000_000n;
const hash = `0x${'aa'.repeat(32)}`;

function row(status = 'inprogress') {
  return { chain_id: '5042002', marketplace: MARKETPLACE, job_id: '1', reward: '1000', status, state_version: '7', terms_hash: hash, client, operator, resolver, source_block: '100', source_hash: hash, data: { applyBy: '1799999900', deliveryDeadline: '1800000000' } };
}
function dbFor(jobRow, document = null) {
  return { query: async (sql) => {
    if (sql.includes('FROM v2_jobs')) return { rows: [jobRow] };
    if (sql.includes('FROM v2_job_documents')) return { rows: document ? [{ content: document, visibility: 'public' }] : [] };
    throw new Error(`unexpected query: ${sql}`);
  } };
}
function readerFor(job, mutual) {
  return () => ({ read: async () => ({ blockTimestamp, readJob: async () => job, readMutual: async () => mutual }) });
}
async function get(api, path) {
  const response = await api(new Request(`https://local.test${path}`));
  return { response, body: await response.json() };
}

test('actual numeric reader enum statuses produce canonical action context', async () => {
  for (const status of [0, 1, 2, 3, 4, 5]) {
    const canonical = { status, stateVersion: 7n, client, operator, resolver, applyBy: blockTimestamp + 100n, deliveryDeadline: blockTimestamp + 100n, reviewDeadline: blockTimestamp + 100n, repairDeadline: blockTimestamp + 100n, episodeStart: blockTimestamp - 1n, lastAdminActionAt: blockTimestamp - 1n, disputeTimeUsed: 0n };
    const api = createV2ReadApi({ db: dbFor(row()), readerFactory: readerFor(canonical, { active: false, version: 0n }) });
    const { body } = await get(api, '/api/v2/jobs/1');
    assert.equal(body.data.mutual?.proposable, true, `numeric status ${status}`);
    assert.deepEqual(body.data.timeout, { openJobClaimable: false, deliveryClaimable: false });
  }
});

test('invalid numeric enum evidence cannot advertise action context', async () => {
  for (const status of [-1, 1.5, NaN, Infinity, 9, Number.MAX_SAFE_INTEGER]) {
    const api = createV2ReadApi({ db: dbFor(row()), readerFactory: readerFor({ status, stateVersion: 7n }, { active: false, version: 0n }) });
    const { body } = await get(api, '/api/v2/jobs/1');
    assert.equal(Object.hasOwn(body.data, 'mutual'), false);
    assert.equal(Object.hasOwn(body.data, 'timeout'), false);
  }
});

test('detail exposes only a canonical, current mutual request and timeout context', async () => {
  const canonical = { status: 1n, stateVersion: 7n, client, operator, resolver, deliveryDeadline: blockTimestamp + 100n, deadlineFailureClaimed: false };
  const mutual = { active: true, version: 4n, jobStateVersion: 7n, proposer: client, expiry: blockTimestamp + 100n };
  const api = createV2ReadApi({ db: dbFor(row(), { title: 'Public title', category: 'games', tags: ['web3'] }), readerFactory: readerFor(canonical, mutual) });
  const { response, body } = await get(api, '/api/v2/jobs/1');
  assert.equal(response.status, 200);
  assert.deepEqual(body.data.document, { title: 'Public title', category: 'games', tags: ['web3'] });
  assert.deepEqual(body.data.mutual, { proposable: true, active: true, version: '4', jobStateVersion: '7', proposer: client, expiry: (blockTimestamp + 100n).toString() });
  assert.deepEqual(body.data.timeout, { openJobClaimable: false, deliveryClaimable: false });
});

test('expired, stale, or malformed mutual evidence is not exposed as an actionable request', async () => {
  const canonical = { status: 2n, stateVersion: 8n, client, operator, reviewDeadline: blockTimestamp + 100n };
  const mutual = { active: true, version: 4n, jobStateVersion: 7n, proposer: client, expiry: blockTimestamp - 1n };
  const api = createV2ReadApi({ db: dbFor(row('submitted')), readerFactory: readerFor(canonical, mutual) });
  const { body } = await get(api, '/api/v2/jobs/1');
  assert.deepEqual(body.data.mutual, { proposable: true });
  assert.deepEqual(body.data.timeout, { openJobClaimable: false, deliveryClaimable: false });
});

test('list maps bounded public document metadata without private document leakage', async () => {
  const document = { title: 'Card title', summary: 'Short', category: 'automation', tags: ['a', 'b'], description: 'bounded' };
  const canonical = { status: 0n, stateVersion: 7n, client, applyBy: blockTimestamp - 1n };
  const api = createV2ReadApi({ db: dbFor(row('open'), document), readerFactory: readerFor(canonical, { active: false, version: 0n }) });
  const { body } = await get(api, '/api/v2/jobs');
  assert.deepEqual(body.data.items[0].document, document);
  assert.equal(JSON.stringify(body).includes('private'), false);
  assert.deepEqual(body.data.items[0].timeout, { openJobClaimable: true, deliveryClaimable: false });
});
