import { decodeFunctionData, getAddress, isAddress } from 'viem';
import manifest from '../lib/v2/action-manifest.json' with { type: 'json' };
import runtimeProof from '../lib/v2/runtime-abi-proof.json' with { type: 'json' };
import { ARC_TESTNET_PROFILE } from '../lib/v2/chain-profile.mjs';
import { ARC_TESTNET_CHAIN_ID } from '../lib/v2/server/local-arc-counterparty-policy.mjs';

export const LOCAL_ARC_API_ORIGIN = 'http://127.0.0.1:3102';
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const UINT_HEX = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;
const STATE_TRANSITIONS = new Set(['submitDelivery', 'submitRevision', 'acceptMutual', 'openDispute', 'resolveDispute', 'resolveFaultReview']);

const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const json = (v) => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? `${x}n` : x);
const eq = (a, b) => json(a) === json(b);
const address = (v, code) => { if (typeof v !== 'string' || !ADDRESS.test(v) || !isAddress(v)) throw new Error(code); return getAddress(v); };
const hash = (v, code) => { if (typeof v !== 'string' || !HASH.test(v)) throw new Error(code); return v.toLowerCase(); };
const CONTRACTS = Object.freeze({ marketplace: getAddress(ARC_TESTNET_PROFILE.marketplace), vault: getAddress(ARC_TESTNET_PROFILE.vault) });
const ABI_BY_TARGET = Object.freeze({ [CONTRACTS.marketplace.toLowerCase()]: runtimeProof.contracts.marketplace.abi, [CONTRACTS.vault.toLowerCase()]: runtimeProof.contracts.vault.abi });
const ACTION_TARGET = Object.freeze({ depositStake: CONTRACTS.vault, withdrawStake: CONTRACTS.vault, withdrawCredit: CONTRACTS.marketplace });
const ALLOWED_PLAN_ACTIONS = new Set(['submitDelivery', 'submitRevision', 'proposeMutual', 'acceptMutual', 'rejectMutual', 'openDispute', 'resolveDispute', 'resolveFaultReview', 'depositStake', 'withdrawStake', 'withdrawCredit']);

function challengeMessage({ domain, origin, wallet, chainId, marketplace, nonce, issuedAt, expiresAt, requestId }) {
  return `AlphaBoard V2 wallet login\n\nDomain: ${domain}\nOrigin: ${origin}\nURI: ${origin}/auth/wallet\nAddress: ${wallet}\nChain ID: ${chainId}\nMarketplace: ${marketplace}\nNonce: ${nonce}\nIssued At: ${issuedAt}\nExpiration Time: ${expiresAt}\nRequest ID: ${requestId}\n\nSign this message to log in. Not an EIP-712 application or transaction.`;
}
function validateChallenge(challenge, wallet) {
  if (!challenge || typeof challenge.message !== 'string' || typeof challenge.challengeId !== 'string' || challenge.origin !== LOCAL_ARC_API_ORIGIN || challenge.domain !== ARC_TESTNET_PROFILE.authDomain || String(challenge.chainId) !== ARC_TESTNET_CHAIN_ID.toString() || challenge.wallet?.toLowerCase() !== getAddress(wallet).toLowerCase() || typeof challenge.expiresAt !== 'string') throw new Error('API_AUTH_CHALLENGE_INVALID');
  const fields = Object.fromEntries(challenge.message.split('\n').filter((line) => line.includes(': ')).map((line) => { const i = line.indexOf(': '); return [line.slice(0, i), line.slice(i + 2)]; }));
  if (!/^[0-9a-f]{64}$/i.test(fields.Nonce ?? '') || fields.Domain !== challenge.domain || fields.Origin !== challenge.origin || fields.URI !== `${challenge.origin}/auth/wallet` || fields.Address?.toLowerCase() !== getAddress(wallet).toLowerCase() || fields['Chain ID'] !== ARC_TESTNET_CHAIN_ID.toString() || fields.Marketplace?.toLowerCase() !== CONTRACTS.marketplace.toLowerCase() || fields['Request ID'] !== challenge.challengeId || fields['Expiration Time'] !== challenge.expiresAt || challenge.message !== challengeMessage({ domain: fields.Domain, origin: fields.Origin, wallet: getAddress(wallet), chainId: fields['Chain ID'], marketplace: getAddress(fields.Marketplace), nonce: fields.Nonce, issuedAt: fields['Issued At'], expiresAt: fields['Expiration Time'], requestId: fields['Request ID'] })) throw new Error('API_AUTH_CHALLENGE_BINDING_INVALID');
  const expires = Date.parse(challenge.expiresAt); if (!Number.isFinite(expires) || expires <= Date.now() || expires > Date.now() + 10 * 60 * 1000) throw new Error('API_AUTH_CHALLENGE_EXPIRED');
}

export function assertCanonicalPlan(plan, { signer } = {}) {
  if (!plan || plan.noSign !== false && plan.mode !== 'unsigned-plan') throw new Error('PLAN_SHAPE_INVALID');
  if (BigInt(plan.chainId) !== ARC_TESTNET_CHAIN_ID) throw new Error('PLAN_CHAIN_MISMATCH');
  const target = address(plan.target, 'PLAN_TARGET_INVALID'); const from = address(plan.from, 'PLAN_SIGNER_INVALID');
  if (!ALLOWED_PLAN_ACTIONS.has(plan.action)) throw new Error('PLAN_ACTION_NOT_ALLOWED');
  if (signer !== undefined && !same(from, address(signer, 'SIGNER_INVALID'))) throw new Error('PLAN_SIGNER_MISMATCH');
  if (!/^0x[0-9a-fA-F]*$/.test(plan.data) || plan.data.length < 10) throw new Error('PLAN_DATA_INVALID');
  if (String(plan.value ?? '') !== '0') throw new Error('PLAN_VALUE_NONZERO');
  const expectedTarget = ACTION_TARGET[plan.action] ?? CONTRACTS.marketplace;
  if (target.toLowerCase() !== expectedTarget.toLowerCase()) throw new Error('PLAN_TARGET_ACTION_MISMATCH');
  const abi = ABI_BY_TARGET[target.toLowerCase()]; if (!abi) throw new Error('PLAN_TARGET_UNPINNED');
  let decoded; try { decoded = decodeFunctionData({ abi, data: plan.data }); } catch { throw new Error('PLAN_DATA_DECODE_FAILED'); }
  if (decoded.functionName !== plan.action) throw new Error('PLAN_ACTION_DATA_MISMATCH');
  if (!plan.job?.jobId || BigInt(plan.job.stateVersion) < 0n) throw new Error('PLAN_JOB_BINDING_INVALID');
  return Object.freeze({ target, from, value: '0', functionName: decoded.functionName, args: decoded.args });
}

export function assertReceiptAndReadback({ plan, txHash, receipt, readback }) {
  if (!TX_HASH.test(txHash ?? '') || !receipt || !(receipt.status === 'success' || receipt.status === '0x1' || receipt.status === 1 || receipt.status === 1n)) throw new Error('RECEIPT_NOT_POSITIVE');
  if (!TX_HASH.test(receipt.transactionHash ?? '') || !same(receipt.transactionHash, txHash)) throw new Error('RECEIPT_HASH_MISMATCH');
  if (!receipt.to || !same(receipt.to, plan.target)) throw new Error('RECEIPT_TARGET_MISMATCH');
  if (!receipt.from || !same(receipt.from, plan.from)) throw new Error('RECEIPT_SIGNER_MISMATCH');
  if (!UINT_HEX.test(receipt.blockNumber ?? '') || !TX_HASH.test(receipt.blockHash ?? '')) throw new Error('RECEIPT_BLOCK_BINDING_MISSING');
  if (receipt.chainId === undefined || BigInt(receipt.chainId) !== BigInt(plan.chainId)) throw new Error('RECEIPT_CHAIN_MISMATCH');
  if (!readback || readback.confirmed !== true || String(readback.jobId) !== String(plan.job.jobId)) throw new Error('CANONICAL_READBACK_UNCONFIRMED');
  const expectedVersion = STATE_TRANSITIONS.has(plan.action) ? BigInt(plan.job.stateVersion) + 1n : BigInt(plan.job.stateVersion);
  if (String(readback.stateVersion) !== String(expectedVersion)) throw new Error('CANONICAL_READBACK_VERSION_MISMATCH');
  return Object.freeze({ txHash, receipt, readback });
}

export function createArcApiClient({ baseUrl, fetchImpl = globalThis.fetch, origin, csrfToken, cookie } = {}) {
  if (baseUrl !== LOCAL_ARC_API_ORIGIN || typeof fetchImpl !== 'function' || (origin !== undefined && origin !== LOCAL_ARC_API_ORIGIN)) throw new Error('API_CLIENT_INVALID');
  let session = { origin: LOCAL_ARC_API_ORIGIN, csrfToken, cookie };
  const cookieFrom = (headers) => headers?.getSetCookie?.()?.find((x) => /^ab_v2_local_session=|^__Host-ab_v2_session=/.test(x))?.split(';')[0] ?? headers?.get?.('set-cookie')?.split(';')[0];
  async function request(path, { method = 'GET', body, csrf = false, idempotencyKey } = {}) {
    const headers = { accept: 'application/json', 'content-type': 'application/json' }; if (session.origin) headers.origin = session.origin; if (session.cookie) headers.cookie = session.cookie; if (csrf && session.csrfToken) headers['x-v2-csrf'] = session.csrfToken; if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
    const response = await fetchImpl(new URL(path, LOCAL_ARC_API_ORIGIN), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000), cache: 'no-store', redirect: 'error' });
    if (response.url && new URL(response.url).origin !== LOCAL_ARC_API_ORIGIN) throw new Error('API_AUTH_REDIRECT_REJECTED');
    const data = await response.json().catch(() => null); if (!response.ok) throw new Error('API_REQUEST_FAILED'); return { data, headers: response.headers };
  }
  return Object.freeze({
    async authenticate({ wallet, chainId, signMessage }) { if (!isAddress(wallet) || BigInt(chainId) !== ARC_TESTNET_CHAIN_ID || typeof signMessage !== 'function') throw new Error('API_AUTH_INPUT_INVALID'); const challengeResponse = await request('/api/v2/auth/challenge', { method: 'POST', body: { wallet: getAddress(wallet), chainId: String(chainId) } }); if (challengeResponse.headers?.get?.('location')) throw new Error('API_AUTH_REDIRECT_REJECTED'); const challenge = challengeResponse.data; validateChallenge(challenge, wallet); const signature = await signMessage(challenge.message); if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]+$/.test(signature)) throw new Error('API_AUTH_SIGNATURE_INVALID'); const verifiedResponse = await request('/api/v2/auth/verify', { method: 'POST', body: { challengeId: challenge.challengeId, wallet: getAddress(wallet), chainId: String(chainId), signature } }); const verified = verifiedResponse.data; session = { origin: LOCAL_ARC_API_ORIGIN, csrfToken: verified?.csrf, cookie: cookieFrom(verifiedResponse.headers) }; if (verified?.authenticated !== true || !session.csrfToken || !session.cookie || verified.wallet?.toLowerCase() !== getAddress(wallet).toLowerCase()) throw new Error('API_AUTH_SESSION_INVALID'); return Object.freeze({ authenticated: true }); },
    async readJob(jobId) { return (await request(`/api/v2/jobs/${encodeURIComponent(jobId)}`)).data; },
    async readAccount(wallet) { if (!isAddress(wallet)) throw new Error('ACCOUNT_ADDRESS_INVALID'); return (await request(`/api/v2/accounts/${encodeURIComponent(getAddress(wallet))}`)).data; },
    async postApplication({ jobId, application, signature, pitch = 'operator delivery' }) { return (await request(`/api/v2/jobs/${encodeURIComponent(jobId)}/applications`, { method: 'POST', csrf: true, body: { application: Object.fromEntries(Object.entries(application).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v])), signature, pitch }, idempotencyKey: `application-${jobId}-${application.operatorNonce}` })).data; },
    async postDeliveryManifest({ jobId, action, content, version, idempotencyKey }) { const revision = action === 'submitRevision'; const result = (await request(`/api/v2/jobs/${encodeURIComponent(jobId)}/deliveries`, { method: 'POST', csrf: true, body: { kind: revision ? 'revision' : 'delivery', revision, version: String(version), content }, idempotencyKey: idempotencyKey ?? `delivery-${jobId}-${version}` })).data; const delivery = result?.delivery; if (!delivery || String(delivery.jobId) !== String(jobId) || typeof delivery.blobHash !== 'string' || !HASH.test(delivery.blobHash)) throw new Error('DELIVERY_MANIFEST_INVALID'); return delivery; },
  });
}
