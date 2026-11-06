import test from 'node:test';
import assert from 'node:assert/strict';
import { createV2ReadApi } from '../lib/v2/server/api-read.mjs';
import { ARC_TESTNET_PROFILE as profile } from '../lib/v2/chain-profile.mjs';

test('job list is projection-only even when canonical RPC reader is unavailable', async () => {
  let readerCalls = 0;
  const queries = [];
  const db = { async query(sql) { queries.push(sql); return { rows: sql.includes('FROM v2_job_documents') ? [{ content: { title: 'Indexed title', secret: 'DO_NOT_EXPOSE' } }] : [{ chain_id: '5042002', marketplace: profile.marketplace, job_id: '1', reward: '1000000', status: 'open', state_version: '7', terms_hash: '0x'+'ab'.repeat(32), client: '0x'+'11'.repeat(20), operator: null, resolver: null, source_block: '100', source_hash: '0x'+'22'.repeat(32), data: { createdAt:'1', secret:'DO_NOT_EXPOSE' } }] }; } };
  const api = createV2ReadApi({ db, profile, readerFactory: () => { readerCalls++; throw new Error('RPC_UNAVAILABLE'); } });
  const response = await api(new Request('http://127.0.0.1:3102/api/v2/jobs'));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(readerCalls, 0, 'list must never initialize a canonical RPC reader');
  assert.equal(body.data.count, 1);
  assert.equal(body.data.items[0].stateVersion, '7');
  assert.equal(body.data.items[0].sourceBlock, '100');
  assert.deepEqual(body.data.items[0].document, { title: 'Indexed title' });
  assert.equal(JSON.stringify(body).includes('DO_NOT_EXPOSE'), false);
  assert.equal(queries.length, 2);
});
