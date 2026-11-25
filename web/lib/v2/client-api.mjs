const API_ROOT = '/api/v2';

function assertPath(path) {
  if (typeof path !== 'string' || !path.startsWith(`${API_ROOT}/`) && path !== API_ROOT || path.includes('//') || path.includes('..') || /[?#]/.test(path)) throw new TypeError('v2Request requires a relative /api/v2 path');
  return path;
}

// Private job reads re-check the chain against the indexed row. Right after a
// wallet transaction the indexer can lag a few seconds and these GETs answer 503
// STALE_DATA/READER_UNAVAILABLE. Retry only those idempotent GETs, briefly.
const PRIVATE_JOB_READ = /^\/api\/v2\/jobs\/[^/]+\/(deliveries|decision-review|revision-notes|applications|application-context)$/;
const TRANSIENT_READ_ERRORS = new Set(['STALE_DATA', 'READER_UNAVAILABLE', 'INDEXER_UNAVAILABLE']);
export const V2_READ_RETRY_DELAYS_MS = Object.freeze([1500, 3000, 5000]);

export async function v2Request(path, options = {}) {
  const { method = 'GET', retryDelays = V2_READ_RETRY_DELAYS_MS, sleep = ms => new Promise(r => setTimeout(r, ms)) } = options;
  const retryable = method === 'GET' && typeof path === 'string' && PRIVATE_JOB_READ.test(path);
  for (let attempt = 0; ; attempt++) {
    try { return await v2RequestOnce(path, options); }
    catch (error) {
      if (!retryable || attempt >= retryDelays.length || error?.status !== 503 || !TRANSIENT_READ_ERRORS.has(error?.code)) throw error;
      await sleep(retryDelays[attempt]);
    }
  }
}

async function v2RequestOnce(path, { method = 'GET', body, csrfToken, idempotencyKey } = {}) {
  assertPath(path);
  if (method !== 'GET' && method !== 'POST') throw new TypeError('v2Request only permits GET and POST');
  const headers = { accept: 'application/json' };
  if (method === 'POST') {
    headers['content-type'] = 'application/json';
    if (csrfToken) headers['x-v2-csrf'] = csrfToken;
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  }
  let response;
  try {
    response = await fetch(path, { method, headers, credentials: 'same-origin', cache: 'no-store', body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined });
  } catch (cause) {
    const error = new Error('V2 API unavailable'); error.code = 'V2_API_UNAVAILABLE'; error.status = 0; error.cause = cause; throw error;
  }
  let payload = null;
  try { payload = await response.json(); } catch { payload = { error: 'INVALID_JSON' }; }
  if (!response.ok) { const error = new Error(payload?.error || `V2 API request failed (${response.status})`); error.code = payload?.error || 'V2_API_ERROR'; error.status = response.status; throw error; }
  return payload;
}

export const v2Paths = Object.freeze({ profile: '/api/v2/profile', health: '/api/v2/health', session: '/api/v2/auth/session', jobs: '/api/v2/jobs', account: (address) => `/api/v2/accounts/${address}`, resolver: '/api/v2/resolver', transaction: (hash, intent) => `/api/v2/transactions/${hash}?intent=${encodeURIComponent(intent)}` });
