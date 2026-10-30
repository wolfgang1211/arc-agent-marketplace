import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createPublicClient, createWalletClient, http, keccak256, stringToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hardhat } from 'viem/chains';
import { scratchDir } from './scratch-dir.mjs';
import { deployFixture, localRpc, startIsolatedNode, stopIsolatedNode } from './v2-local-node.mjs';
import { createPgliteDb, migrate } from '../lib/v2/server/db.mjs';
import { createV2Api } from '../lib/v2/server/api-runtime.mjs';
import { createV2ChainReader } from '../lib/v2/server/chain-reader.mjs';
import { resolveV2ChainProfile } from '../lib/v2/chain-profile.mjs';
import { executeWalletAction } from '../lib/v2/new-wallet-execution.mjs';
import { documentHash } from '../lib/v2/ui-actions.mjs';

const ORIGIN = 'http://127.0.0.1:3104';
const KEYS = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
];
const DAY = 86400n;
const U = 1_000_000n;

function memoryStorage() {
  const map = new Map();
  return { get length() { return map.size; }, key: (index) => [...map.keys()][index] ?? null, getItem: (key) => map.get(key) ?? null, setItem: (key, value) => { map.set(key, String(value)); }, removeItem: (key) => { map.delete(key); }, clear: () => { map.clear(); } };
}
function providerFor(account, rpcUrl) {
  return { request: async ({ method, params }) => {
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [account.address];
    if (method === 'eth_chainId') return '0x7a69';
    if (method === 'eth_sendTransaction') {
      const tx = params[0];
      const client = createWalletClient({ account, chain: hardhat, transport: http(rpcUrl) });
      return client.sendTransaction({ to: tx.to, data: tx.data, value: BigInt(tx.value ?? 0) });
    }
    return localRpc(rpcUrl, method, params);
  } };
}
function requestFor(route, init = {}, cookie = null) {
  const headers = { origin: ORIGIN, ...(init.headers ?? {}) };
  if (cookie) headers.cookie = cookie;
  return new Request(`${ORIGIN}${route}`, { ...init, headers });
}
test('scripted local API and wallet integration, not a browser or indexer end-to-end run', { timeout: 180000 }, async () => {
  const dir = await mkdtemp(path.join(scratchDir(), 'v2-local-chain-'));
  const manifestPath = path.join(dir, 'manifest.json');
  const node = await startIsolatedNode();
  const rpc = (method, params) => localRpc(node.rpcUrl, method, params);
  globalThis.localStorage = memoryStorage();
  let db;
  try {
    await deployFixture(node.rpcUrl, manifestPath);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const profile = resolveV2ChainProfile({ env: { V2_CHAIN_PROFILE: 'local-hardhat' }, localManifest: manifest });
    const [owner, client, operator, treasury] = KEYS.map((key) => privateKeyToAccount(key));
    assert.equal(client.address.toLowerCase(), manifest.roles.client.toLowerCase());
    db = await createPgliteDb({ dataDir: path.join(dir, 'pg') });
    await migrate(db);
    const transport = (method, params, toBlockTag) => method === 'eth_blockNumber' && toBlockTag ? Promise.resolve(toBlockTag) : rpc(method, params);
    const readerFactory = ({ toBlockTag } = {}) => createV2ChainReader({ transport: (method, params) => transport(method, params, toBlockTag), profile });
    const { verifyMessage } = await import('viem');
    const authed = createV2Api({ db, origin: ORIGIN, profile, readerFactory, getHealth: async () => ({ status: 'healthy', stale: false, gap: null }), verifyWalletSignature: ({ wallet, message, signature }) => verifyMessage({ address: wallet, message, signature }) });
    async function call(route, init, cookie) { const response = await authed.handle(requestFor(route, init, cookie)); const body = await response.json(); return { response, body }; }
    async function login(account) {
      const challenge = await call('/api/v2/auth/challenge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ wallet: account.address, chainId: '31337' }) });
      assert.equal(challenge.response.status, 200, JSON.stringify(challenge.body));
      const signature = await account.signMessage({ message: challenge.body.message });
      const verified = await call('/api/v2/auth/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ challengeId: challenge.body.challengeId, wallet: account.address, chainId: '31337', signature }) });
      assert.equal(verified.response.status, 200, JSON.stringify(verified.body));
      return { cookie: String(verified.response.headers.get('set-cookie')).split(';', 1)[0], csrf: verified.body.csrf, wallet: account.address };
    }
    async function markCanonical(hash) {
      const receipt = await rpc('eth_getTransactionReceipt', [hash]);
      const block = await rpc('eth_getBlockByNumber', [receipt.blockNumber, false]);
      await db.query('INSERT INTO v2_indexer_blocks_fork (chain_id, stream, block_number, block_hash, parent_hash, transaction_count, canonical) VALUES ($1,$2,$3,$4,$5,$6,TRUE) ON CONFLICT DO NOTHING', [profile.canonicalChainId.toString(), 'marketplace', BigInt(block.number).toString(), String(block.hash).toLowerCase(), String(block.parentHash).toLowerCase(), block.transactions.length]);
      const cursor = JSON.stringify({ blockNumber: BigInt(block.number).toString(), blockHash: String(block.hash).toLowerCase() });
      await db.query('INSERT INTO v2_indexer_cursors (chain_id, marketplace, cursor) VALUES ($1,$2,$3) ON CONFLICT (chain_id, marketplace) DO UPDATE SET cursor = EXCLUDED.cursor', [profile.canonicalChainId.toString(), profile.marketplace, cursor]);
    }
    async function send(account, prepared) {
      const outcome = await executeWalletAction(prepared, { profile, provider: providerFor(account, node.rpcUrl), readback: async (hash, intentId) => {
        await markCanonical(hash);
        const result = await call(`/api/v2/transactions/${hash}?intent=${encodeURIComponent(intentId)}`, { method: 'GET' }, (await login(account)).cookie);
        if (result.body?.ok !== true) {
          const intentRow = await db.query('SELECT payload FROM v2_audit_events WHERE entity_id=$1', [intentId]);
          const snap = await readerFactory().read();
          const chainAccount = await snap.readAccount(account.address);
          const view = Object.fromEntries(Object.entries(chainAccount).filter(([, value]) => typeof value !== 'function').map(([key, value]) => [key, typeof value === 'bigint' ? value.toString() : value]));
          throw Object.assign(new Error(JSON.stringify({ body: result.body, expected: intentRow.rows[0]?.payload?.expected, balances: intentRow.rows[0]?.payload?.snapshot?.balances, view })), { code: 'readback-mismatch' });
        }
        return result.body;
      } });
      assert.equal(outcome.phase, 'success');
      assert.equal(outcome.readback.confirmed, true);
      assert.equal(outcome.readback.action, prepared.action);
      localStorage.clear();
      return outcome;
    }
    async function remember(jobId) {
      const head = await rpc('eth_blockNumber');
      const snap = await readerFactory({ toBlockTag: head }).read();
      const job = await snap.readJob(BigInt(jobId));
      const operatorAddress = job.operator && job.operator !== '0x0000000000000000000000000000000000000000' ? job.operator : null;
      await db.query(`INSERT INTO v2_jobs (chain_id, marketplace, job_id, reward, status, state_version, terms_hash, client, operator, resolver, source_block, source_hash, data)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (chain_id, marketplace, job_id) DO UPDATE SET reward=EXCLUDED.reward, status=EXCLUDED.status, state_version=EXCLUDED.state_version, terms_hash=EXCLUDED.terms_hash, operator=EXCLUDED.operator, resolver=EXCLUDED.resolver, source_block=EXCLUDED.source_block, source_hash=EXCLUDED.source_hash, data=EXCLUDED.data`,
      [profile.canonicalChainId.toString(), profile.marketplace, String(jobId), job.reward.toString(), String(job.status), job.stateVersion.toString(), job.canonicalTermsHash, job.client, operatorAddress, job.resolver, BigInt(snap.blockTag).toString(), snap.blockHash, JSON.stringify({ applyBy: job.applyBy.toString() })]);
      return job;
    }
    const clientSession = await login(client);
    const operatorSession = await login(operator);
    const ownerSession = await login(owner);
    const context = await call('/api/v2/draft-context', { method: 'GET' }, clientSession.cookie);
    assert.equal(context.response.status, 200, JSON.stringify(context.body));
    const policy = context.body.policy;
    const headTime = BigInt(parseInt(await rpc('eth_getBlockByNumber', ['latest', false]).then((block) => block.timestamp), 16));
    const applyBy = (headTime + 2n * DAY).toString();
    const criteria = ['Link summary covers the source'];
    const description = 'Summarize https://example.com/alpha';
    const terms = { ...policy, reward: (10n * U).toString(), deliveryDuration: DAY.toString(), reviewDuration: DAY.toString(), revisionDuration: (12n * 3600n).toString(), revisionLimit: '2', unlimitedRevisions: false, applyBy, criteriaHash: documentHash(criteria), descriptionHash: documentHash(description), testJob: false };
    const draft = await call('/api/v2/jobs', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'job-1', 'x-v2-csrf': clientSession.csrf }, body: JSON.stringify({ terms, document: { description, criteria } }) }, clientSession.cookie);
    assert.equal(draft.response.status, 201, JSON.stringify(draft.body));
    await send(client, draft.body);
    let job = await remember(1);
    assert.equal(job.status, 0);
    const stake = await call('/api/v2/accounts/preflight', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'stake-1', 'x-v2-csrf': operatorSession.csrf }, body: JSON.stringify({ action: 'depositStake', params: { amount: (20n * U).toString() } }) }, operatorSession.cookie);
    assert.equal(stake.response.status, 200, JSON.stringify(stake.body));
    assert.equal(stake.body.allowance.requiredAmount, (20n * U).toString());
    await send(operator, stake.body);
    const registered = await call('/api/v2/accounts/preflight', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'register-1', 'x-v2-csrf': operatorSession.csrf }, body: JSON.stringify({ action: 'registerOperator', params: {} }) }, operatorSession.cookie);
    assert.equal(registered.response.status, 200, JSON.stringify(registered.body));
    await send(operator, registered.body);
    job = await remember(1);
    const applicationContext = await call('/api/v2/jobs/1/application-context', { method: 'GET' }, operatorSession.cookie);
    assert.equal(applicationContext.response.status, 200, JSON.stringify(applicationContext.body));
    const signed = await operator.signTypedData({ domain: { ...applicationContext.body.domain, chainId: 31337n, verifyingContract: profile.marketplace }, types: applicationContext.body.types, primaryType: 'Application', message: { ...applicationContext.body.message, jobId: 1n, validAfter: 0n, validBefore: BigInt(applicationContext.body.message.validBefore), nonceEpoch: BigInt(applicationContext.body.message.nonceEpoch), operatorNonce: BigInt(applicationContext.body.message.operatorNonce) } });
    const applied = await call('/api/v2/jobs/1/applications', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'apply-1', 'x-v2-csrf': operatorSession.csrf }, body: JSON.stringify({ application: applicationContext.body.message, signature: signed, pitch: 'I will deliver the link summary.' }) }, operatorSession.cookie);
    assert.equal(applied.response.status, 201, JSON.stringify(applied.body));
    const listed = await call('/api/v2/jobs/1/applications', { method: 'GET' }, clientSession.cookie);
    assert.equal(listed.body.items[0].operator.toLowerCase(), operator.address.toLowerCase());
    const award = await call('/api/v2/jobs/1/preflight', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'award-1', 'x-v2-csrf': clientSession.csrf }, body: JSON.stringify({ action: 'awardJob', params: { expected: job.stateVersion.toString() }, application: applied.body.application.payload, signature: signed }) }, clientSession.cookie);
    assert.equal(award.response.status, 200, JSON.stringify(award.body));
    await send(client, award.body);
    job = await remember(1);
    assert.equal(job.status, 1);
    const delivery = await call('/api/v2/jobs/1/deliveries', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'delivery-1', 'x-v2-csrf': operatorSession.csrf }, body: JSON.stringify({ kind: 'delivery', revision: false, version: '1', content: { link: 'https://example.com/alpha', summary: 'Local delivery' } }) }, operatorSession.cookie);
    assert.equal(delivery.response.status, 201, JSON.stringify(delivery.body));
    assert.match(delivery.body.delivery.blobHash, /^0x[0-9a-f]{64}$/);
    const submit = await call('/api/v2/jobs/1/preflight', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'submit-1', 'x-v2-csrf': operatorSession.csrf }, body: JSON.stringify({ action: 'submitDelivery', params: { blobHash: delivery.body.delivery.blobHash, expected: job.stateVersion.toString() } }) }, operatorSession.cookie);
    assert.equal(submit.response.status, 200, JSON.stringify(submit.body));
    await send(operator, submit.body);
    job = await remember(1);
    const mutualExpiry = (BigInt(parseInt((await rpc('eth_getBlockByNumber', ['latest', false])).timestamp, 16)) + DAY).toString();
    const proposed = await call('/api/v2/jobs/1/preflight', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'mutual-1', 'x-v2-csrf': clientSession.csrf }, body: JSON.stringify({ action: 'proposeMutual', params: { refund: (4n * U).toString(), grossPayout: (6n * U).toString(), expiry: mutualExpiry, expected: job.stateVersion.toString() } }) }, clientSession.cookie);
    assert.equal(proposed.response.status, 200, JSON.stringify(proposed.body));
    await send(client, proposed.body);
    job = await remember(1);
    const accepted = await call('/api/v2/jobs/1/preflight', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'accept-1', 'x-v2-csrf': operatorSession.csrf }, body: JSON.stringify({ action: 'acceptMutual', params: { expected: job.stateVersion.toString(), expectedRequestVersion: '1' } }) }, operatorSession.cookie);
    assert.equal(accepted.response.status, 200, JSON.stringify(accepted.body));
    await send(operator, accepted.body);
    job = await remember(1);
    assert.equal(job.status, 6);
    const credit = await call('/api/v2/accounts/preflight', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'credit-1', 'x-v2-csrf': operatorSession.csrf }, body: JSON.stringify({ action: 'withdrawCredit', params: {} }) }, operatorSession.cookie);
    assert.equal(credit.response.status, 200, JSON.stringify(credit.body));
    await send(operator, credit.body);
    const opened = await postSecondJob(call, send, client, clientSession, policy, headTime);
    let second = await remember(opened);
    const secondContext = await call(`/api/v2/jobs/${opened}/application-context`, { method: 'GET' }, operatorSession.cookie);
    assert.equal(secondContext.response.status, 200, JSON.stringify(secondContext.body));
    const secondSignature = await operator.signTypedData({ domain: { ...secondContext.body.domain, chainId: 31337n, verifyingContract: profile.marketplace }, types: secondContext.body.types, primaryType: 'Application', message: { ...secondContext.body.message, jobId: BigInt(opened), validAfter: 0n, validBefore: BigInt(secondContext.body.message.validBefore), nonceEpoch: BigInt(secondContext.body.message.nonceEpoch), operatorNonce: BigInt(secondContext.body.message.operatorNonce) } });
    const secondApplied = await call(`/api/v2/jobs/${opened}/applications`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'apply-2', 'x-v2-csrf': operatorSession.csrf }, body: JSON.stringify({ application: secondContext.body.message, signature: secondSignature, pitch: 'I can take the second job.' }) }, operatorSession.cookie);
    assert.equal(secondApplied.response.status, 201, JSON.stringify(secondApplied.body));
    const secondAward = await call(`/api/v2/jobs/${opened}/preflight`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'award-2', 'x-v2-csrf': clientSession.csrf }, body: JSON.stringify({ action: 'awardJob', params: { expected: second.stateVersion.toString() }, application: secondApplied.body.application.payload, signature: secondSignature }) }, clientSession.cookie);
    assert.equal(secondAward.response.status, 200, JSON.stringify(secondAward.body));
    await send(client, secondAward.body);
    second = await remember(opened);
    const dispute = await call(`/api/v2/jobs/${opened}/preflight`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'dispute-1', 'x-v2-csrf': clientSession.csrf }, body: JSON.stringify({ action: 'openDispute', params: { expected: second.stateVersion.toString() } }) }, clientSession.cookie);
    assert.equal(dispute.response.status, 200, JSON.stringify(dispute.body));
    await send(client, dispute.body);
    const disputed = await remember(opened);
    assert.equal(disputed.status, 5);
    const reason = keccak256(stringToHex('refund'));
    const evidence = keccak256(stringToHex('evidence'));
    const resolved = await call(`/api/v2/jobs/${opened}/preflight`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'resolve-1', 'x-v2-csrf': ownerSession.csrf }, body: JSON.stringify({ action: 'resolveDispute', params: { grossPayout: '0', operatorFault: false, reasonHash: reason, evidenceHash: evidence, expected: disputed.stateVersion.toString() } }) }, ownerSession.cookie);
    assert.equal(resolved.response.status, 200, JSON.stringify(resolved.body));
    await send(owner, resolved.body);
    const collateral = await call('/api/v2/accounts/preflight', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'withdraw-stake', 'x-v2-csrf': operatorSession.csrf }, body: JSON.stringify({ action: 'withdrawStake', params: { amount: (5n * U).toString() } }) }, operatorSession.cookie);
    assert.equal(collateral.response.status, 200, JSON.stringify(collateral.body));
    assert.equal(collateral.body.expected.stakeLiabilityDelta, `-${5n * U}`);
    const withdrawn = await send(operator, collateral.body);
    assert.equal(withdrawn.readback.state.walletTokenIncrease, (5n * U).toString());
    const publicClient = createPublicClient({ chain: hardhat, transport: http(node.rpcUrl) });
    const vaultLiability = await publicClient.readContract({ address: profile.vault, abi: [{ type: 'function', name: 'stakeLiability', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }], functionName: 'stakeLiability' });
    const operatorCredit = await publicClient.readContract({ address: profile.marketplace, abi: [{ type: 'function', name: 'credits', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }], functionName: 'credits', args: [operator.address] });
    assert.equal(operatorCredit, 0n);
    assert.equal(vaultLiability > 0n, true);
    assert.equal(treasury.address.toLowerCase(), manifest.roles.treasury.toLowerCase());
  } finally {
    if (db) await db.close();
    stopIsolatedNode(node.node);
    await rm(dir, { recursive: true, force: true });
    delete globalThis.localStorage;
  }
});

async function postSecondJob(call, send, client, session, policy, headTime) {
  const criteria = ['Second job stays isolated'];
  const description = 'Dispute this assigned job';
  const terms = { ...policy, reward: (10n * U).toString(), deliveryDuration: DAY.toString(), reviewDuration: DAY.toString(), revisionDuration: (12n * 3600n).toString(), revisionLimit: '1', unlimitedRevisions: false, applyBy: (headTime + 2n * DAY).toString(), criteriaHash: documentHash(criteria), descriptionHash: documentHash(description), testJob: false };
  const draft = await call('/api/v2/jobs', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'job-2', 'x-v2-csrf': session.csrf }, body: JSON.stringify({ terms, document: { description, criteria } }) }, session.cookie);
  assert.equal(draft.response.status, 201, JSON.stringify(draft.body));
  await send(client, draft.body);
  return '2';
}
