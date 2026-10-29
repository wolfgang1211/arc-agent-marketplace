import { keccak256, stringToHex } from 'viem';

export const JOB_ACTIONS = Object.freeze([
  'awardJob', 'submitDelivery', 'submitRevision', 'approve', 'requestRevision', 'openDispute', 'resolveDispute', 'postJob',
  'proposeMutual', 'acceptMutual', 'rejectMutual', 'revokeMutual', 'withdrawStake', 'timeoutClaim',
]);
export const STATUS = Object.freeze({ open: 0, inprogress: 1, submitted: 2, revisionpending: 3, accessrecovery: 4, disputed: 5, completed: 6, refunded: 7, cancelled: 8 });

export function normalizeStatus(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 8) return value;
  if (typeof value === 'string' && /^(?:[0-8])$/.test(value)) return Number(value);
  const key = String(value ?? '').replace(/[_ -]/g, '').toLowerCase();
  return Object.prototype.hasOwnProperty.call(STATUS, key) ? STATUS[key] : null;
}
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
export function canonicalAddress(value) {
  if (typeof value !== 'string' || !ADDRESS.test(value)) return null;
  const address = value.toLowerCase();
  return address === ZERO_ADDRESS ? null : address;
}
export function jobRole(job, wallet) {
  if (!job) return null;
  const address = canonicalAddress(wallet);
  if (!address) return null;
  if (canonicalAddress(job.client) === address) return 'client';
  if (canonicalAddress(job.operator) === address) return 'operator';
  if (canonicalAddress(job.resolver) === address) return 'resolver';
  return null;
}
export function availableActions(job, wallet) {
  const role = jobRole(job, wallet); const status = normalizeStatus(job?.status);
  if (!role || status == null) return [];
  const actions = [];
  if (role === 'client' && status === STATUS.open && !canonicalAddress(job.operator)) actions.push('awardJob');
  if (role === 'operator' && status === STATUS.inprogress) actions.push('submitDelivery');
  if (role === 'operator' && status === STATUS.revisionpending) actions.push('submitRevision');
  if (role === 'client' && [STATUS.submitted, STATUS.revisionpending].includes(status)) actions.push('approve');
  if (role === 'client' && status === STATUS.submitted) actions.push('requestRevision');
  if ((role === 'client' || role === 'operator') && [1, 2, 3, 4].includes(status)) actions.push('openDispute');
  if (role === 'resolver' && status === STATUS.disputed) actions.push('resolveDispute');
  const mutual = job?.mutual ?? job?.data?.mutual;
  if ((role === 'client' || role === 'operator') && mutual?.proposable === true) actions.push('proposeMutual');
  const mutualVersion = job?.mutualRequestVersion ?? job?.data?.mutualRequestVersion ?? mutual?.version;
  if ((role === 'client' || role === 'operator') && mutualVersion != null) actions.push('acceptMutual', 'rejectMutual', 'revokeMutual');
  if ((role === 'client' || role === 'resolver') && status === STATUS.open && job?.timeout?.openJobClaimable === true) actions.push('claimOpenJobTimeout');
  if (role === 'operator' && status === STATUS.inprogress && job?.timeout?.deliveryClaimable === true) actions.push('claimDeliveryTimeout');
  return actions;
}

export function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}
export function documentHash(value) { return keccak256(stringToHex(canonicalize(value))); }
export function normalizeCriteria(value) { return String(value ?? '').split('\n').map((line) => line.trim()).filter(Boolean); }
export function usdcToUnits(value) {
  const text = String(value ?? '').trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(text)) throw new Error('Enter a USDC amount with up to 6 decimal places.');
  const [whole, fraction = ''] = text.split('.'); return (BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0') || '0')).toString();
}
export function utcDateToSeconds(value) {
  if (typeof value !== 'string' || !value) throw new Error('Choose an apply-by date and time.');
  const time = Date.parse(/(?:Z|[+-]\d\d:?\d\d)$/.test(value) ? value : `${value}Z`); if (!Number.isFinite(time)) throw new Error('Enter a valid UTC apply-by date and time.');
  return Math.floor(time / 1000).toString();
}
