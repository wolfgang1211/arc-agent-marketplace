import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { WalletSessionControl } from '../app/v2/_components/action-panels.js';

const account = '0x460EBe282Fb0e42B4d682a7f9EF408302417F780';
const otherAccount = '0xD632648b649bD09198047388d150fF408165CC29';
const target = 5042002n;
const hex = `0x${target.toString(16)}`;
const profile = { id: 'arc-testnet', chainId: String(target), rpcUrl: 'https://rpc.testnet.arc.io', marketplace: account, vault: account, usdc: account };

async function connect({ initial = '0x1', switchError, staysWrong = false, afterAccount = account } = {}) {
  const previousFetch = globalThis.fetch;
  const previousProvider = globalThis.ethereum;
  const calls = [];
  let chain = initial;
  let switched = false;
  let renderer;
  globalThis.fetch = async (url) => {
    assert.equal(url, '/api/v2/profile');
    return { ok: true, json: async () => ({ profile }) };
  };
  globalThis.ethereum = { isRabby: true, request: async ({ method, params }) => {
    calls.push({ method, params });
    if (method === 'eth_requestAccounts') return [account];
    if (method === 'eth_accounts') return [switched ? afterAccount : account];
    if (method === 'eth_chainId') return chain;
    if (method === 'wallet_switchEthereumChain') {
      if (switchError) throw Object.assign(new Error('Switch failed'), { code: switchError });
      switched = true;
      if (!staysWrong) chain = params[0].chainId;
      return null;
    }
    throw new Error(`Forbidden wallet request: ${method}`);
  } };
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(WalletSessionControl, { session: null })); });
    await act(async () => { await renderer.root.findByProps({ 'data-testid': 'wallet-connect' }).props.onClick(); });
    const signin = renderer.root.findAllByProps({ 'data-testid': 'wallet-signin' }).length === 1;
    const alerts = renderer.root.findAllByProps({ role: 'alert' }).map((node) => node.children.join(''));
    const rendered = JSON.stringify(renderer.toJSON());
    assert.ok(calls.every(({ method }) => ['eth_requestAccounts', 'eth_accounts', 'eth_chainId', 'wallet_switchEthereumChain'].includes(method)), 'connection must never sign or send');
    return { calls, signin, alerts, rendered };
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    globalThis.fetch = previousFetch;
    if (previousProvider === undefined) delete globalThis.ethereum; else globalThis.ethereum = previousProvider;
  }
}

test('V2 Rabby connect requests Arc then verifies the resulting network before enabling sign-in', async () => {
  const result = await connect();
  assert.deepEqual(result.calls.filter(({ method }) => method === 'wallet_switchEthereumChain'), [{ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] }]);
  assert.equal(result.signin, true);
  assert.deepEqual(result.alerts, []);
  const switchIndex = result.calls.findIndex(({ method }) => method === 'wallet_switchEthereumChain');
  assert.ok(result.calls.slice(switchIndex + 1).some(({ method }) => method === 'eth_chainId'));
});
test('V2 already on Arc connects without a needless switch', async () => {
  const result = await connect({ initial: hex });
  assert.equal(result.signin, true);
  assert.equal(result.calls.filter(({ method }) => method === 'wallet_switchEthereumChain').length, 0);
});
test('V2 rejected network switch stays disconnected and explains cancellation', async () => {
  const result = await connect({ switchError: 4001 });
  assert.equal(result.signin, false);
  assert.match(result.alerts.join(' '), /cancelled|rejected/i);
});
test('V2 missing network stays disconnected and explains adding the selected network', async () => {
  const result = await connect({ switchError: 4902 });
  assert.equal(result.signin, false);
  assert.match(result.alerts.join(' '), /add.*network/i);
});
test('V2 unsupported network switching stays disconnected with a specific instruction', async () => {
  const result = await connect({ switchError: 4200 });
  assert.equal(result.signin, false);
  assert.match(result.alerts.join(' '), /switch.*network.*wallet/i);
});
test('V2 switch success without chain readback confirmation fails closed', async () => {
  const result = await connect({ staysWrong: true });
  assert.equal(result.signin, false);
  assert.match(result.alerts.join(' '), /network/i);
});
test('V2 connect uses the fresh selected account after a network switch', async () => {
  const result = await connect({ afterAccount: otherAccount });
  assert.equal(result.signin, true);
  assert.ok(result.rendered.includes(otherAccount));
  assert.ok(!result.rendered.includes(account));
});
test('V2 account disappearing during a switch cannot enable sign-in', async () => {
  const result = await connect({ afterAccount: '' });
  assert.equal(result.signin, false);
  assert.ok(result.alerts.length > 0);
});
