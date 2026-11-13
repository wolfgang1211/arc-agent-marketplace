import { getAddress, isAddress } from 'viem';

export const ARC_TESTNET_CHAIN_ID = 5042002n;
export const YUSUF_CLIENT = getAddress('0x460EBe282Fb0e42B4d682a7f9EF408302417F780');
export const TEST_OPERATOR = getAddress('0x7c3A84C2F23B50Cd7A70A597641776475abb59e7');
export const EFFECTIVE_RESOLVER_OWNER = getAddress('0xf5e14962e46f80faa40570bd86BccE83AA6626fF');
export const MAX_REWARD_USDC6 = 5_000_000n;
export const MAX_DEPOSIT_USDC6 = 5_000_000n;
export const OPERATOR_ACTIONS = Object.freeze(['apply', 'submitDelivery', 'submitRevision', 'proposeMutual', 'acceptMutual', 'rejectMutual', 'openDispute', 'depositStake', 'withdrawStake', 'withdrawCredit']);
export const RESOLUTION_ACTIONS = Object.freeze(['resolveDispute', 'resolveFaultReview']);
export const ALLOWED_ACTIONS = Object.freeze([...OPERATOR_ACTIONS, ...RESOLUTION_ACTIONS]);
const lower = (value) => String(value).toLowerCase();
const address = (value, code) => { if (typeof value !== 'string' || !isAddress(value)) throw new Error(code); return getAddress(value); };
const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value, (_, v) => typeof v === 'bigint' ? `${v}n` : v));
function canonical(value) {
  if (typeof value === 'bigint') return `${value}n`;
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function assertCanonicalJob(job, { chainId, jobId } = {}) {
  if (BigInt(chainId) !== ARC_TESTNET_CHAIN_ID) throw new Error('CANONICAL_CHAIN_MISMATCH');
  if (jobId !== undefined && BigInt(jobId) < 1n) throw new Error('JOB_ID_REQUIRED');
  const client = address(job?.client, 'CANONICAL_JOB_CLIENT');
  if (client !== YUSUF_CLIENT) throw new Error('CANONICAL_JOB_CLIENT_MUST_BE_YUSUF');
  const reward = BigInt(job?.reward ?? -1); if (reward < 0n || reward > MAX_REWARD_USDC6) throw new Error('REWARD_CAP_EXCEEDED');
  return Object.freeze({ client, reward });
}
export function assertActionRole(action, signer, { testOperator = TEST_OPERATOR, effectiveResolver = EFFECTIVE_RESOLVER_OWNER, jobOperator } = {}) {
  const who = address(signer, 'SIGNER_REQUIRED'); if (who === YUSUF_CLIENT) throw new Error('YUSUF_SIGNER_FORBIDDEN');
  if (OPERATOR_ACTIONS.includes(action)) { if (who !== TEST_OPERATOR || testOperator !== undefined && address(testOperator, 'TEST_OPERATOR_REQUIRED') !== TEST_OPERATOR) throw new Error('OPERATOR_NOT_VERIFIED_PUBLIC_ROLE'); if (jobOperator && lower(jobOperator) !== lower(who)) throw new Error('OPERATOR_NOT_CANONICAL_JOB_PARTY'); return Object.freeze({ role: 'operator', signer: who }); }
  if (RESOLUTION_ACTIONS.includes(action)) { if (who !== EFFECTIVE_RESOLVER_OWNER || effectiveResolver !== undefined && address(effectiveResolver, 'EFFECTIVE_RESOLVER') !== EFFECTIVE_RESOLVER_OWNER) throw new Error('RESOLVER_NOT_EFFECTIVE_JOB_RESOLVER'); return Object.freeze({ role: 'resolver', signer: who }); }
  throw new Error('UNSUPPORTED_ACTION');
}
export function assertDepositAmount(amount) { if (!/^(0|[1-9][0-9]*)$/.test(String(amount))) throw new Error('DEPOSIT_AMOUNT_INVALID'); const value = BigInt(String(amount)); if (value > MAX_DEPOSIT_USDC6) throw new Error('DEPOSIT_CAP_EXCEEDED'); return value; }
export function requireFreshChatRequest(request, action, expected = {}, { now = Date.now() } = {}) {
  if (!request || typeof request !== 'object' || request.automatic === true || request.scheduler === true || request.action !== action || typeof request.requestId !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(request.requestId) || request.fresh !== true) throw new Error('FRESH_SPECIFIC_CHAT_REQUEST_REQUIRED');

  if (!Number.isSafeInteger(request.expiresAt) || request.expiresAt <= now) throw new Error('CHAT_REQUEST_EXPIRED');
  if (expected.jobId !== undefined && String(request.jobId) !== String(expected.jobId)) throw new Error('CHAT_REQUEST_JOB_MISMATCH');
  if (expected.params !== undefined && canonical(request.params) !== canonical(expected.params)) throw new Error('CHAT_REQUEST_PARAMS_MISMATCH');
  return Object.freeze({ requestId: request.requestId, action, jobId: request.jobId, expiresAt: request.expiresAt, params: clone(request.params) });
}
export function consumeChatRequest() { throw new Error('DURABLE_AUTHORIZATION_REQUIRED'); }
export function assertNoSecrets(value) { const text = JSON.stringify(value ?? ''); if (/(private.?key|password|seed|mnemonic|keystore|signature)/i.test(text)) throw new Error('SECRET_BEARING_VALUE_FORBIDDEN'); }