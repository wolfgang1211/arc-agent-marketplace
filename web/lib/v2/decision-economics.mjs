const UINT256_MAX = (1n << 256n) - 1n;
export const ZERO = '0';
export const ZERO_ECONOMICS = Object.freeze({ grossPayout: ZERO, refund: ZERO, fee: ZERO, operatorNet: ZERO, clientCredit: ZERO, treasuryCredit: ZERO, stakeReleased: ZERO, stakeRetained: ZERO, stakeSlashed: ZERO });
export function uint(value, name = 'amount') {
  if (typeof value === 'bigint' && value >= 0n && value <= UINT256_MAX) return value;
  if (typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/.test(value)) { const n = BigInt(value); if (n <= UINT256_MAX) return n; }
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  throw new TypeError(`invalid ${name}`);
}
const out = (n) => n.toString();
export function calculateDecisionEconomics(job, { grossPayout = '0', operatorFault = false, mode = 'dispute', slash = '0' } = {}) {
  if (!job || typeof job !== 'object') throw new TypeError('job required');
  const reward = uint(job.reward, 'reward'); const stake = uint(job.stakeReserved, 'stakeReserved'); const feeBps = uint(job.feeBpsSnapshot, 'feeBpsSnapshot');
  if (feeBps > 10000n) throw new RangeError('fee out of range');
  if (mode === 'fault-review') {
    const slashed = uint(slash, 'slash'); if (slashed > stake) throw new RangeError('slash out of range');
    return { ...ZERO_ECONOMICS, clientCredit: out(slashed), stakeReleased: out(stake - slashed), stakeRetained: ZERO, stakeSlashed: out(slashed), slashRecipient: job.client, releaseRecipient: job.operator, conservation: { reward: ZERO, credits: out(slashed), stake: out(stake - slashed), total: out(stake) } };
  }
  const payout = uint(grossPayout, 'grossPayout'); if (payout > reward) throw new RangeError('payout out of range');
  if (operatorFault && (payout === reward || stake === 0n || !job.operator || /^0x0{40}$/i.test(String(job.operator)))) throw new RangeError('invalid operator fault');
  const refund = reward - payout; const fee = payout * feeBps / 10000n; const operatorNet = payout - fee; const slashed = operatorFault ? stake : 0n;
  // _settle skips collateral release while an existing fault review is pending.
  const retained = !operatorFault && job.faultReviewPending === true ? stake : 0n;
  const released = operatorFault ? 0n : stake - retained;
  const reservedStakeDelta = retained > 0n ? 0n : -stake;
  return { grossPayout: out(payout), refund: out(refund), fee: out(fee), operatorNet: out(operatorNet), clientCredit: out(refund + slashed), treasuryCredit: out(fee), stakeReleased: out(released), stakeRetained: out(retained), stakeSlashed: out(slashed), marketBalanceDelta: out(slashed), vaultBalanceDelta: out(-slashed), escrowDelta: out(-reward), creditsLiabilityDelta: out(reward + slashed), stakeLiabilityDelta: out(-slashed), freeStakeDelta: out(released), reservedStakeDelta: out(reservedStakeDelta), activeJobsDelta: '-1', statusAfter: String(payout === 0n ? 7 : 6), slashRecipient: operatorFault ? job.client : null, releaseRecipient: operatorFault || retained > 0n ? null : job.operator, conservation: { reward: out(reward), credits: out(refund + slashed + operatorNet + fee), escrowReleased: out(reward), stakeBefore: out(stake), stakeAfter: out(stake - slashed), totalBefore: out(reward + stake), totalAfter: out(refund + slashed + operatorNet + fee + (stake - slashed)) } };
}
