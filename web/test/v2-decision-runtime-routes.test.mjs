import test from 'node:test';
import assert from 'node:assert/strict';
import { createV2Api } from '../lib/v2/server/api-runtime.mjs';
const origin = 'http://127.0.0.1:3102';
for (const kind of ['revision-notes', 'decision-review']) {
  test(`runtime routes ${kind} to its private authentication boundary`, async () => {
    let writes = 0;
    const api = createV2Api({ origin, verifyWalletSignature: async () => false, db: { async query() { throw new Error('Unauthenticated read must not reach storage'); }, async transaction() { writes++; throw new Error('Unexpected write'); } }, readerFactory: () => { throw new Error('Unauthenticated read must not use RPC'); }, getHealth: async () => ({ status: 'healthy', stale: false, gap: null }) });
    const response = await api.handle(new Request(`${origin}/api/v2/jobs/7/${kind}`));
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'INVALID_SESSION' });
    assert.equal(writes, 0);
  });
}
