import assert from 'node:assert/strict';
import test from 'node:test';
import { v2Request } from '../lib/v2/client-api.mjs';

test('v2 client keeps API requests same-origin and uint values serialized as strings', async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (path, init) => { request = { path, init }; return new Response(JSON.stringify({ data: { amount: '9007199254740993' } }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  try {
    const result = await v2Request('/api/v2/jobs', { method: 'POST', body: { amount: '9007199254740993' }, csrfToken: 'csrf-real', idempotencyKey: 'draft-1' });
    assert.equal(result.data.amount, '9007199254740993');
    assert.equal(request.path, '/api/v2/jobs');
    assert.equal(request.init.credentials, 'same-origin');
    assert.equal(request.init.cache, 'no-store');
    assert.equal(request.init.headers['x-v2-csrf'], 'csrf-real');
    assert.equal(request.init.headers['idempotency-key'], 'draft-1');
    assert.deepEqual(JSON.parse(request.init.body), { amount: '9007199254740993' });
  } finally { globalThis.fetch = originalFetch; }
});

test('v2 client rejects non-v2 paths and exposes API error codes', async () => {
  await assert.rejects(() => v2Request('/api/v1/jobs'), /relative \/api\/v2 path/);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'READER_UNAVAILABLE' }), { status: 503 });
  try { await assert.rejects(v2Request('/api/v2/health'), (error) => error.code === 'READER_UNAVAILABLE' && error.status === 503); }
  finally { globalThis.fetch = originalFetch; }
});
