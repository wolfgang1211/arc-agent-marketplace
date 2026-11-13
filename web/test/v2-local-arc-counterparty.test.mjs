import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { scratchDir } from './scratch-dir.mjs';
import { createDurableAuthorizationLedger } from '../lib/v2/server/durable-authorization.mjs';
const fixtureLedger = async () => createDurableAuthorizationLedger({ directory: await mkdtemp(join(scratchDir(), 'v2-counterparty-auth-')) });
import { prepareCounterpartyPlan, executeCounterpartyOperation } from '../scripts/v2-local-arc-counterparty.mjs';
import { buildPreflight } from '../scripts/v2-local-arc-preflight.mjs';
import { assertCanonicalJob, assertActionRole, assertDepositAmount } from '../lib/v2/server/local-arc-counterparty-policy.mjs';

const YUSUF = '0x460EBe282Fb0e42B4d682a7f9EF408302417F780';
const OPERATOR = '0x7c3a84c2f23b50cd7a70a597641776475abb59e7';
const RESOLVER = '0x8c1e3668528c7f1f2e56becdddb4f368de12d8d3';
const OWNER = '0xf5e14962e46f80faa40570bd86bcce83aa6626ff';
const ZERO = '0x0000000000000000000000000000000000000000';
const HASH = `0x${'ab'.repeat(32)}`;
function fixture(overrides = {}) {
  const job = { client: YUSUF, operator: ZERO, resolver: ZERO, status: 0, stateVersion: 7n, reward: 1000000n, canonicalTermsHash: HASH, applyBy: 2000n, ...overrides };
  const account = { registered: true, freeStake: 123n, reservedStake: 45n, tokenBalance: 900n, nonceEpoch: 3n, applicationNonce: async () => 11n };
  const snap = { blockTag: '0x2a', blockHash: `0x${'11'.repeat(32)}`, blockTimestamp: 1000n, chainId: 5042002n, getters: { owner: OWNER }, readJob: async () => job, readClientPolicy: async () => ({ resolverPolicy: ZERO, resolvedResolver: OWNER }), readAccount: async () => account };
  return () => ({ read: async () => snap });
}
const roles = { testOperator: OPERATOR };
const args = ['--action=apply', '--job-id=1', `--operator=${OPERATOR}`, '--expected-version=7'];

test('positive application uses canonical job terms, parties, pinned block, and real nonce evidence', async () => {
  const plan = await prepareCounterpartyPlan(args, { readerFactory: fixture(), roles });
  assert.equal(plan.job.client, YUSUF); assert.equal(plan.job.stateVersion, 7n); assert.equal(plan.typedData.message.termsHash, HASH); assert.equal(plan.typedData.message.nonceEpoch, 3n); assert.equal(plan.typedData.message.operatorNonce, 11n); assert.equal(plan.provenance.blockHash, `0x${'11'.repeat(32)}`); assert.equal(plan.noSign, true); assert.equal(plan.noBroadcast, true);
});

test('forged caller job client is rejected and cannot replace canonical state', async () => {
  await assert.rejects(() => prepareCounterpartyPlan([...args, '--job-client=0x0000000000000000000000000000000000000001'], { readerFactory: fixture(), roles }), /JOB_CLIENT_MISMATCH/);
  await assert.rejects(() => prepareCounterpartyPlan(args.filter((x) => !x.startsWith('--operator=')), { readerFactory: fixture(), roles }), /OPERATOR_REQUIRED/);
});

test('historical other-client job is rejected even when caller claims Yusuf', async () => {
  await assert.rejects(() => prepareCounterpartyPlan(args, { readerFactory: fixture({ client: '0x0000000000000000000000000000000000000002' }), roles }), /CANONICAL_JOB_CLIENT_MUST_BE_YUSUF/);
});

test('missing delivery hash and mismatched version fail before encoding', async () => {
  const active = fixture({ operator: OPERATOR, status: 1, stateVersion: 8n });
  await assert.rejects(() => prepareCounterpartyPlan(['--action=submit-delivery', '--job-id=1', `--operator=${OPERATOR}`, '--expected-version=8'], { readerFactory: active, roles }), /DELIVERY_BLOB_HASH_REQUIRED/);
  await assert.rejects(() => prepareCounterpartyPlan(['--action=submit-delivery', '--job-id=1', `--operator=${OPERATOR}`, '--expected-version=7', `--hash=${HASH}`], { readerFactory: active, roles }), /STATE_VERSION_MISMATCH/);
});

test('preflight reports requested operator collateral and canonical owner fallback without RPC', async () => {
  const result = await buildPreflight({ operator: OPERATOR, readerFactory: fixture(), gasReader: { getGasPrice: async () => 99n, getBalance: async (options) => { assert.equal(options.address, YUSUF); assert.equal(options.blockNumber, BigInt('0x2a')); return 17n; }, estimateGas: async () => 123n } });
  assert.equal(result.yusuf.nativeRaw18, '17'); assert.equal(result.yusuf.erc20Raw6, '900');
  assert.equal(result.operator.address.toLowerCase(), OPERATOR.toLowerCase()); assert.equal(result.operator.freeStakeRaw6, '123'); assert.equal(result.operator.reservedStakeRaw6, '45'); assert.equal(result.operator.registered, true); assert.equal(result.resolver.effectiveResolver.toLowerCase(), OWNER.toLowerCase()); assert.equal(result.resolver.ownerFallbackApplied, true); assert.equal(result.evidence.blockHash, `0x${'11'.repeat(32)}`); assert.equal(result.gas.liveGasPriceWei, '99');
});

test('source keeps signer blocked and avoids synthetic hashes/default versions', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('../scripts/v2-local-arc-counterparty.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /keccak256|stringToHex|default.*Yusuf|expectedVersion.*0/); assert.match(source, /runtime-abi|action-manifest|APPLICATION_TYPES/); assert.match(source, /noSign: true/);
});

test('resolver plan uses actual resolver, not the distinct operator, with explicit decision', async () => {
  const input = ['--action=resolve', '--job-id=1', `--operator=${OPERATOR}`, '--expected-version=7', `--resolver=${OWNER}`, `--reason-hash=${HASH}`, `--evidence-hash=${HASH}`, '--gross-payout=0', '--operator-fault=false'];
  const plan = await prepareCounterpartyPlan(input, { readerFactory: fixture({ status: 5, operator: OPERATOR, resolver: OWNER }), roles });
  assert.equal(plan.from.toLowerCase(), OWNER.toLowerCase());
  assert.notEqual(plan.from.toLowerCase(), OPERATOR.toLowerCase());
  assert.equal(plan.noBroadcast, true);
});

test('fault review uses full runtime ABI and enforces pending deadline reserve and effective owner resolver', async () => {
  const input = ['--action=resolve-fault-review', '--job-id=1', `--operator=${OPERATOR}`, `--resolver=${OWNER}`, '--expected-version=7', '--slash=12', `--reason-hash=${HASH}`, `--evidence-hash=${HASH}`];
  const plan = await prepareCounterpartyPlan(input, { readerFactory: fixture({ faultReviewPending: true, faultReviewDeadline: 2000n, stakeReserved: 20n }), roles });
  assert.equal(plan.action, 'resolveFaultReview'); assert.equal(plan.from.toLowerCase(), OWNER.toLowerCase()); assert.equal(plan.noBroadcast, true);
  await assert.rejects(() => prepareCounterpartyPlan(input.map((x) => x.startsWith('--slash=') ? '--slash=21' : x), { readerFactory: fixture({ faultReviewPending: true, faultReviewDeadline: 2000n, stakeReserved: 20n }), roles }), /FAULT_SLASH_EXCEEDS_RESERVE/);
  await assert.rejects(() => prepareCounterpartyPlan(input, { readerFactory: fixture({ faultReviewPending: false, faultReviewDeadline: 2000n, stakeReserved: 20n }), roles }), /FAULT_REVIEW_NOT_PENDING/);
});

test('mutual acceptance binds real request version and opposite proposer', async () => {
  const original = fixture({ status: 1, operator: OPERATOR });
  const readerFactory = () => ({ read: async () => ({ ...await original().read(), readMutual: async () => ({ active: true, proposer: YUSUF, version: 4n, jobStateVersion: 7n, expiry: 2000n, refund: 1000000n, grossPayout: 0n }) }) });
  const input = ['--action=accept-mutual', '--job-id=1', `--operator=${OPERATOR}`, '--expected-version=7', '--expected-request-version=4'];
  const plan = await prepareCounterpartyPlan(input, { readerFactory, roles });
  assert.equal(plan.from.toLowerCase(), OPERATOR.toLowerCase());
  assert.equal(plan.mutual.version, 4n);
  await assert.rejects(prepareCounterpartyPlan(input.map(x => x === '--expected-request-version=4' ? '--expected-request-version=5' : x), { readerFactory, roles }), /MUTUAL_VERSION_MISMATCH/);
});

test('wrong canonical chain fails before plan preparation', async () => {
  const original = fixture();
  const readerFactory = () => ({ read: async () => ({ ...await original().read(), chainId: 1n }) });
  await assert.rejects(prepareCounterpartyPlan(args, { readerFactory, roles }), /CANONICAL_CHAIN_MISMATCH/);
});

test('missing fresh specific chat request causes zero signer, send, and manifest calls', async () => {
  const calls = [];
  const deps = { readerFactory: fixture(), roles, signer: { signApplication: async () => calls.push('sign') }, api: { postApplication: async () => calls.push('post') }, rpc: { simulate: async () => calls.push('simulate') }, readback: async () => calls.push('readback') };
  await assert.rejects(() => executeCounterpartyOperation(args, deps), /FRESH_SPECIFIC_CHAT_REQUEST_REQUIRED/);
  assert.deepEqual(calls, []);
});

test('application execution is simulation, DPAPI signer bridge, signed POST, then canonical readback', async () => {
  const calls = [];
  const deps = { authLedger: await fixtureLedger(), readerFactory: fixture(), roles, chatRequest: { fresh: true, automatic: false, action: 'apply', requestId: 'chat-1', jobId: '1', expiresAt: Date.now() + 60000, params: { action: 'apply', 'expected-version': '7', 'job-id': '1', operator: OPERATOR } }, signer: { address: OPERATOR, signMessage: async () => '0xauth', signApplication: async () => { calls.push('sign'); return `0x${'aa'.repeat(65)}`; } }, recoverApplicationSigner: async () => OPERATOR, api: { authenticate: async () => calls.push('auth'), postApplication: async (body) => { calls.push('post'); assert.equal(body.jobId, '1'); return { id: 'application-1' }; } }, rpc: { simulate: async () => calls.push('simulate'), populateTransaction: async ({ plan }) => { calls.push('populate'); return { chainId: '5042002', to: plan.target, data: plan.data, value: '0', nonce: 1, gasLimit: '100000', gasPrice: '1' }; } }, readback: async () => { calls.push('readback'); return { canonical: true, confirmed: true, jobId: '1', stateVersion: '7' }; } };
  const result = await executeCounterpartyOperation(args, deps);
  assert.deepEqual(calls, ['auth', 'sign', 'post', 'readback']); assert.equal(result.readback.canonical, true);
});

test('delivery execution simulates before manifest POST and broadcast, then verifies receipt/readback', async () => {
  const calls = [];
  const active = fixture({ operator: OPERATOR, status: 1, stateVersion: 7n });
  const argv = ['--action=submit-delivery', '--job-id=1', `--operator=${OPERATOR}`, '--expected-version=7', `--hash=${HASH}`, '--content={"result":"one"}', '--delivery-version=1'];
  const deps = { authLedger: await fixtureLedger(), readerFactory: active, roles, chatRequest: { fresh: true, automatic: false, action: 'submitDelivery', requestId: 'chat-2', jobId: '1', expiresAt: Date.now() + 60000, params: { action: 'submit-delivery', 'expected-version': '7', hash: HASH, 'job-id': '1', operator: OPERATOR, content: '{"result":"one"}', 'delivery-version': '1' } }, deliveryContent: { result: 'one' }, signer: { address: OPERATOR, signMessage: async () => '0xauth', signTransaction: async () => { calls.push('sign'); return `0x${'aa'.repeat(32)}`; } }, api: { authenticate: async () => calls.push('auth'), postDeliveryManifest: async () => { calls.push('manifest'); return { blobHash: HASH, id: 'delivery-1' }; } }, rpc: { simulate: async () => calls.push('simulate'), populateTransaction: async ({ plan }) => { calls.push('populate'); return { chainId: '5042002', to: plan.target, data: plan.data, value: '0', nonce: 1, gasLimit: '100000', gasPrice: '1' }; }, sendRawTransaction: async () => { calls.push('send'); return `0x${'22'.repeat(32)}`; }, receipt: async () => { calls.push('receipt'); return { status: 'success', transactionHash: `0x${'22'.repeat(32)}`, to: '0xfa156b7a5205b123c8a22a807ba98405e36130f1', from: OPERATOR, blockNumber: '0x2b', blockHash: `0x${'33'.repeat(32)}`, chainId: '5042002' }; } }, readback: async () => { calls.push('readback'); return { canonical: true, confirmed: true, jobId: '1', stateVersion: '8' }; } };
  const result = await executeCounterpartyOperation(argv, deps);
  assert.deepEqual(calls, ['auth', 'manifest', 'simulate', 'populate', 'sign', 'send', 'receipt', 'readback']); assert.equal(result.txHash, `0x${'22'.repeat(32)}`);
});

test('policy rejects wrong chain, non-Yusuf reward, role collision, and deposit over cap', () => {
  assert.throws(() => assertCanonicalJob({ client: YUSUF, reward: 1n }, { chainId: 1n }), /CANONICAL_CHAIN_MISMATCH/);
  assert.throws(() => assertCanonicalJob({ client: YUSUF, reward: 5000001n }, { chainId: 5042002n }), /REWARD_CAP_EXCEEDED/);
  assert.throws(() => assertActionRole('submitDelivery', RESOLVER, { testOperator: OPERATOR, jobOperator: OPERATOR }), /OPERATOR_NOT_VERIFIED_PUBLIC_ROLE/);
  assert.throws(() => assertDepositAmount(5000001n), /DEPOSIT_CAP_EXCEEDED/);
});
