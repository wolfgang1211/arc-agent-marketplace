#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getAddress, encodeFunctionData, isAddress, recoverTypedDataAddress } from 'viem';
import { ARC_TESTNET_PROFILE } from '../lib/v2/chain-profile.mjs';
import { defaultV2ReaderFactory } from '../lib/v2/server/api-runtime.mjs';
import { APPLICATION_TYPES, applicationDomain } from '../lib/v2/applications.mjs';
import manifest from '../lib/v2/action-manifest.json' with { type: 'json' };
import runtimeProof from '../lib/v2/runtime-abi-proof.json' with { type: 'json' };
import { assertCanonicalJob, assertActionRole, assertDepositAmount, requireFreshChatRequest, YUSUF_CLIENT, TEST_OPERATOR, ARC_TESTNET_CHAIN_ID } from '../lib/v2/server/local-arc-counterparty-policy.mjs';
import { createDurableAuthorizationLedger } from '../lib/v2/server/durable-authorization.mjs';
import { assertCanonicalPlan, assertReceiptAndReadback } from './v2-local-arc-counterparty-helper.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
export const CHAIN_ID = ARC_TESTNET_CHAIN_ID;
export const MARKETPLACE = getAddress(ARC_TESTNET_PROFILE.marketplace);
export const YUSUF = YUSUF_CLIENT;
const ZERO = '0x0000000000000000000000000000000000000000';
const HASH = /^0x[0-9a-fA-F]{64}$/;
const sameHash = (value, expected) => { if (typeof value !== 'string' || !HASH.test(value) || typeof expected !== 'string' || !HASH.test(expected) || value.toLowerCase() !== expected.toLowerCase()) throw new Error('DELIVERY_MANIFEST_HASH_MISMATCH'); };
const ABI_WITNESS = runtimeProof.provenance;
const MARKET_ABI = runtimeProof.contracts.marketplace.abi;
const VAULT_ABI = manifest.contracts.vault.abi;
const safeJson = (value) => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2) + '\n';
const args = (argv) => Object.fromEntries(argv.filter((x) => x.startsWith('--')).map((x) => { const [k, ...v] = x.slice(2).split('='); return [k, v.join('=') || true]; }));
const equal = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const address = (value, label) => { if (typeof value !== 'string' || !isAddress(value)) throw new Error(label); return getAddress(value); };
const hash = (value, label) => { if (typeof value !== 'string' || !HASH.test(value)) throw new Error(`${label}_REQUIRED`); return value.toLowerCase(); };
export function assertAccountDeltas(action, before, after, amount = 0n) {
  const fields = ['freeStake', 'reservedStake', 'credits', 'tokenBalance'];
  if (!after || fields.every((field) => String(after[field]) === String(before?.[field]))) throw new Error('CANONICAL_ACCOUNT_DELTA_UNCONFIRMED');
  if (action === 'depositStake' && (BigInt(after.freeStake) < BigInt(before.freeStake) + BigInt(amount) || BigInt(after.tokenBalance) > BigInt(before.tokenBalance) - BigInt(amount))) throw new Error('CANONICAL_DEPOSIT_DELTA_INVALID');
  if (action === 'withdrawStake' && (BigInt(after.freeStake) > BigInt(before.freeStake) - BigInt(amount) || BigInt(after.tokenBalance) < BigInt(before.tokenBalance) + BigInt(amount))) throw new Error('CANONICAL_WITHDRAW_DELTA_INVALID');
  if (action === 'withdrawCredit' && !(BigInt(after.credits) < BigInt(before.credits) && BigInt(after.tokenBalance) > BigInt(before.tokenBalance))) throw new Error('CANONICAL_CREDIT_DELTA_INVALID');
}
async function publicRoles() { const d = JSON.parse(await fs.readFile(path.join(ROOT, 'contract/docs/v2-testnet-wallets.json'), 'utf8')); return Object.fromEntries(Object.entries(d.roles).map(([k, v]) => [k, address(v, `role_${k}`)])); }
function txPlan(action, data, from, job, snap, target = MARKETPLACE) { if (equal(from, YUSUF)) throw new Error('YUSUF_SIGNER_FORBIDDEN'); return { action, mode: 'unsigned-plan', signerStatus: 'blocked', noSign: true, noBroadcast: true, chainId: CHAIN_ID.toString(), target, from, value: '0', data, job: { jobId: job.jobId, client: job.client, operator: job.operator, resolver: job.resolver, status: job.status, stateVersion: job.stateVersion, termsHash: job.canonicalTermsHash }, provenance: { blockTag: snap.blockTag, blockHash: snap.blockHash, chainId: snap.chainId.toString() }, abiWitness: ABI_WITNESS }; }
function normalizeAction(value) { return ({ apply: 'apply', 'submit-delivery': 'submitDelivery', delivery: 'submitDelivery', revision: 'submitRevision',    'accept-mutual': 'acceptMutual', 'propose-mutual': 'proposeMutual', 'reject-mutual': 'rejectMutual', 'open-dispute': 'openDispute', 'apply-eip712': 'apply', resolve: 'resolveDispute', 'resolve-dispute': 'resolveDispute', 'resolve-fault-review': 'resolveFaultReview', 'deposit-stake': 'depositStake', 'withdraw-stake': 'withdrawStake', 'withdraw-credit': 'withdrawCredit' })[value] ?? value; }

export async function prepareCounterpartyPlan(argv = [], { readerFactory = defaultV2ReaderFactory, roles = null } = {}) {
  const a = args(argv); const action = normalizeAction(a.action || 'apply');
  if (!['apply', 'submitDelivery', 'submitRevision', 'proposeMutual', 'acceptMutual', 'rejectMutual', 'openDispute', 'resolveDispute', 'resolveFaultReview', 'depositStake', 'withdrawStake', 'withdrawCredit'].includes(action)) throw new Error('INVALID_ACTION');
  const jobId = BigInt(String(a['job-id'] ?? a.jobId ?? '0')); if (jobId < 1n) throw new Error('JOB_ID_REQUIRED');
  const signerInput = a.operator ?? a.signer; if (signerInput === undefined) throw new Error('OPERATOR_REQUIRED'); const signer = address(signerInput, 'OPERATOR_REQUIRED'); const roleMap = roles ?? await publicRoles();
  const reader = readerFactory({ profile: ARC_TESTNET_PROFILE }); const snap = await reader.read(); const rawJob = await snap.readJob(jobId); assertCanonicalJob(rawJob, { chainId: snap.chainId, jobId });
  const job = { jobId: jobId.toString(), ...rawJob }; if (a['job-client'] !== undefined && !equal(address(a['job-client'], 'JOB_CLIENT'), YUSUF)) throw new Error('JOB_CLIENT_MISMATCH');
  const expectedVersion = a['expected-version'] ?? a.expectedVersion; if (expectedVersion === undefined) throw new Error('EXPECTED_VERSION_REQUIRED'); const version = BigInt(String(expectedVersion)); if (version !== BigInt(job.stateVersion)) throw new Error('STATE_VERSION_MISMATCH');
  const termsHash = hash(job.canonicalTermsHash, 'CANONICAL_TERMS_HASH'); if (a['terms-hash'] !== undefined && hash(a['terms-hash'], 'TERMS_HASH') !== termsHash) throw new Error('TERMS_HASH_MISMATCH');
  const policy = await snap.readClientPolicy(YUSUF); const effectiveResolver = address(policy.resolvedResolver, 'EFFECTIVE_RESOLVER'); const publicOperator = TEST_OPERATOR; if (!roleMap?.testOperator || address(roleMap.testOperator, 'TEST_OPERATOR_REQUIRED') !== TEST_OPERATOR) throw new Error('TEST_OPERATOR_ROLE_BINDING_MISMATCH');
  if (action === 'apply') {
    if (signer !== publicOperator) throw new Error('OPERATOR_NOT_VERIFIED_PUBLIC_ROLE'); if (Number(job.status) !== 0 || !equal(job.operator, ZERO)) throw new Error('APPLICATION_JOB_NOT_OPEN');
    const validAfter = BigInt(String(a['valid-after'] ?? '0')); const validBefore = BigInt(String(a['valid-before'] ?? job.applyBy)); if (validAfter >= validBefore || validBefore > BigInt(job.applyBy)) throw new Error('INVALID_APPLICATION_WINDOW');
    const account = await snap.readAccount(signer); const nonceEpoch = BigInt(account.nonceEpoch); const operatorNonce = BigInt(await account.applicationNonce(jobId));
    return { action, mode: 'unsigned-plan', signerStatus: 'blocked', noSign: true, noBroadcast: true, chainId: CHAIN_ID.toString(), endpoint: `/api/v2/jobs/${jobId}/applications`, job, operator: signer, resolver: effectiveResolver, typedData: { domain: applicationDomain(CHAIN_ID, MARKETPLACE), types: APPLICATION_TYPES, primaryType: 'Application', message: { jobId, operator: signer, termsHash, validAfter, validBefore, nonceEpoch, operatorNonce } }, provenance: { blockTag: snap.blockTag, blockHash: snap.blockHash, chainId: snap.chainId.toString() }, abiWitness: ABI_WITNESS };
  }
  const actionSigner = ['resolveDispute', 'resolveFaultReview'].includes(action) ? address(a.resolver ?? signer, 'RESOLVER_REQUIRED') : signer;
  const role = assertActionRole(action, actionSigner, { testOperator: publicOperator, effectiveResolver, jobOperator: job.operator === ZERO ? undefined : job.operator });
  if (action === 'resolveFaultReview') {
    if (job.faultReviewPending !== true) throw new Error('FAULT_REVIEW_NOT_PENDING');
    if (BigInt(job.faultReviewDeadline) <= BigInt(snap.blockTimestamp)) throw new Error('FAULT_REVIEW_DEADLINE_PASSED');
    const slash = BigInt(String(a.slash ?? '0'));
    if (a.slash === undefined || slash > BigInt(job.stakeReserved)) throw new Error('FAULT_SLASH_EXCEEDS_RESERVE');
    const reasonHash = hash(a['reason-hash'], 'REASON_HASH'); const evidenceHash = hash(a['evidence-hash'], 'EVIDENCE_HASH');
    if (reasonHash === `0x${'00'.repeat(32)}` || evidenceHash === `0x${'00'.repeat(32)}`) throw new Error('FAULT_EVIDENCE_REQUIRED');
    return txPlan(action, encodeFunctionData({ abi: MARKET_ABI, functionName: 'resolveFaultReview', args: [jobId, slash, reasonHash, evidenceHash, version] }), role.signer, job, snap);
  }
  if (action === 'resolveDispute') {
    if (Number(job.status) !== 5) throw new Error('RESOLUTION_STATUS_MISMATCH'); const gross = BigInt(String(a['gross-payout'] ?? '0')); if (a['gross-payout'] === undefined || gross < 0n || gross > BigInt(job.reward) || !['true', 'false'].includes(String(a['operator-fault']))) throw new Error('PAYOUT_REQUIRED_OR_EXCEEDS_REWARD');
    return txPlan(action, encodeFunctionData({ abi: MARKET_ABI, functionName: 'resolveDispute', args: [jobId, gross, String(a['operator-fault']) === 'true', hash(a['reason-hash'], 'REASON_HASH'), hash(a['evidence-hash'], 'EVIDENCE_HASH'), version] }), role.signer, job, snap);
  }
  if (action === 'submitDelivery' || action === 'submitRevision') { const expectedStatus = action === 'submitRevision' ? 3 : 1; if (Number(job.status) !== expectedStatus) throw new Error('DELIVERY_STATUS_MISMATCH'); return txPlan(action, encodeFunctionData({ abi: MARKET_ABI, functionName: action, args: [jobId, hash(a.hash, 'DELIVERY_BLOB_HASH'), version] }), role.signer, job, snap); }
  if (action === 'depositStake' || action === 'withdrawStake') return txPlan(action, encodeFunctionData({ abi: VAULT_ABI, functionName: action, args: [assertDepositAmount(a.amount)] }), role.signer, job, snap, manifest.contracts.vault.address);
  if (action === 'acceptMutual') { const request = await snap.readMutual(jobId); if (!request?.active || BigInt(request.expiry) <= BigInt(snap.blockTimestamp) || !equal(request.proposer, YUSUF) || BigInt(request.jobStateVersion) !== version) throw new Error('MUTUAL_REQUEST_UNAVAILABLE'); if (a['expected-request-version'] === undefined || BigInt(a['expected-request-version']) !== BigInt(request.version)) throw new Error('MUTUAL_VERSION_MISMATCH'); return { ...txPlan(action, encodeFunctionData({ abi: MARKET_ABI, functionName: action, args: [jobId, version, BigInt(request.version)] }), role.signer, job, snap), mutual: request }; }
  if (action === 'proposeMutual') return txPlan(action, encodeFunctionData({ abi: MARKET_ABI, functionName: action, args: [jobId, BigInt(a.refund ?? 0), BigInt(a['gross-payout'] ?? 0), BigInt(a.expiry), version] }), role.signer, job, snap);
  if (action === 'rejectMutual') { const request = await snap.readMutual(jobId); if (!request?.active || !equal(request.proposer, YUSUF) || BigInt(request.jobStateVersion) !== version || a['expected-request-version'] === undefined || BigInt(a['expected-request-version']) !== BigInt(request.version)) throw new Error('MUTUAL_VERSION_MISMATCH'); return { ...txPlan(action, encodeFunctionData({ abi: MARKET_ABI, functionName: action, args: [jobId, version] }), role.signer, job, snap), mutual: request }; }
  if (action === 'openDispute') return txPlan(action, encodeFunctionData({ abi: MARKET_ABI, functionName: action, args: [jobId, version] }), role.signer, job, snap);
  if (action === 'withdrawCredit') return txPlan(action, encodeFunctionData({ abi: MARKET_ABI, functionName: action, args: [] }), role.signer, job, snap);
  throw new Error('UNSUPPORTED_ACTION');
}

const requestParams = (argv) => Object.fromEntries(Object.entries(args(argv)).sort(([a], [b]) => a.localeCompare(b)));

export async function executeCounterpartyOperation(argv = [], deps = {}) {
  const action = normalizeAction(args(argv).action || 'apply');
  let plan = await prepareCounterpartyPlan(argv, deps);
  const request = requireFreshChatRequest(deps.chatRequest, action, { jobId: plan.job.jobId, params: requestParams(argv) });
  const ledger = deps.authLedger ?? createDurableAuthorizationLedger();
  await ledger.claim({ requestId: request.requestId, action, jobId: plan.job.jobId, params: request.params, expiresAt: request.expiresAt });
  const { signer, api, rpc, readback } = deps;
  const plannedSigner = plan.from ?? plan.operator;
  if (!signer || !api || !rpc || typeof rpc.simulate !== 'function' || typeof readback !== 'function' || typeof api.authenticate !== 'function' || (action !== 'apply' && typeof rpc.populateTransaction !== 'function')) throw new Error('SECURE_EXECUTION_DEPENDENCIES_REQUIRED');
  if (typeof signer.address !== 'string' || signer.address.toLowerCase() !== plannedSigner.toLowerCase()) throw new Error('SIGNER_PLAN_MISMATCH');
  await api.authenticate({ wallet: plannedSigner, chainId: CHAIN_ID, signMessage: (message) => signer.signMessage(message) });
  let accountBefore = null;
  if (['depositStake', 'withdrawStake', 'withdrawCredit'].includes(action)) {
    if (typeof api.readAccount !== 'function') throw new Error('CANONICAL_ACCOUNT_READBACK_REQUIRED');
    const raw = await api.readAccount(plannedSigner); accountBefore = raw?.data ?? raw;
  }
  if (action === 'apply') {
    const signature = await signer.signApplication(plan.typedData);
    if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]+$/.test(signature)) throw new Error('SIGNER_UNAVAILABLE');
    const recovered = deps.recoverApplicationSigner ? await deps.recoverApplicationSigner({ plan, signature }) : await recoverTypedDataAddress({ ...plan.typedData, signature });
    if (recovered.toLowerCase() !== plannedSigner.toLowerCase()) throw new Error('APPLICATION_SIGNER_MISMATCH');
    const posted = await api.postApplication({ jobId: plan.job.jobId, application: plan.typedData.message, signature, pitch: args(argv).pitch ?? 'operator delivery' });
    const checked = await readback({ action, posted, plan });
    if (checked?.confirmed !== true || String(checked.jobId) !== String(plan.job.jobId) || String(checked.stateVersion) !== String(plan.job.stateVersion)) throw new Error('CANONICAL_READBACK_UNCONFIRMED');
    return Object.freeze({ action, phase: 'verified', posted: true, readback: checked });
  }
  assertCanonicalPlan(plan, { signer: plan.from });
  let manifestResult = null;
  if (action === 'submitDelivery' || action === 'submitRevision') {
    if (typeof api.postDeliveryManifest !== 'function') throw new Error('DELIVERY_MANIFEST_API_REQUIRED');
    const a = args(argv); let content; try { content = deps.deliveryContent ?? (a.content === undefined ? null : JSON.parse(String(a.content))); } catch { throw new Error('DELIVERY_CONTENT_INVALID'); }
    if (content === null || content === undefined || a['delivery-version'] === undefined) throw new Error('DELIVERY_MANIFEST_INPUT_REQUIRED');
    manifestResult = await api.postDeliveryManifest({ jobId: plan.job.jobId, action, content, version: a['delivery-version'], idempotencyKey: a['idempotency-key'] });
    if (!manifestResult) throw new Error('DELIVERY_MANIFEST_INVALID'); sameHash(manifestResult.blobHash, a.hash);
    const authoritativeHash = hash(manifestResult.blobHash, 'DELIVERY_BLOB_HASH');
    plan = { ...plan, data: encodeFunctionData({ abi: MARKET_ABI, functionName: action, args: [BigInt(plan.job.jobId), authoritativeHash, BigInt(plan.job.stateVersion)] }) };
    assertCanonicalPlan(plan, { signer: plan.from });
  }
  await rpc.simulate({ kind: 'transaction', plan });
  const populated = await rpc.populateTransaction({ plan, chainId: CHAIN_ID, target: plan.target, data: plan.data, value: '0' });
  if (!populated || populated.chainId !== CHAIN_ID.toString() || populated.to?.toLowerCase() !== plan.target.toLowerCase() || populated.data?.toLowerCase() !== plan.data.toLowerCase() || String(populated.value ?? '1') !== '0' || !Number.isSafeInteger(Number(populated.nonce)) || Number(populated.nonce) < 0 || (!populated.gasLimit && !populated.gas) || (!populated.maxFeePerGas && !populated.gasPrice)) throw new Error('TX_FEES_NONCE_NOT_POPULATED');
  const raw = await signer.signTransaction({ ...plan, ...populated });
  if (typeof raw !== 'string' || !/^0x[0-9a-fA-F]+$/.test(raw)) throw new Error('SIGNER_UNAVAILABLE');
  const txHash = await rpc.sendRawTransaction(raw); if (typeof txHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error('BROADCAST_UNAVAILABLE');
  const receipt = await rpc.receipt(txHash); const checked = await readback({ action, txHash, receipt, plan, manifestResult });
  if (['proposeMutual', 'rejectMutual'].includes(action) && plan.mutual && (!checked?.mutual || String(checked.mutual.version) !== String(plan.mutual.version) || checked.mutual.active !== false)) throw new Error('MUTUAL_READBACK_UNCONFIRMED');
  if (accountBefore) {
    const after = checked?.account;
    const amount = ['depositStake', 'withdrawStake'].includes(action) ? BigInt(assertCanonicalPlan(plan, { signer: plan.from }).args[0]) : 0n;
    assertAccountDeltas(action, accountBefore, after, amount);
  }
  assertReceiptAndReadback({ plan, txHash, receipt, readback: checked });
  return Object.freeze({ action, phase: 'verified', txHash, receipt, readback: checked, manifest: manifestResult });
}
export async function main(argv = process.argv.slice(2)) { process.stdout.write(safeJson(await prepareCounterpartyPlan(argv))); }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { process.stderr.write(`COUNTERPARTY_PLAN_BLOCKED:${error.message.replace(/\s+/g, '_')}\n`); process.exitCode = 1; });
