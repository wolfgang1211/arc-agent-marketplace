import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalTermsHash, V2_TERMS_SCHEMA } from '../lib/v2/terms.mjs';

test('canonical terms hash matches Solidity abi.encode field order', () => {
  const terms = {
    token: '0x3600000000000000000000000000000000000000',
    vault: '0xD5B271b7Bf4696d662B2bcB1a94b408887c6C423',
    resolver: '0x0000000000000000000000000000000000000002',
    reward: 1000000n, feeBps: 500n,
    treasury: '0x0000000000000000000000000000000000000003', minReward: 1000000n,
    deliveryDuration: 3600n, reviewDuration: 86400n, revisionDuration: 43200n,
    maxExtensionTotal: 180n * 86400n, stakeFloor: 5000000n, stakeRound: 10000n,
    collateralBps: 1000n, schema: V2_TERMS_SCHEMA, revisionLimit: 2,
    unlimitedRevisions: false, applyBy: 2000000000n,
    criteriaHash: `0x${'11'.repeat(32)}`, descriptionHash: `0x${'22'.repeat(32)}`, testJob: true
  };
  assert.equal(canonicalTermsHash(terms), '0x0a402ff7652545498a591e4c480ec6d0a2cf13142e08e014f98d793e824d6e30');
});

test('terms reject floats, unsafe numbers, and malformed bytes32', () => {
  const base = { token: '0x3600000000000000000000000000000000000000', vault: '0x0000000000000000000000000000000000000001', resolver: '0x0000000000000000000000000000000000000002', treasury: '0x0000000000000000000000000000000000000003', reward: 1n, feeBps: 1n, minReward: 1n, deliveryDuration: 1n, reviewDuration: 1n, revisionDuration: 1n, maxExtensionTotal: 1n, stakeFloor: 1n, stakeRound: 1n, collateralBps: 1n, schema: V2_TERMS_SCHEMA, revisionLimit: 1, unlimitedRevisions: false, applyBy: 1n, criteriaHash: `0x${'11'.repeat(32)}`, descriptionHash: `0x${'22'.repeat(32)}`, testJob: false };
  assert.throws(() => canonicalTermsHash({ ...base, reward: 1.5 }), /integer/);
  assert.throws(() => canonicalTermsHash({ ...base, reward: Number.MAX_SAFE_INTEGER + 1 }), /safe integer/);
  assert.throws(() => canonicalTermsHash({ ...base, criteriaHash: '0x12' }), /bytes32/);
});
