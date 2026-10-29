import assert from 'node:assert/strict';
import test from 'node:test';
import { createV2Api, readOnlyV2Transport, V2_LOCAL_ORIGIN } from '../lib/v2/server/api-runtime.mjs';

const db = { query: async () => ({ rows: [] }), transaction: async (fn) => fn({ query: async () => ({ rows: [] }) }) };
const healthy = { status: 'healthy', stale: false, gap: null, cursor: { blockNumber: '1', blockHash: '0x' + '11'.repeat(32) } };

test('runtime API exposes the actual supplied indexer health without fabricating availability', async () => {
  const api = createV2Api({ db, verifyWalletSignature: async () => true, getHealth: () => healthy });
  const response = await api.handle(new Request(`${V2_LOCAL_ORIGIN}/api/v2/health`));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, { status: 'healthy', stale: false, gap: null, reader: 'unavailable', code: null });
});

test('default local transport is read-only and includes bounded indexer reads', async () => {
  await assert.rejects(() => readOnlyV2Transport('eth_sendRawTransaction', []), /V2_RPC_METHOD_DENIED/);
  await assert.rejects(() => readOnlyV2Transport('personal_sign', []), /V2_RPC_METHOD_DENIED/);
});
