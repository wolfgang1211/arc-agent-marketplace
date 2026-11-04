import { keccak256, stringToHex } from 'viem';

export const JOB_ACTIONS = Object.freeze([
  'awardJob', 'cancelOpenJob', 'submitDelivery', 'submitRevision', 'approve', 'requestRevision', 'openDispute', 'resolveDispute', 'postJob',
  'proposeMutual', 'acceptMutual', 'rejectMutual', 'revokeMutual', 'withdrawStake', 'timeoutClaim',
]);
export const STATUS = Object.freeze({ open: 0, inprogress: 1, submitted: 2, revisionpending: 3, accessrecovery: 4, disputed: 5, completed: 6, refunded: 7, cancelled: 8 });
export const JOB_CATEGORIES = Object.freeze([
  Object.freeze({ label: 'Website', value: 'website' }),
  Object.freeze({ label: 'Bot', value: 'bot' }),
  Object.freeze({ label: 'Tool', value: 'tool' }),
  Object.freeze({ label: 'Video', value: 'video' }),
  Object.freeze({ label: 'Research', value: 'research' }),
  Object.freeze({ label: 'Design', value: 'design' }),
  Object.freeze({ label: 'Other', value: 'other' }),
]);
const CATEGORY_VALUES = new Set(JOB_CATEGORIES.map(({ value }) => value));
export function normalizeCategory(value) {
  const key = String(value ?? '').trim().toLowerCase();
  if (key === 'gamebot' || key === 'game bot' || key === 'game') return 'bot';
  return CATEGORY_VALUES.has(key) ? key : 'other';
}
export function categoryLabel(value) {
  const legacy = String(value ?? '').trim().toLowerCase();
  if (legacy === 'gamebot' || legacy === 'game bot' || legacy === 'game') return 'Game bot';
  const canonical = normalizeCategory(value);
  return JOB_CATEGORIES.find(({ value: candidate }) => candidate === canonical)?.label || 'Other';
}

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
function pushTimeouts(actions, job, wallet, status) {
  if (!canonicalAddress(wallet)) return;
  if (status === STATUS.open && job?.timeout?.openJobClaimable === true) actions.push('claimOpenJobTimeout');
  if (status === STATUS.inprogress && job?.timeout?.deliveryClaimable === true) actions.push('claimDeliveryTimeout');
}
export function availableActions(job, wallet) {
  const role = jobRole(job, wallet); const status = normalizeStatus(job?.status);
  if (status == null) return [];
  const actions = [];
  if (!role) { pushTimeouts(actions, job, wallet, status); return actions; }
  if (role === 'client' && status === STATUS.open && !canonicalAddress(job.operator)) actions.push('awardJob', 'cancelOpenJob');
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
  pushTimeouts(actions, job, wallet, status);
  return actions;
}

export function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}
export function documentHash(value) { return keccak256(stringToHex(canonicalize(value))); }
export function normalizeCriteria(value) { return String(value ?? '').split('\n').map((line) => line.trim()).filter(Boolean); }
export function normalizeTags(value) { return String(value ?? '').split(',').map((tag) => tag.trim()).filter(Boolean); }
export function durationToSeconds(value, unit = 'hours') {
  const text = String(value ?? '').trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text) || Number(text) <= 0) throw new Error('Enter a positive duration.');
  const multiplier = unit === 'days' ? 86400 : unit === 'hours' ? 3600 : null;
  if (!multiplier) throw new Error('Choose hours or days.');
  const seconds = Number(text) * multiplier;
  if (!Number.isSafeInteger(seconds)) throw new Error('Duration must resolve to whole seconds.');
  return String(seconds);
}
export function usdcToUnits(value) {
  const text = String(value ?? '').trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(text)) throw new Error('Enter a USDC amount with up to 6 decimal places.');
  const [whole, fraction = ''] = text.split('.'); return (BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0') || '0')).toString();
}
export function unitsToUsdc(value) {
  const text = String(value ?? '');
  if (!/^(?:0|[1-9]\d*)$/.test(text)) throw new Error('Invalid USDC base units.');
  const n = BigInt(text);
  const fraction = String(n % 1000000n).padStart(6, '0').replace(/0+$/, '');
  return String(n / 1000000n) + (fraction ? '.' + fraction : '');
}
export function utcDateToSeconds(value) {
  if (typeof value !== 'string' || !value) throw new Error('Choose an apply-by date and time.');
  const time = Date.parse(/(?:Z|[+-]\d\d:?\d\d)$/.test(value) ? value : `${value}Z`); if (!Number.isFinite(time)) throw new Error('Enter a valid UTC apply-by date and time.');
  return Math.floor(time / 1000).toString();
}
export function formatUtcDate(value) {
  const date = value instanceof Date ? value : new Date(Number(value) * 1000);
  if (!Number.isFinite(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }).format(date).replace(',', ',');
}
export function formatRelativeDate(value, now = Date.now()) {
  const target = value instanceof Date ? value.getTime() : Number(value) * 1000;
  if (!Number.isFinite(target)) return '—';
  const days = Math.round((target - (now instanceof Date ? now.getTime() : now)) / 86400000);
  if (days === 0) return 'today';
  return days > 0 ? `in ${days} day${days === 1 ? '' : 's'}` : `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`;
}
