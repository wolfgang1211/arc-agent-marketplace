import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { verifyMessage } from 'viem';
import { createPgliteDb, migrate } from '../lib/v2/server/db.mjs';
import { ARC_TESTNET_PROFILE } from '../lib/v2/chain-profile.mjs';
import { createV2AuthApi } from '../lib/v2/server/api-auth.mjs';
import { createV2PrivateApi } from '../lib/v2/server/api-private.mjs';
import { APPLICATION_TYPES, applicationDomain } from '../lib/v2/applications.mjs';
import { createArcApiClient, LOCAL_ARC_API_ORIGIN } from '../scripts/v2-local-arc-counterparty-helper.mjs';
import { scratchDir } from './scratch-dir.mjs';

const ORIGIN = LOCAL_ARC_API_ORIGIN;
const CHAIN_ID = ARC_TESTNET_PROFILE.canonicalChainId.toString();
const HASH = `0x${'ab'.repeat(32)}`;
const BLOCK = `0x${'cd'.repeat(32)}`;

async function fixture() {
  const dir = await mkdtemp(path.join(scratchDir(), 'v2-counterparty-integration-'));
  const db = await createPgliteDb({ dataDir: dir }); await migrate(db);
  const client = privateKeyToAccount(generatePrivateKey());
  const operator = privateKeyToAccount(generatePrivateKey());
  await db.query(`INSERT INTO v2_jobs(chain_id,marketplace,job_id,reward,status,state_version,terms_hash,client,operator,resolver,source_block,source_hash,data) VALUES($1,$2,1,$3,0,7,$4,$5,NULL,NULL,100,$6,$7)`, [CHAIN_ID, ARC_TESTNET_PROFILE.marketplace, '1000000', HASH, client.address, BLOCK, { applyBy: '4102444800' }]);
  const readerFactory = () => ({ read: async () => ({ chainId: ARC_TESTNET_PROFILE.canonicalChainId, blockTag: '0x64', blockHash: BLOCK, readJob: async () => ({ status: 0, stateVersion: 7n, canonicalTermsHash: HASH, client: client.address, operator: null, resolver: null }), readAccount: async () => ({ registered: true, maxActiveJobs: 4n, activeJobs: 0n, credits: 0n, nonceEpoch: 0n, freeStake: 1n, reservedStake: 0n, applicationNonce: async () => 0n }) }) });
  const auth = createV2AuthApi({ db, origin: ORIGIN, verifyWalletSignature: ({ wallet, message, signature }) => verifyMessage({ address: wallet, message, signature }) });
  const privateApi = createV2PrivateApi({ db, auth, readerFactory, origin: ORIGIN, getHealth: async () => ({ status: 'healthy', stale: false, gap: null }) });
  const fetchImpl = async (url, init) => {
    const request = new Request(url, init);
    const handler = new URL(url).pathname.startsWith('/api/v2/auth/') ? auth : privateApi;
    return handler(request);
  };
  return { db, dir, operator, client, api: createArcApiClient({ baseUrl: ORIGIN, fetchImpl }) };
}

test('real PGlite and actual auth/private handlers accept only an in-memory fixture application signature', async () => {
  const f = await fixture();
  try {
    const authenticated = await f.api.authenticate({ wallet: f.operator.address, chainId: CHAIN_ID, signMessage: (message) => f.operator.signMessage({ message }) });
    assert.deepEqual(authenticated, { authenticated: true });
    const application = { jobId: 1n, operator: f.operator.address, termsHash: HASH, validAfter: 0n, validBefore: 4102444800n, nonceEpoch: 0n, operatorNonce: 0n };
    const signature = await f.operator.signTypedData({ domain: applicationDomain(ARC_TESTNET_PROFILE.canonicalChainId, ARC_TESTNET_PROFILE.marketplace), types: APPLICATION_TYPES, primaryType: 'Application', message: application });
    const result = await f.api.postApplication({ jobId: '1', application, signature, pitch: 'fixture pitch' });
    assert.equal(result.application.jobId, '1');
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM v2_applications')).rows[0].n, 1);
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM v2_audit_events')).rows[0].n, 1);
  } finally { await f.db.close(); await rm(f.dir, { recursive: true, force: true }); }
});

test('API origin is pinned and cannot be redirected to another endpoint', () => {
  assert.throws(() => createArcApiClient({ baseUrl: 'http://127.0.0.1:3103', fetchImpl: async () => new Response('{}') }), /API_CLIENT_INVALID/);
});
