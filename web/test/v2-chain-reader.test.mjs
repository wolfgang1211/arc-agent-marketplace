import test from 'node:test';
import assert from 'node:assert/strict';
import { ARC_TESTNET_PROFILE } from '../lib/v2/chain-profile.mjs';
import { createV2ChainReader } from '../lib/v2/server/chain-reader.mjs';

test('reader captures one block and reads code/storage/calls at that block', async () => {
  const seen = [];
  const transport = async (method, params) => {
    seen.push([method, params]);
    if (method === 'eth_blockNumber') return '0x2a';
    if (method === 'eth_getBlockByNumber') return { hash: `0x${'11'.repeat(32)}` };
    if (method === 'eth_chainId') return '0x4cef52';
    if (method === 'eth_getCode') return `0x${'60'.repeat(4)}`;
    if (method === 'eth_getStorageAt') return `0x${'00'.repeat(32)}`;
    if (method === 'eth_call') return `0x${'00'.repeat(32)}`;
    throw new Error('unexpected');
  };
  const reader = createV2ChainReader({ transport, chainId: 5042002n, marketplace: '0xFA156B7A5205B123c8a22A807ba98405e36130f1', vault: '0xD5B271b7Bf4696d662B2bcB1a94b408887c6C423' });
  await assert.rejects(() => reader.read(), /runtime/);
  assert.equal(new Set(seen.filter(x => ['eth_getCode', 'eth_getStorageAt', 'eth_call'].includes(x[0])).map(x => x[1].at(-1))).size, 1);
});

test('an explicit profile rejects contradictory chain, address, token, treasury, or local overrides before RPC', () => {
  let calls = 0;
  const transport = async () => { calls += 1; return '0x1'; };
  const local = { chainId: 31337n, marketplace: '0x0000000000000000000000000000000000000001', vault: '0x0000000000000000000000000000000000000002', token: '0x0000000000000000000000000000000000000003', treasury: '0x0000000000000000000000000000000000000004', localTestConfig: true };
  assert.throws(() => createV2ChainReader({ transport, profile: ARC_TESTNET_PROFILE, ...local }), /profile deployment mismatch/);
  assert.throws(() => createV2ChainReader({ transport, profile: ARC_TESTNET_PROFILE, token: '0x0000000000000000000000000000000000000003' }), /profile deployment mismatch/);
  assert.throws(() => createV2ChainReader({ transport, profile: ARC_TESTNET_PROFILE, treasury: '0x0000000000000000000000000000000000000004' }), /profile deployment mismatch/);
  assert.equal(calls, 0);
});

test('reader rejects a wrong chain before any contract reads', async () => {
  const methods = [];
  const transport = async method => { methods.push(method); if (method === 'eth_blockNumber') return '0x1'; if (method === 'eth_getBlockByNumber') return { hash: `0x${'11'.repeat(32)}` }; if (method === 'eth_chainId') return '0x1'; return '0x01'; };
  const reader = createV2ChainReader({ transport, chainId: 5042002n, marketplace: '0xFA156B7A5205B123c8a22A807ba98405e36130f1', vault: '0xD5B271b7Bf4696d662B2bcB1a94b408887c6C423' });
  await assert.rejects(() => reader.read(), /chain/);
  assert.deepEqual(methods, ['eth_blockNumber', 'eth_getBlockByNumber', 'eth_chainId']);
});
