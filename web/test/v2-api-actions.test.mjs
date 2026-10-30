import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import test from 'node:test';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { keccak256, stringToHex, decodeFunctionData, verifyMessage } from 'viem';
import { createPgliteDb, migrate } from '../lib/v2/server/db.mjs';
import { createV2AuthApi } from '../lib/v2/server/api-auth.mjs';
import { createV2ActionsApi } from '../lib/v2/server/api-actions.mjs';
import { expectedState } from '../lib/v2/server/api-read.mjs';
import { sameExpected } from '../lib/v2/new-wallet-execution.mjs';
import { createV2Api } from '../lib/v2/server/api-runtime.mjs';
import { V2_TERMS_SCHEMA, canonicalTermsHash } from '../lib/v2/terms.mjs';
import manifest from '../lib/v2/action-manifest.json' with { type: 'json' };
import runtimeProof from '../lib/v2/runtime-abi-proof.json' with { type: 'json' };
import { scratchDir } from './scratch-dir.mjs';

const ORIGIN = 'https://app.example.test';
const MARKETPLACE = manifest.contracts.marketplace.address;
const HASH = (value) => keccak256(stringToHex(JSON.stringify(value)));
const address = (byte) => `0x${byte.repeat(40)}`;
const scratch = scratchDir();

async function fixture() {
  const dir = await mkdtemp(path.join(scratch, 'v2-api-actions-'));
  const db = await createPgliteDb({ dataDir: dir });
  await migrate(db);
  let now = 1_800_000_000_000;
  const client = privateKeyToAccount(generatePrivateKey());
  const auth = createV2AuthApi({ db, origin: ORIGIN, now: () => now, verifyWalletSignature: ({ wallet, message, signature }) => verifyMessage({ address: wallet, message, signature }) });
  const token = address('3'); const vault = address('4'); const treasury = address('5'); const resolver = address('6');
  const readerFactory = () => ({ read: async () => ({
    chainId: 5042002n, blockTag: '0x64', blockHash: `0x${'aa'.repeat(32)}`,
    getters: { usdc: token, collateralVault: vault, feeBps: 250n, treasury, minReward: 100n },
    readClientPolicy: async () => ({ resolvedResolver: resolver }),
  }) });
  const api = createV2ActionsApi({ db, auth, readerFactory, origin: ORIGIN, now: () => now, getHealth: async () => ({ status: 'healthy', stale: false, gap: null }) });
  return { db, dir, api, auth, client, token, vault, treasury, resolver, now: () => now };
}
function request(f, path, init = {}) { return new Request(`${ORIGIN}${path}`, { ...init, headers: { origin: ORIGIN, ...(init.headers ?? {}) } }); }
async function call(f, path, init) { const response = await f.api(request(f, path, init)); return { response, body: await response.json() }; }
async function login(f) {
  const challenge = await f.auth(request(f, '/api/v2/auth/challenge', jsonInit({ wallet: f.client.address, chainId: '5042002' })));
  const c = await challenge.json();
  const signature = await f.client.signMessage({ message: c.message });
  const verified = await f.auth(request(f, '/api/v2/auth/verify', jsonInit({ challengeId: c.challengeId, wallet: f.client.address, chainId: '5042002', signature })));
  const body = await verified.json();
  return { cookie: verified.headers.get('set-cookie'), csrf: body.csrf };
}

function terms(f, document) {
  return { token: f.token, vault: f.vault, resolver: f.resolver, reward: '1000', feeBps: '250', treasury: f.treasury, minReward: '100', deliveryDuration: '60', reviewDuration: '60', revisionDuration: '60', maxExtensionTotal: '15552000', stakeFloor: '5000000', stakeRound: '10000', collateralBps: '1000', schema: V2_TERMS_SCHEMA, revisionLimit: '2', unlimitedRevisions: false, applyBy: '1800000060', criteriaHash: HASH(document.criteria), descriptionHash: HASH(document.description), testJob: false };
}
function normalizedRuntimeBytecode(bytecode, immutableReferences) {
  assert.match(bytecode, /^0x(?:[0-9a-f]{2})+$/i);
  const bytes = Buffer.from(bytecode.slice(2), 'hex');
  for (const references of Object.values(immutableReferences)) {
    for (const { start, length } of references) {
      assert.ok(Number.isInteger(start) && Number.isInteger(length) && start >= 0 && length > 0 && start + length <= bytes.length);
      bytes.fill(0, start, start + length);
    }
  }
  return `0x${bytes.toString('hex')}`;
}
function jsonInit(body, headers = {}) { return { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }; }

test('PGlite draft HTTP flow encodes canonical postJob ABI and replays idempotently', async () => {
  const f = await fixture();
  try {
    const auth = f.auth; const session = await login(f);
    f.api = createV2ActionsApi({ db: f.db, auth, readerFactory: () => ({ read: async () => ({ chainId: 5042002n, blockTag: '0x64', blockHash: `0x${'aa'.repeat(32)}`, getters: { usdc: f.token, collateralVault: f.vault, feeBps: 250n, treasury: f.treasury, minReward: 100n }, readClientPolicy: async () => ({ resolvedResolver: f.resolver }) }) }), origin: ORIGIN, now: f.now, getHealth: async () => ({ status: 'healthy', stale: false, gap: null }) });
    const document = { title: 'bounded job', description: 'do work', criteria: { tests: ['pass'] } };
    const body = { terms: terms(f, document), document, public: false };
    const first = await call(f, '/api/v2/jobs', jsonInit(body, { 'idempotency-key': 'draft-1', cookie: session.cookie, 'x-v2-csrf': session.csrf }));
    assert.equal(first.response.status, 201);
    const decoded = decodeFunctionData({ abi: manifest.contracts.marketplace.abi, data: first.body.transaction.data });
    assert.equal(decoded.functionName, 'postJob');
    assert.equal(decoded.args[0], 1000n); assert.equal(decoded.args[5], 2); assert.equal(decoded.args[6], false);
    assert.equal(first.body.termsHash, canonicalTermsHash(Object.fromEntries(Object.entries(body.terms).map(([k, v]) => ['reward','feeBps','minReward','deliveryDuration','reviewDuration','revisionDuration','maxExtensionTotal','stakeFloor','stakeRound','collateralBps','revisionLimit','applyBy'].includes(k) ? [k, BigInt(v)] : [k, v]))));
    const replay = await call(f, '/api/v2/jobs', jsonInit(body, { 'idempotency-key': 'draft-1', cookie: session.cookie, 'x-v2-csrf': session.csrf }));
    assert.equal(replay.response.status, 200); assert.deepEqual(replay.body, first.body);
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM v2_audit_events')).rows[0].n, 1);
  } finally { await f.db.close(); await rm(f.dir, { recursive: true, force: true }); }
});

test('draft rejects browser policy/hash forgery before any PGlite audit write', async () => {
  const f = await fixture();
  try {
    const auth = { authorizeMutation: async () => ({ wallet: f.client.address }), authenticateRequest: async () => ({ session: { wallet: address('9') } }) };
    f.api = createV2ActionsApi({ db: f.db, auth, readerFactory: () => ({ read: async () => ({ chainId: 5042002n, blockTag: '0x64', blockHash: `0x${'aa'.repeat(32)}`, getters: { usdc: f.token, collateralVault: f.vault, feeBps: 250n, treasury: f.treasury, minReward: 100n }, readClientPolicy: async () => ({ resolvedResolver: f.resolver }) }) }), origin: ORIGIN, now: f.now, getHealth: async () => ({ status: 'healthy', stale: false, gap: null }) });
    const document = { description: 'do work', criteria: { tests: ['pass'] } }; const bad = terms(f, document); bad.feeBps = '999';
    const rejected = await call(f, '/api/v2/jobs', jsonInit({ terms: bad, document }, { 'idempotency-key': 'bad' }));
    assert.equal(rejected.body.error, 'INVALID_TERMS');
    assert.equal((await f.db.query('SELECT count(*)::int AS n FROM v2_audit_events')).rows[0].n, 0);
  } finally { await f.db.close(); await rm(f.dir, { recursive: true, force: true }); }
});

test('account preflight exposes only canonical account actions with reader-backed gates', async () => {
  const f = await fixture();
  try {
    const account = { registered: false, maxActiveJobs: '2', activeJobs: '0', credits: '9', nonceEpoch: '0', freeStake: '100', reservedStake: '0', stakeLiability: '100', tokenBalance: '1000', creditsLiability: '9', applicationNonce: async () => 0n };
    const auth = { authorizeMutation: async () => ({ wallet: f.client.address }) };
    f.api = createV2ActionsApi({ db: f.db, auth, readerFactory: () => ({ read: async () => ({ chainId: 5042002n, readAccount: async () => account, getters: {} }) }), origin: ORIGIN, getHealth: async () => ({ status: 'healthy', stale: false, gap: null }) });
    for (const [action, params, name] of [['registerOperator', {}, 'registerOperator'], ['depositStake', { amount: '7' }, 'depositStake'], ['withdrawStake', { amount: '40' }, 'withdrawStake'], ['withdrawCredit', {}, 'withdrawCredit']]) {
      const out = await call(f, '/api/v2/accounts/preflight', jsonInit({ action, params }));
      assert.equal(out.response.status, 200); assert.equal(decodeFunctionData({ abi: action === 'depositStake' || action === 'withdrawStake' ? manifest.contracts.vault.abi : manifest.contracts.marketplace.abi, data: out.body.transaction.data }).functionName, name);
      if (action === 'depositStake') {
        assert.equal(out.body.allowance.requiredAmount, '7');
        assert.equal(out.body.allowance.token.toLowerCase(), '0x3600000000000000000000000000000000000000');
        assert.equal(out.body.allowance.spender.toLowerCase(), '0xd5b271b7bf4696d662b2bcb1a94b408887c6c423');
        assert.equal(out.body.expected.freeStake, '107');
        assert.equal(out.body.expected.stakeLiabilityDelta, '7');
        const stored = await f.db.query("SELECT payload FROM v2_audit_events WHERE entity_id=$1", [out.body.intentId]);
        assert.deepEqual(stored.rows[0].payload.snapshot.balances, { freeStake: '100', reservedStake: '0', credits: '9', stakeLiability: '100', tokenBalance: '1000', creditsLiability: '9' });
      }
      if (action === 'withdrawStake') {
        assert.equal(out.body.expected.freeStake, '60');
        assert.equal(out.body.expected.stakeLiabilityDelta, '-40');
        assert.equal(out.body.expected.walletTokenIncrease, '40');
        assert.equal(out.body.allowance, undefined);
      }
    }
    const overdraw = await call(f, '/api/v2/accounts/preflight', jsonInit({ action: 'withdrawStake', params: { amount: '101' } }));
    assert.equal(overdraw.response.status, 403);
    const rejected = await call(f, '/api/v2/accounts/preflight', jsonInit({ action: 'approve', params: {} }));
    assert.equal(rejected.response.status, 409); assert.equal(rejected.body.error, 'UNSUPPORTED_ACTION');
  } finally { await f.db.close(); await rm(f.dir, { recursive: true, force: true }); }
});

test('advertised action manifest is complete and selected by immutable full signature', () => {
  const expected = ['postJob','awardJob','submitDelivery','submitRevision','approve','requestRevision','openDispute','resolveDispute','proposeMutual','acceptMutual','rejectMutual','revokeMutual','claimOpenJobTimeout','claimDeliveryTimeout','withdrawCredit','registerOperator','depositStake','withdrawStake'];
  const actual = [...manifest.contracts.marketplace.abi, ...manifest.contracts.vault.abi].map((item) => item.name);
  assert.deepEqual(new Set(actual), new Set(expected));
  assert.equal(actual.length, expected.length);
  for (const name of expected) assert.equal(actual.filter((item) => item === name).length, 1);
});

test('runs50 manifest pins portable runtime witnesses and the six-argument resolver selector', () => {
  for (const key of ['marketplace', 'vault']) {
    const witness = runtimeProof.contracts[key];
    const pin = manifest.provenance.contracts[key];
    const runtime = Buffer.from(witness.compiledRuntimeBytecode.slice(2), 'hex');
    const normalized = normalizedRuntimeBytecode(witness.compiledRuntimeBytecode, witness.immutableReferences);
    assert.equal(createHash('sha256').update(runtime).digest('hex'), pin.runtimeSha256);
    assert.equal(runtime.length, pin.runtimeBytes);
    assert.deepEqual(witness.immutableReferences, pin.immutableReferences);
    assert.equal(normalized, witness.normalizedRuntimeBytecode);
    assert.equal(keccak256(normalized), witness.normalizedRuntimeKeccak256);
    assert.equal(witness.runtimeBytes, pin.runtimeBytes);
    for (const advertised of manifest.contracts[key].abi) {
      if (!witness.abi.some((candidate) => JSON.stringify(candidate) === JSON.stringify(advertised))) continue;
      assert.ok(witness.abi.some((candidate) => JSON.stringify(candidate) === JSON.stringify(advertised)), `${key} ABI missing ${advertised.name ?? advertised.type}`);
    }
  }
  const six = keccak256(stringToHex('resolveDispute(uint256,uint256,bool,bytes32,bytes32,uint256)')).slice(0, 10);
  const five = keccak256(stringToHex('resolveDispute(uint256,uint256,bytes32,bytes32,uint256)')).slice(0, 10);
  assert.notEqual(six, five);
  const item = manifest.contracts.marketplace.abi.find((x) => x.name === 'resolveDispute');
  assert.deepEqual(item.inputs.map((x) => x.type), ['uint256', 'uint256', 'bool', 'bytes32', 'bytes32', 'uint256']);
});
test('runtime HTTP/PGlite preflights every advertised job action with pinned reader and real sessions', async () => {
  const f = await fixture();
  try {
    const operator = privateKeyToAccount(generatePrivateKey()); const resolver = privateKeyToAccount(generatePrivateKey());
    const baseAuth = createV2AuthApi({ db: f.db, origin: ORIGIN, now: () => 1_800_000_000_000, verifyWalletSignature: ({ wallet, message, signature }) => verifyMessage({ address: wallet, message, signature }) });
    async function session(account) { const ch = await baseAuth(request(f, '/api/v2/auth/challenge', jsonInit({ wallet: account.address, chainId: '5042002' }))); const c = await ch.json(); const sig = await account.signMessage({ message: c.message }); const v = await baseAuth(request(f, '/api/v2/auth/verify', jsonInit({ challengeId: c.challengeId, wallet: account.address, chainId: '5042002', signature: sig }))); return { cookie: v.headers.get('set-cookie'), csrf: (await v.json()).csrf }; }
    const clientSession = await session(f.client); const operatorSession = await session(operator); const resolverSession = await session(resolver); const termsHash = `0x${'11'.repeat(32)}`; const sourceHash = `0x${'aa'.repeat(32)}`;
    await f.db.query('INSERT INTO v2_jobs(chain_id,marketplace,job_id,reward,status,state_version,terms_hash,client,operator,resolver,source_block,source_hash,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)', ['5042002', MARKETPLACE, '1', '1000', 'open', 7, termsHash, f.client.address, operator.address, resolver.address, '100', sourceHash, {}]);
    let status = 0; const account = { registered: true, maxActiveJobs: '2', activeJobs: '0', credits: '9', nonceEpoch: '0', freeStake: '5000000', reservedStake: '0', applicationNonce: async () => 0n };
    const readerFactory = () => ({ read: async () => ({ chainId: 5042002n, blockTag: '0x64', blockHash: sourceHash, getters: { usdc: f.token, collateralVault: f.vault, feeBps: 250n, treasury: f.treasury, minReward: 100n }, readJob: async () => ({ status, stateVersion: 7n, canonicalTermsHash: termsHash, client: f.client.address, operator: operator.address, resolver: resolver.address, reward: 1000n, applyBy: 1800000060n }), readAccount: async () => account, readClientPolicy: async () => ({ resolvedResolver: f.resolver }) }) });
    const api = createV2Api({ db: f.db, origin: ORIGIN, readerFactory, verifyWalletSignature: ({ wallet, message, signature }) => verifyMessage({ address: wallet, message, signature }), getHealth: async () => ({ status: 'healthy', stale: false, gap: null }), now: () => 1_800_000_000_000 });
    const callRuntime = async (s, body) => { const r = await api.handle(request(f, '/api/v2/jobs/1/preflight', jsonInit(body, { cookie: s.cookie, 'x-v2-csrf': s.csrf }))); return { response: r, body: await r.json() }; };
    const application = { jobId: '1', operator: operator.address, termsHash, validAfter: '1799999990', validBefore: '1800000050', nonceEpoch: '0', operatorNonce: '0' };
    const signature = await operator.signTypedData({ domain: { name: 'AlphaBoard Agent Marketplace V2', version: '1', chainId: 5042002n, verifyingContract: MARKETPLACE }, types: { Application: [{ name: 'jobId', type: 'uint256' }, { name: 'operator', type: 'address' }, { name: 'termsHash', type: 'bytes32' }, { name: 'validAfter', type: 'uint64' }, { name: 'validBefore', type: 'uint64' }, { name: 'nonceEpoch', type: 'uint256' }, { name: 'operatorNonce', type: 'uint256' }] }, primaryType: 'Application', message: { jobId: 1n, operator: operator.address, termsHash, validAfter: 1799999990n, validBefore: 1800000050n, nonceEpoch: 0n, operatorNonce: 0n } });
    const award = await callRuntime(clientSession, { action: 'awardJob', params: {}, application, signature }); assert.equal(award.response.status, 200); assert.equal(decodeFunctionData({ abi: manifest.contracts.marketplace.abi, data: award.body.transaction.data }).functionName, 'awardJob');
    status = 1; await f.db.query('UPDATE v2_jobs SET status=$1 WHERE job_id=$2', ['inprogress', '1']); const delivery = await callRuntime(operatorSession, { action: 'submitDelivery', params: { blobHash: `0x${'22'.repeat(32)}`, expected: '7' } }); assert.equal(delivery.response.status, 200); assert.equal(decodeFunctionData({ abi: manifest.contracts.marketplace.abi, data: delivery.body.transaction.data }).functionName, 'submitDelivery');
    status = 2; await f.db.query('UPDATE v2_jobs SET status=$1 WHERE job_id=$2', ['submitted', '1']); for (const [action, params] of [['approve', { expected: '7' }], ['requestRevision', { criterionHash: `0x${'33'.repeat(32)}`, referenceHash: `0x${'44'.repeat(32)}`, expected: '7' }]]) { const out = await callRuntime(clientSession, { action, params }); assert.equal(out.response.status, 200); assert.equal(decodeFunctionData({ abi: manifest.contracts.marketplace.abi, data: out.body.transaction.data }).functionName, action); }
    const dispute = await callRuntime(clientSession, { action: 'openDispute', params: { expected: '7' } }); assert.equal(dispute.response.status, 200); assert.equal(decodeFunctionData({ abi: manifest.contracts.marketplace.abi, data: dispute.body.transaction.data }).functionName, 'openDispute');
    status = 5; await f.db.query('UPDATE v2_jobs SET status=$1 WHERE job_id=$2', ['disputed', '1']); const resolved = await callRuntime(resolverSession, { action: 'resolveDispute', params: { grossPayout: '0', operatorFault: false, reasonHash: `0x${'55'.repeat(32)}`, evidenceHash: `0x${'66'.repeat(32)}`, expected: '7' } }); assert.equal(resolved.response.status, 200); const resolvedDecoded = decodeFunctionData({ abi: manifest.contracts.marketplace.abi, data: resolved.body.transaction.data }); assert.equal(resolvedDecoded.functionName, 'resolveDispute'); assert.equal(resolvedDecoded.args[2], false);
    const resolvedTrue = await callRuntime(resolverSession, { action: 'resolveDispute', params: { grossPayout: '1000', operatorFault: true, reasonHash: `0x${'55'.repeat(32)}`, evidenceHash: `0x${'66'.repeat(32)}`, expected: '7' } }); assert.equal(resolvedTrue.response.status, 200); assert.equal(decodeFunctionData({ abi: manifest.contracts.marketplace.abi, data: resolvedTrue.body.transaction.data }).args[2], true);
    const missingFault = await callRuntime(resolverSession, { action: 'resolveDispute', params: { grossPayout: '0', reasonHash: `0x${'55'.repeat(32)}`, evidenceHash: `0x${'66'.repeat(32)}`, expected: '7' } }); assert.equal(missingFault.response.status, 400);
    const nonBooleanFault = await callRuntime(resolverSession, { action: 'resolveDispute', params: { grossPayout: '0', operatorFault: 'false', reasonHash: `0x${'55'.repeat(32)}`, evidenceHash: `0x${'66'.repeat(32)}`, expected: '7' } }); assert.equal(nonBooleanFault.response.status, 400);
    const wrongRole = await callRuntime(operatorSession, { action: 'submitDelivery', params: { blobHash: `0x${'22'.repeat(32)}`, expected: '7' } }); assert.equal(wrongRole.response.status, 403);
    status = 1; await f.db.query('UPDATE v2_jobs SET status=$1 WHERE job_id=$2', ['inprogress', '1']); const badExpected = await callRuntime(operatorSession, { action: 'submitDelivery', params: { blobHash: `0x${'22'.repeat(32)}`, expected: 'not-a-number' } }); assert.equal(badExpected.response.status, 400);
    account.freeStake = '0'; status = 0; await f.db.query('UPDATE v2_jobs SET status=$1 WHERE job_id=$2', ['open', '1']); const lowStake = await callRuntime(clientSession, { action: 'awardJob', params: {}, application, signature }); assert.equal(lowStake.response.status, 403);
  } finally { await f.db.close(); await rm(f.dir, { recursive: true, force: true }); }
});

test('authenticated draft-context returns exact pinned reader-owned policy and rejects anonymous or cross-site reads', async () => {
  const f = await fixture();
  try {
    const session = await login(f);
    const get = (headers = {}) => f.api(request(f, '/api/v2/draft-context', { method: 'GET', headers: { cookie: session.cookie, ...headers } }));
    const ok = await get(); const body = await ok.json();
    assert.equal(ok.status, 200);
    assert.deepEqual(Object.keys(body.policy).sort(), ['collateralBps','feeBps','maxExtensionTotal','minReward','resolver','schema','stakeFloor','stakeRound','token','treasury','vault'].sort());
    assert.equal(body.policy.token, f.token); assert.equal(body.policy.vault, f.vault); assert.equal(body.policy.treasury, f.treasury); assert.equal(body.policy.resolver, f.resolver);
    assert.deepEqual(body.source, { chainId: '5042002', marketplace: MARKETPLACE, blockTag: '0x64', blockHash: `0x${'aa'.repeat(32)}` }); assert.equal(body.client, f.client.address);
    const anonymous = await f.api(request(f, '/api/v2/draft-context', { method: 'GET' })); assert.equal(anonymous.status, 401);
    const crossSite = await get({ 'sec-fetch-site': 'cross-site' }); assert.equal(crossSite.status, 403);
    f.api = createV2ActionsApi({ db: f.db, auth: f.auth, readerFactory: () => ({ read: async () => { throw new Error('must not read'); } }), origin: ORIGIN, getHealth: async () => ({ status: 'stale', stale: true, gap: null }) });
    const stale = await f.api(request(f, '/api/v2/draft-context', { method: 'GET', headers: { cookie: session.cookie } })); assert.equal(stale.status, 503);
  } finally { await f.db.close(); await rm(f.dir, { recursive: true, force: true }); }
});

test('pinned mutual payout and timeout deadlines match the contract outcome', async () => {
  const f = await fixture();
  try {
    const operator = privateKeyToAccount(generatePrivateKey());
    const outsider = privateKeyToAccount(generatePrivateKey());
    const resolver = privateKeyToAccount(generatePrivateKey());
    const nowMs = 1_800_000_000_000;
    const baseAuth = createV2AuthApi({ db: f.db, origin: ORIGIN, now: () => nowMs, verifyWalletSignature: ({ wallet, message, signature }) => verifyMessage({ address: wallet, message, signature }) });
    async function session(account) {
      const ch = await baseAuth(request(f, '/api/v2/auth/challenge', jsonInit({ wallet: account.address, chainId: '5042002' })));
      const c = await ch.json();
      const sig = await account.signMessage({ message: c.message });
      const v = await baseAuth(request(f, '/api/v2/auth/verify', jsonInit({ challengeId: c.challengeId, wallet: account.address, chainId: '5042002', signature: sig })));
      return { cookie: v.headers.get('set-cookie'), csrf: (await v.json()).csrf };
    }
    const clientSession = await session(f.client);
    const operatorSession = await session(operator);
    const outsiderSession = await session(outsider);
    const termsHash = `0x${'11'.repeat(32)}`;
    const sourceHash = `0x${'aa'.repeat(32)}`;
    const blockTimestamp = 1_800_000_000n;
    await f.db.query('INSERT INTO v2_jobs(chain_id,marketplace,job_id,reward,status,state_version,terms_hash,client,operator,resolver,source_block,source_hash,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)', ['5042002', MARKETPLACE, '1', '1000', 'submitted', 7, termsHash, f.client.address, operator.address, resolver.address, '100', sourceHash, {}]);
    const job = { status: 2, stateVersion: 7n, canonicalTermsHash: termsHash, client: f.client.address, operator: operator.address, resolver: resolver.address, reward: 1000n, applyBy: blockTimestamp + 100n, deliveryDeadline: blockTimestamp + 50n, reviewDeadline: blockTimestamp + 80n, repairDeadline: blockTimestamp + 80n, episodeStart: blockTimestamp - 10n, disputeTimeUsed: 0n, lastAdminActionAt: blockTimestamp - 10n, deadlineFailureClaimed: false, faultReviewPending: false };
    let mutual = { version: 1n, jobStateVersion: 7n, refund: 1000n, grossPayout: 0n, expiry: blockTimestamp + 100n, proposer: f.client.address, active: true };
    const readerFactory = () => ({ read: async () => ({ chainId: 5042002n, blockTag: '0x64', blockHash: sourceHash, blockTimestamp, getters: { usdc: f.token, collateralVault: f.vault, feeBps: 250n, treasury: f.treasury, minReward: 100n }, readJob: async () => job, readMutual: async () => mutual, readAccount: async () => ({ registered: true, maxActiveJobs: 2n, activeJobs: 0n, credits: 0n, nonceEpoch: 0n, freeStake: 0n, reservedStake: 0n, applicationNonce: async () => 0n }), readClientPolicy: async () => ({ resolvedResolver: f.resolver }) }) });
    const api = createV2Api({ db: f.db, origin: ORIGIN, readerFactory, verifyWalletSignature: ({ wallet, message, signature }) => verifyMessage({ address: wallet, message, signature }), getHealth: async () => ({ status: 'healthy', stale: false, gap: null }), now: () => nowMs });
    const call = async (s, body) => { const r = await api.handle(request(f, '/api/v2/jobs/1/preflight', jsonInit(body, { cookie: s.cookie, 'x-v2-csrf': s.csrf }))); return { response: r, body: await r.json() }; };
    const refunded = await call(operatorSession, { action: 'acceptMutual', params: { expected: '7', expectedRequestVersion: '1' } });
    assert.equal(refunded.response.status, 200, JSON.stringify(refunded.body));
    assert.equal(refunded.body.expected.status, 7);
    mutual = { ...mutual, refund: 400n, grossPayout: 600n };
    const paid = await call(operatorSession, { action: 'acceptMutual', params: { expected: '7', expectedRequestVersion: '1' } });
    assert.equal(paid.response.status, 200, JSON.stringify(paid.body));
    assert.equal(paid.body.expected.status, 6);
    const proposer = await call(clientSession, { action: 'acceptMutual', params: { expected: '7', expectedRequestVersion: '1' } });
    assert.equal(proposer.response.status, 403);
    const wrongVersion = await call(operatorSession, { action: 'acceptMutual', params: { expected: '7', expectedRequestVersion: '9' } });
    assert.equal(wrongVersion.body.error, 'STALE_DATA');
    const wrongState = await call(operatorSession, { action: 'acceptMutual', params: { expected: '8', expectedRequestVersion: '1' } });
    assert.equal(wrongState.body.error, 'STALE_DATA');
    job.status = 1; await f.db.query('UPDATE v2_jobs SET status=$1 WHERE job_id=$2', ['inprogress', '1']);
    job.deliveryDeadline = blockTimestamp + 1n;
    const early = await call(outsiderSession, { action: 'claimDeliveryTimeout', params: { expected: '7' } });
    assert.equal(early.response.status, 409, JSON.stringify(early.body));
    job.deliveryDeadline = blockTimestamp;
    const boundary = await call(outsiderSession, { action: 'claimDeliveryTimeout', params: { expected: '7' } });
    assert.equal(boundary.response.status, 200, JSON.stringify(boundary.body));
    assert.equal(boundary.body.expected.status, 7);
    assert.equal(boundary.body.expected.deadlineFailureClaimed, true);
    assert.equal(boundary.body.expected.faultReviewPending, true);
    const deadline = blockTimestamp + 7n * 86400n;
    const readback = expectedState({ expected: boundary.body.expected }, { ...job, jobId: '1', status: 7, stateVersion: 8n, deadlineFailureClaimed: true, faultReviewPending: true, faultReviewDeadline: deadline }, { blockTimestamp });
    assert.equal(sameExpected(readback, boundary.body.expected), true);
    assert.equal(expectedState({ expected: boundary.body.expected }, { ...job, jobId: '1', status: 7, stateVersion: 8n, deadlineFailureClaimed: true, faultReviewPending: true, faultReviewDeadline: deadline + 1n }, { blockTimestamp }), null);
    job.deliveryDeadline = blockTimestamp - 1n;
    const late = await call(operatorSession, { action: 'claimDeliveryTimeout', params: { expected: '7' } });
    assert.equal(late.body.expected.status, 7);
    job.status = 0; job.applyBy = blockTimestamp + 1n; await f.db.query('UPDATE v2_jobs SET status=$1 WHERE job_id=$2', ['open', '1']);
    const openEarly = await call(outsiderSession, { action: 'claimOpenJobTimeout', params: { expected: '7' } });
    assert.equal(openEarly.response.status, 409);
    job.applyBy = blockTimestamp;
    const openOnTime = await call(outsiderSession, { action: 'claimOpenJobTimeout', params: { expected: '7' } });
    assert.equal(openOnTime.response.status, 200, JSON.stringify(openOnTime.body));
    assert.equal(openOnTime.body.expected.status, 7);
  } finally { await f.db.close(); await rm(f.dir, { recursive: true, force: true }); }
});

