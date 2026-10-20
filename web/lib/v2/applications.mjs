import { hashTypedData, recoverTypedDataAddress, isAddress, isHex } from 'viem';

export const APPLICATION_TYPES = { Application: [
  { name: 'jobId', type: 'uint256' }, { name: 'operator', type: 'address' }, { name: 'termsHash', type: 'bytes32' },
  { name: 'validAfter', type: 'uint64' }, { name: 'validBefore', type: 'uint64' }, { name: 'nonceEpoch', type: 'uint256' }, { name: 'operatorNonce', type: 'uint256' }
] };
export const APPLICATION_DOMAIN = { name: 'AlphaBoard Agent Marketplace V2', version: '1' };
const U64_MAX = (1n << 64n) - 1n;
const U256_MAX = (1n << 256n) - 1n;
const HEX32 = /^0x[0-9a-fA-F]{64}$/;
function requiredObject(value, name) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} required`); return value; }
function uint(value, name, max = U256_MAX) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new TypeError(`${name} must be a safe integer`);
  if (typeof value !== 'bigint' && typeof value !== 'number') throw new TypeError(`${name} must be integer`);
  const n = BigInt(value); if (n < 0n || (max !== null && n > max)) throw new RangeError(`${name} out of range`); return n;
}
function address(value, name) { if (typeof value !== 'string' || !isAddress(value, { strict: true })) throw new TypeError(`${name} must be address`); return value; }
function bytes32(value, name) { if (typeof value !== 'string' || !HEX32.test(value)) throw new TypeError(`${name} must be bytes32`); return value; }
export function applicationDomain(chainId, verifyingContract) {
  const chain = uint(chainId, 'chainId');
  if (chain !== 5042002n && chain !== 31337n) throw new Error('unsupported chain');
  address(verifyingContract, 'verifying contract');
  return { ...APPLICATION_DOMAIN, chainId: chain, verifyingContract };
}
function canonicalApplicationDomain(domain) {
  const canonical = applicationDomain(domain.chainId, domain.verifyingContract);
  if ('name' in domain && domain.name !== canonical.name) throw new Error('domain name mismatch');
  if ('version' in domain && domain.version !== canonical.version) throw new Error('domain version mismatch');
  return canonical;
}
export function buildApplication(input) {
  const value = requiredObject(input, 'application');
  return { jobId: uint(value.jobId, 'jobId'), operator: address(value.operator, 'operator'), termsHash: bytes32(value.termsHash, 'termsHash'), validAfter: uint(value.validAfter, 'validAfter', U64_MAX), validBefore: uint(value.validBefore, 'validBefore', U64_MAX), nonceEpoch: uint(value.nonceEpoch, 'nonceEpoch'), operatorNonce: uint(value.operatorNonce, 'operatorNonce') };
}
export function hashApplication(input, domain) {
  const value = buildApplication(input); const d = requiredObject(domain, 'domain');
  return hashTypedData({ domain: canonicalApplicationDomain(d), types: APPLICATION_TYPES, primaryType: 'Application', message: value });
}
export async function recoverApplicationSigner(input, domain, signature) {
  if (!isHex(signature) || signature.length !== 132) throw new TypeError('invalid signature');
  const d = requiredObject(domain, 'domain');
  return recoverTypedDataAddress({ domain: canonicalApplicationDomain(d), types: APPLICATION_TYPES, primaryType: 'Application', message: buildApplication(input), signature });
}
export function validateApplication(input, expected) {
  const e = requiredObject(expected, 'expected binding');
  for (const key of ['expectedJobId', 'expectedOperator', 'currentTermsHash', 'now', 'applyBy', 'currentNonceEpoch', 'currentOperatorNonce']) if (!(key in e) || e[key] === undefined) throw new TypeError(`missing ${key}`);
  const a = buildApplication(input);
  if (a.jobId !== uint(e.expectedJobId, 'expectedJobId') || a.operator.toLowerCase() !== address(e.expectedOperator, 'expectedOperator').toLowerCase()) throw new Error('job binding');
  if (a.termsHash.toLowerCase() !== bytes32(e.currentTermsHash, 'currentTermsHash').toLowerCase()) throw new Error('terms binding');
  const now = uint(e.now, 'now'); const applyBy = uint(e.applyBy, 'applyBy');
  if (a.validAfter >= a.validBefore || now < a.validAfter || now >= a.validBefore || a.validBefore > applyBy || now >= applyBy) throw new Error('invalid window');
  if (a.nonceEpoch !== uint(e.currentNonceEpoch, 'currentNonceEpoch')) throw new Error('nonce epoch');
  if (a.operatorNonce !== uint(e.currentOperatorNonce, 'currentOperatorNonce')) throw new Error('operator nonce');
  return a;
}

// This helper only recovers an EOA signer; it does not prove ERC-1271 or admission.
export async function recoverApplicationEOASigner(input, domain, signature) { return recoverApplicationSigner(input, domain, signature); }

// ERC-1271 is intentionally an injected, read-only capability: callers provide the pinned read.
export async function validateApplicationERC1271(operator, digest, signature, readSignature) {
  address(operator, 'operator'); bytes32(digest, 'digest');
  if (typeof readSignature !== 'function') throw new TypeError('ERC1271 read required');
  if (!isHex(signature)) throw new TypeError('invalid signature');
  try {
    const result = await readSignature(operator, digest, signature);
    return typeof result === 'string' && /^0x1626ba7e$/i.test(result);
  } catch {
    return false;
  }
}
