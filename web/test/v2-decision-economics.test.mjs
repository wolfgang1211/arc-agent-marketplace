import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateDecisionEconomics } from '../lib/v2/decision-economics.mjs';
const base = { reward:'1000', feeBpsSnapshot:'500', stakeReserved:'200', operator:'0x2222222222222222222222222222222222222222', client:'0x1111111111111111111111111111111111111111' };
test('economics are exact for zero partial full payout and fault', () => {
  assert.deepEqual(calculateDecisionEconomics(base,{grossPayout:'0',operatorFault:false}), {...calculateDecisionEconomics(base,{grossPayout:'0',operatorFault:false}), grossPayout:'0',refund:'1000',fee:'0',operatorNet:'0',clientCredit:'1000',stakeReleased:'200',stakeSlashed:'0'});
  const partial=calculateDecisionEconomics(base,{grossPayout:'400',operatorFault:false}); assert.deepEqual(Object.fromEntries(Object.entries(partial).filter(([k])=>['refund','fee','operatorNet','clientCredit','stakeReleased','stakeSlashed'].includes(k))),{refund:'600',fee:'20',operatorNet:'380',clientCredit:'600',stakeReleased:'200',stakeSlashed:'0'});
  const fault=calculateDecisionEconomics(base,{grossPayout:'0',operatorFault:true}); assert.equal(fault.clientCredit,'1200'); assert.equal(fault.stakeSlashed,'200'); assert.equal(fault.stakeReleased,'0');
  assert.throws(()=>calculateDecisionEconomics(base,{grossPayout:'1000',operatorFault:true}),/invalid operator fault/);
});
test('missing or malformed economics never default to zero',()=>{ assert.throws(()=>calculateDecisionEconomics({...base,feeBpsSnapshot:undefined},{grossPayout:'0'})); assert.throws(()=>calculateDecisionEconomics(base,{grossPayout:'1001'})); });

test('parity witness matches approved executor effects for zero partial full and fault cases', async () => {
  const { createRequire } = await import('node:module'); const require = createRequire(import.meta.url);
  const { effects } = require('../../contract/scripts/approved-v2-resolve.js');
  const j = { reward:1000n, feeBpsSnapshot:500n, stakeReserved:200n, client:base.client, operator:base.operator };
  for (const [grossPayout, operatorFault] of [['0',false],['400',false],['1000',false],['0',true]]) {
    if (operatorFault === true && grossPayout === '1000') continue;
    const actual = calculateDecisionEconomics({...base}, { grossPayout, operatorFault });
    const expected = effects(j, { kind:'resolveDispute', grossPayout:BigInt(grossPayout), operatorFault });
    assert.deepEqual({ payout:actual.grossPayout, refund:actual.refund, fee:actual.fee, operatorCredit:actual.operatorNet, clientCredit:actual.clientCredit, slash:actual.stakeSlashed, marketBalanceDelta:actual.marketBalanceDelta, vaultBalanceDelta:actual.vaultBalanceDelta, escrowDelta:actual.escrowDelta, creditsLiabilityDelta:actual.creditsLiabilityDelta, stakeLiabilityDelta:actual.stakeLiabilityDelta, freeStakeDelta:actual.freeStakeDelta, reservedStakeDelta:actual.reservedStakeDelta, activeJobsDelta:actual.activeJobsDelta, statusAfter:actual.statusAfter }, Object.fromEntries(Object.entries(expected).map(([k,v])=>[k,String(v)])));
  }
});
test('existing fault review retains stake on nonfault settle',()=>{const result=calculateDecisionEconomics({...base,faultReviewPending:true},{grossPayout:'400',operatorFault:false});assert.equal(result.stakeReleased,'0');assert.equal(result.stakeRetained,'200');assert.equal(result.reservedStakeDelta,'0');});
