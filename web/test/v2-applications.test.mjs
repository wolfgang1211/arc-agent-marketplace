import test from 'node:test';
import assert from 'node:assert/strict';
import { APPLICATION_TYPES, applicationDomain, buildApplication, hashApplication, recoverApplicationSigner, validateApplication, validateApplicationERC1271 } from '../lib/v2/applications.mjs';

const market = '0x0fa156b7a5205b123c8a22a807ba98405e36130f';
const operator = '0x0000000000000000000000000000000000000004';
const termsHash = `0x${'33'.repeat(32)}`;
const base = { jobId: 7n, operator, termsHash, validAfter: 100n, validBefore: 200n, nonceEpoch: 0n, operatorNonce: 0n };

test('application fixture pins the exact domain and struct', () => {
  assert.deepEqual(applicationDomain(5042002n, market), { name: 'AlphaBoard Agent Marketplace V2', version: '1', chainId: 5042002n, verifyingContract: market });
  assert.deepEqual(APPLICATION_TYPES.Application, [
    { name: 'jobId', type: 'uint256' }, { name: 'operator', type: 'address' },
    { name: 'termsHash', type: 'bytes32' }, { name: 'validAfter', type: 'uint64' },
    { name: 'validBefore', type: 'uint64' }, { name: 'nonceEpoch', type: 'uint256' },
    { name: 'operatorNonce', type: 'uint256' }
  ]);
  assert.equal(buildApplication(base).operator, operator);
});

test('application digest binds domain, terms, epoch and nonce', () => {
  const digest = hashApplication(base, { chainId: 5042002n, verifyingContract: market });
  assert.match(digest, /^0x[0-9a-f]{64}$/);
  assert.notEqual(digest, hashApplication({ ...base, nonceEpoch: 1n }, { chainId: 5042002n, verifyingContract: market }));
});

test('application validation rejects replay and invalid windows', () => {
  const expected = { expectedOperator: operator, expectedJobId: 7n, currentTermsHash: termsHash, now: 150n, applyBy: 200n, currentNonceEpoch: 0n, currentOperatorNonce: 0n };
  assert.throws(() => validateApplication(base, { ...expected, expectedJobId: 8n }), /job/);
  assert.throws(() => validateApplication({ ...base, validBefore: 100n }, expected), /window/);
  assert.throws(() => validateApplication({ ...base, validBefore: 150n }, expected), /window/);
  assert.throws(() => validateApplication(base, { ...expected, currentNonceEpoch: 1n }), /epoch/);
  assert.throws(() => validateApplication(base, { ...expected, currentOperatorNonce: 1n }), /nonce/);
  assert.throws(() => validateApplication(base, { ...expected, currentNonceEpoch: undefined }), /missing/);
});

test('application rejects uint64 overflow, malformed addresses, and bad domains', () => {
  assert.throws(() => buildApplication({ ...base, validBefore: 2n ** 64n }), /range/);
  assert.throws(() => buildApplication({ ...base, jobId: 2n ** 256n }), /range/);
  assert.throws(() => buildApplication({ ...base, nonceEpoch: 2n ** 256n }), /range/);
  assert.throws(() => buildApplication({ ...base, operatorNonce: 2n ** 256n }), /range/);
  assert.throws(() => validateApplication(base, { expectedOperator: operator, expectedJobId: 2n ** 256n, currentTermsHash: termsHash, now: 150n, applyBy: 200n, currentNonceEpoch: 0n, currentOperatorNonce: 0n }), /range/);
  assert.throws(() => validateApplication(base, { expectedOperator: operator, expectedJobId: 7n, currentTermsHash: termsHash, now: 150n, applyBy: 200n, currentNonceEpoch: 2n ** 256n, currentOperatorNonce: 0n }), /range/);
  assert.throws(() => validateApplication(base, { expectedOperator: operator, expectedJobId: 7n, currentTermsHash: termsHash, now: 150n, applyBy: 200n, currentNonceEpoch: 0n, currentOperatorNonce: 2n ** 256n }), /range/);
  assert.throws(() => buildApplication({ ...base, operator: '0x1234' }), /address/);
  assert.throws(() => buildApplication({ ...base, jobId: '7' }), /integer/);
  assert.throws(() => applicationDomain(1n, market), /unsupported/);
});

test('application rejects supplied domain name and version mismatches', () => {
  assert.throws(() => hashApplication(base, { ...applicationDomain(5042002n, market), name: 'Wrong' }), /domain name/);
  assert.throws(() => hashApplication(base, { ...applicationDomain(5042002n, market), version: '2' }), /domain version/);
  assert.rejects(() => recoverApplicationSigner(base, { ...applicationDomain(5042002n, market), name: 'Wrong' }, `0x${'11'.repeat(65)}`), /domain name/);
});

test('ERC-1271 read failure is a safe invalid result without leaking the error', async () => {
  const secret = 'secret RPC payload';
  const result = await validateApplicationERC1271(operator, `0x${'44'.repeat(32)}`, `0x${'11'.repeat(65)}`, async () => { throw new Error(secret); });
  assert.equal(result, false);
});
