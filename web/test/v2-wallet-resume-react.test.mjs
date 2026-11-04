import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { encodeFunctionData, keccak256 } from 'viem';
import manifest from '../lib/v2/action-manifest.json' with { type: 'json' };
import TestRenderer, { act } from 'react-test-renderer';
import { useWalletExecution, storageKey } from '../lib/v2/new-wallet-execution.mjs';

const wallet = '0x1111111111111111111111111111111111111111';
const profile = { id: 'arc', chainId: '5042002', rpcUrl: 'https://rpc.invalid', marketplace: '0xfa156b7a5205b123c8a22a807ba98405e36130f1', vault: '0xd5b271b7bf4696d662b2bcB1a94b408887c6C423', usdc: '0x2222222222222222222222222222222222222222' };
const hash = `0x${'45'.repeat(32)}`;
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
for (const mode of ['remount', 'callback-change']) {
  test(`resume UI survives ${mode} while one canonical readback is in flight`, async () => {
    const previous = { storage: globalThis.localStorage, provider: globalThis.ethereum };
    const map = new Map();
    globalThis.localStorage = { get length() { return map.size; }, key: i => [...map.keys()][i] ?? null, getItem: k => map.get(k) ?? null, setItem: (k,v) => map.set(k,String(v)), removeItem: k => map.delete(k) };
    const data = encodeFunctionData({ abi: manifest.contracts.marketplace.abi, functionName: 'approve', args: [7n, 3n] });
    const stored = { intentId: `ui-${mode}`, profileId: profile.id, chainId: profile.chainId, wallet, action: 'approve', kind: 'main', to: profile.marketplace, calldataHash: keccak256(data), status: 'broadcast', hash, autoResume: true, expected: { stateVersion: '4' } };
    localStorage.setItem(storageKey(stored), JSON.stringify(stored));
    let sends = 0, readbacks = 0, release;
    const refreshes = [];
    globalThis.ethereum = { request: async ({method}) => {
      if (method === 'eth_accounts') return [wallet];
      if (method === 'eth_chainId') return `0x${BigInt(profile.chainId).toString(16)}`;
      if (method === 'eth_getTransactionByHash') return { hash, from: wallet, to: profile.marketplace, input: data, chainId: `0x${BigInt(profile.chainId).toString(16)}`, value: '0x0', blockHash: `0x${'ab'.repeat(32)}`, blockNumber: '0x11', transactionIndex: '0x0', nonce: '0x1', gas: '0x186a0', gasPrice: '0x1', type: '0x0', v: '0x1b', r: `0x${'01'.repeat(32)}`, s: `0x${'02'.repeat(32)}` };
      if (method === 'eth_getTransactionReceipt') return { status: '0x1', transactionHash: hash, blockNumber: '0x11' };
      if (method === 'eth_sendTransaction') { sends++; throw new Error('Resume must never send'); }
      throw new Error('Unexpected read-only method');
    }};
    const gate = new Promise(resolve => { release = resolve; });
    const readback = async () => { readbacks++; return gate; };
    function Probe({ refresh }) { const execution = useWalletExecution({ profile, readback, onRefresh: refresh }); return React.createElement('output', { 'data-result': execution.value?.phase || execution.phase }); }
    let renderer;
    try {
      await act(async () => { renderer = TestRenderer.create(React.createElement(Probe, { refresh: () => refreshes.push(1) })); await settle(); });
      assert.equal(readbacks, 1);
      if (mode === 'remount') {
        await act(async () => { renderer.unmount(); });
        await act(async () => { renderer = TestRenderer.create(React.createElement(Probe, { refresh: () => refreshes.push(2) })); await settle(); });
      } else await act(async () => { renderer.update(React.createElement(Probe, { refresh: () => refreshes.push(2) })); await settle(); });
      assert.notEqual(renderer.root.findByType('output').props['data-result'], 'success');
      await act(async () => { release({ ok: true, confirmed: true, intentId: stored.intentId, profileId: profile.id, chainId: profile.chainId, wallet, action: stored.action, hash, state: { stateVersion: '4' } }); await settle(); });
      assert.equal(renderer.root.findByType('output').props['data-result'], 'success');
      assert.deepEqual(refreshes, [2]);
      assert.equal(readbacks, 1);
      assert.equal(sends, 0);
      assert.equal(map.size, 0);
    } finally {
      release(null);
      if (renderer) await act(async () => renderer.unmount());
      if (previous.storage === undefined) delete globalThis.localStorage; else globalThis.localStorage = previous.storage;
      if (previous.provider === undefined) delete globalThis.ethereum; else globalThis.ethereum = previous.provider;
    }
  });
}
