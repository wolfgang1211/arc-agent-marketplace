import test from 'node:test';
import assert from 'node:assert/strict';
import { proveAccountReadback } from '../lib/v2/server/api-read.mjs';

const wallet = '0x1111111111111111111111111111111111111111';
const before = { freeStake: '100', reservedStake: '5', credits: '9', stakeLiability: '105', tokenBalance: '1000', creditsLiability: '20' };

function intent(action, expected) {
  return { expected: { action, wallet, ...expected }, snapshot: { balances: before } };
}

test('account readback proves stake and token deltas and does not echo omitted chain fields', () => {
  const deposited = proveAccountReadback(intent('depositStake', { freeStake: '107', reservedStake: '5', stakeLiabilityDelta: '7' }), { ...before, freeStake: '107', stakeLiability: '112', tokenBalance: '993' });
  assert.equal(deposited.stakeLiabilityDelta, '7');
  assert.equal(deposited.tokenBalance, '993');
  assert.equal(proveAccountReadback(intent('depositStake', { freeStake: '107', reservedStake: '5', stakeLiabilityDelta: '7' }), { freeStake: '107', reservedStake: '5' }), null);

  const withdrawn = proveAccountReadback(intent('withdrawStake', { freeStake: '60', reservedStake: '5', stakeLiabilityDelta: '-40', walletTokenIncrease: '40' }), { ...before, freeStake: '60', stakeLiability: '65', tokenBalance: '1040' });
  assert.equal(withdrawn.freeStake, '60');
  assert.equal(withdrawn.walletTokenIncrease, '40');
  assert.equal(proveAccountReadback(intent('withdrawStake', { freeStake: '100', reservedStake: '5', stakeLiabilityDelta: '-40', walletTokenIncrease: '40' }), before), null);

  const credit = proveAccountReadback(intent('withdrawCredit', { credits: '0', walletTokenIncrease: '9', liabilityDecrease: '9' }), { ...before, credits: '0', tokenBalance: '1009', creditsLiability: '11' });
  assert.equal(credit.liabilityDecrease, '9');
  assert.equal(proveAccountReadback(intent('withdrawCredit', { credits: '0', walletTokenIncrease: '9', liabilityDecrease: '9' }), { ...before, credits: '0' }), null);
});
