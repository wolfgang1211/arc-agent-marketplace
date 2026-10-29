const STATUS_DEFINITIONS = Object.freeze([
  ['Open', 'Open', 'open'],
  ['InProgress', 'In progress', 'active'],
  ['Submitted', 'Submitted', 'active'],
  ['RevisionPending', 'Revision pending', 'active'],
  ['AccessRecovery', 'Access recovery', 'active'],
  ['Disputed', 'Disputed', 'active'],
  ['Completed', 'Completed', 'closed'],
  ['Refunded', 'Refunded', 'closed'],
  ['Cancelled', 'Cancelled', 'closed'],
].map(([name, label, group], code) => Object.freeze({ code, name, label, group })));

const STATUS_BY_CODE = new Map(STATUS_DEFINITIONS.map((status) => [status.code, status]));
const STATUS_BY_NAME = new Map();
for (const status of STATUS_DEFINITIONS) {
  for (const value of [status.name, status.label]) {
    STATUS_BY_NAME.set(value.toLowerCase().replace(/[\s_-]/g, ''), status);
  }
}

function statusCode(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== 'string') return null;
  if (/^(?:0|[1-8])$/.test(value)) return Number(value);
  return null;
}

export function normalizeStatus(value) {
  const code = statusCode(value);
  if (code !== null) return STATUS_BY_CODE.get(code) || null;
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase().replace(/[\s_-]/g, '');
  return key ? STATUS_BY_NAME.get(key) || null : null;
}

export function statusGroup(value) {
  return normalizeStatus(value)?.group || 'unknown';
}

export function statusLabel(value) {
  return normalizeStatus(value)?.label || 'Unknown';
}

export function isV2Healthy(health) {
  const data = health?.data && typeof health.data === 'object' ? health.data : health;
  return Boolean(data && data.status === 'healthy' && data.stale === false && data.gap == null);
}

export function readJobs(payload) {
  const items = payload?.data?.items;
  return Array.isArray(items) ? items : [];
}

export function readJob(payload) {
  const data = payload?.data;
  return data && typeof data === 'object' && !Array.isArray(data) && !Array.isArray(data.items) ? data : null;
}

export { STATUS_DEFINITIONS };
