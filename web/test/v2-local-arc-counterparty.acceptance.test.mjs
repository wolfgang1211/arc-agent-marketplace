import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scratchDir } from './scratch-dir.mjs';
import { ARC_TESTNET_PROFILE } from '../lib/v2/chain-profile.mjs';
import { getAddress } from 'viem';
import { createDurableAuthorizationLedger, DEFAULT_AUTHORIZATION_DIRECTORY } from '../lib/v2/server/durable-authorization.mjs';
import { assertActionRole } from '../lib/v2/server/local-arc-counterparty-policy.mjs';
import { assertCanonicalPlan, assertReceiptAndReadback, createArcApiClient, LOCAL_ARC_API_ORIGIN } from '../scripts/v2-local-arc-counterparty-helper.mjs';
import { assertAccountDeltas } from '../scripts/v2-local-arc-counterparty.mjs';

const OPERATOR = '0x7c3A84C2F23B50Cd7A70A597641776475abb59e7';
const OWNER = '0xf5e14962e46f80faa40570bd86BccE83AA6626fF';
const MARKET = '0xfa156b7a5205b123c8a22a807ba98405e36130f1';
const HASH = `0x${'ab'.repeat(32)}`;
const basePlan = { action: 'submitDelivery', mode: 'unsigned-plan', noSign: true, noBroadcast: true, chainId: '5042002', target: MARKET, from: OPERATOR, value: '0', data: '0xdeadbeef', job: { jobId: '1', stateVersion: 7n } };

test('C1 wrong target and wrong action are rejected by full runtime ABI binding', () => {
  assert.throws(() => assertCanonicalPlan({ ...basePlan, target: '0x0000000000000000000000000000000000000001' }), /PLAN_TARGET_ACTION_MISMATCH|PLAN_TARGET_UNPINNED/);
  assert.throws(() => assertCanonicalPlan({ ...basePlan, action: 'transfer' }), /PLAN_ACTION_NOT_ALLOWED/);
  assert.throws(() => assertCanonicalPlan({ ...basePlan, chainId: '1' }), /PLAN_CHAIN_MISMATCH/);
});

test('C3 receipt chain evidence and canonical block binding are mandatory', () => {
  const tx = `0x${'11'.repeat(32)}`;
  const receipt = { status: 'success', transactionHash: tx, to: MARKET, from: OPERATOR, blockNumber: '0x2a', blockHash: HASH };
  assert.throws(() => assertReceiptAndReadback({ plan: basePlan, txHash: tx, receipt, readback: { confirmed: true, jobId: '1', stateVersion: '8' } }), /RECEIPT_CHAIN_MISMATCH/);
  assert.throws(() => assertReceiptAndReadback({ plan: basePlan, txHash: tx, receipt: { ...receipt, chainId: '5042002', blockHash: undefined }, readback: { confirmed: true, jobId: '1', stateVersion: '8' } }), /RECEIPT_BLOCK_BINDING_MISSING/);
});

test('C4 mutual reject is a non-bump job transition', () => {
  const tx = `0x${'11'.repeat(32)}`;
  assert.doesNotThrow(() => assertReceiptAndReadback({ plan: { ...basePlan, action: 'rejectMutual' }, txHash: tx, receipt: { status: 'success', transactionHash: tx, to: MARKET, from: OPERATOR, blockNumber: '0x2a', blockHash: HASH, chainId: '5042002' }, readback: { confirmed: true, jobId: '1', stateVersion: '7' } }));
});

test('C7 unchanged account evidence is not a successful stake or credit operation', () => {
  const account = { freeStake: 10n, reservedStake: 2n, credits: 3n, tokenBalance: 100n };
  assert.throws(() => assertAccountDeltas('depositStake', account, { ...account }, 5n), /CANONICAL_ACCOUNT_DELTA_UNCONFIRMED/);
  assert.throws(() => assertAccountDeltas('withdrawCredit', account, { ...account }), /CANONICAL_ACCOUNT_DELTA_UNCONFIRMED/);
  assert.throws(() => assertAccountDeltas('withdrawStake', account, { ...account }, 5n), /CANONICAL_ACCOUNT_DELTA_UNCONFIRMED/);
});

test('C6 durable claim survives a new ledger instance and rejects concurrent double claim', async () => {
  const dir = await mkdtemp(path.join(scratchDir(), 'arc-authz-'));
  try {
    const input = { requestId: 'restart-replay', action: 'submitDelivery', jobId: '1', params: { nested: { amount: '1' } }, expiresAt: Date.now() + 60000 };
    await createDurableAuthorizationLedger({ directory: dir }).claim(input);
    await assert.rejects(() => createDurableAuthorizationLedger({ directory: dir }).claim(input), /CHAT_REQUEST_ALREADY_USED/);
    const raced = await Promise.allSettled([createDurableAuthorizationLedger({ directory: dir }).claim({ ...input, requestId: 'race' }), createDurableAuthorizationLedger({ directory: dir }).claim({ ...input, requestId: 'race' })]);
    assert.equal(raced.filter(x => x.status === 'fulfilled').length, 1);
    assert.equal(raced.filter(x => x.status === 'rejected' && /CHAT_REQUEST_ALREADY_USED/.test(x.reason.message)).length, 1);
    await assert.rejects(() => createDurableAuthorizationLedger({ directory: dir }).claim({ ...input, params: { nested: { amount: '2' } } }), /CHAT_REQUEST_ALREADY_USED|AUTHORIZATION_ID_INVALID/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('C8 caller actor arguments cannot forge pinned trusted roles', () => {
  assert.throws(() => assertActionRole('submitDelivery', OPERATOR, { testOperator: OWNER }), /OPERATOR_NOT_VERIFIED_PUBLIC_ROLE|TEST_OPERATOR_REQUIRED/);
  assert.throws(() => assertActionRole('resolveDispute', '0x0000000000000000000000000000000000000002', { effectiveResolver: OPERATOR }), /RESOLVER_NOT_EFFECTIVE_JOB_RESOLVER|EFFECTIVE_RESOLVER/);
});

test('C2 domain, expiry, and nonce are validated before signing', async () => {
  const wallet = OPERATOR;
  const domain = ARC_TESTNET_PROFILE.authDomain;
  const future = new Date(Date.now() + 300000).toISOString();
  const make = (messageDomain, expires, nonce) => ['AlphaBoard V2 wallet login', '', `Domain: ${messageDomain}`, `Origin: ${LOCAL_ARC_API_ORIGIN}`, `URI: ${LOCAL_ARC_API_ORIGIN}/auth/wallet`, `Address: ${getAddress(wallet)}`, 'Chain ID: 5042002', `Marketplace: ${getAddress(MARKET)}`, `Nonce: ${nonce}`, `Issued At: ${new Date().toISOString()}`, `Expiration Time: ${expires}`, 'Request ID: c1', '', 'Sign this message to log in. Not an EIP-712 application or transaction.'].join('\n');
  for (const [message, expiresAt, code] of [[make('evil.invalid', future, 'ab'.repeat(32)), future, 'API_AUTH_CHALLENGE_BINDING_INVALID'], [make(domain, '1970-01-01T00:00:00.000Z', 'ab'.repeat(32)), '1970-01-01T00:00:00.000Z', 'API_AUTH_CHALLENGE_EXPIRED'], [make(domain, future, 'forged'), future, 'API_AUTH_CHALLENGE_BINDING_INVALID']]) {
    let signed = false;
    const api = createArcApiClient({ baseUrl: LOCAL_ARC_API_ORIGIN, fetchImpl: async () => Response.json({ challengeId: 'c1', wallet, chainId: '5042002', domain, origin: LOCAL_ARC_API_ORIGIN, expiresAt, message }) });
    await assert.rejects(() => api.authenticate({ wallet, chainId: 5042002n, signMessage: async () => { signed = true; return '0x01'; } }), new RegExp(`^Error: ${code}$`));
    assert.equal(signed, false);
  }
});

test('C2 redirects are rejected before challenge signing', async () => {
  let signed = false;
  const api = createArcApiClient({ baseUrl: LOCAL_ARC_API_ORIGIN, fetchImpl: async () => new Response('{}', { status: 302, headers: { location: 'https://evil.invalid/login' } }) });
  await assert.rejects(() => api.authenticate({ wallet: OPERATOR, chainId: 5042002n, signMessage: async () => { signed = true; return '0x01'; } }), /API_AUTH_REDIRECT_REJECTED|API_REQUEST_FAILED/);
  assert.equal(signed, false);
});

test('authorization storage default is persistent and outside the checkout', () => {
  assert.equal(DEFAULT_AUTHORIZATION_DIRECTORY, path.join(os.homedir(), 'AppData', 'Local', 'hermes', 'state', 'alphaboard-v2-local-arc', 'authorizations'));
});

test('expired authorization cannot create a durable claim', async () => {
  const directory = await mkdtemp(path.join(scratchDir(), 'arc-expired-authz-'));
  const ledger = createDurableAuthorizationLedger({ directory });
  await assert.rejects(ledger.claim({ requestId: 'expired', action: 'apply', jobId: '1', params: {}, expiresAt: Date.now() - 1 }), /CHAT_REQUEST_EXPIRED/);
});
