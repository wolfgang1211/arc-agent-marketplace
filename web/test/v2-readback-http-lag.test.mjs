import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { encodeFunctionData, keccak256 } from 'viem';
import manifest from '../lib/v2/action-manifest.json' with { type: 'json' };
import { createPgliteDb, migrate } from '../lib/v2/server/db.mjs';
import { createV2ReadApi } from '../lib/v2/server/api-read.mjs';
import { ARC_TESTNET_PROFILE as profile } from '../lib/v2/chain-profile.mjs';
import { defaultReadback, assertReadbackIdentity, storageKey } from '../lib/v2/new-wallet-execution.mjs';
import { AccountActionPanel } from '../app/v2/_components/action-panels.js';

// Offline fixtures only. No public-chain send, real user authentication or wallet.
const wallet = '0x1111111111111111111111111111111111111111';
const hash = `0x${'ab'.repeat(32)}`;
const blockHash = `0x${'cd'.repeat(32)}`;
const intentId = '00000000-0000-4000-8000-000000000001';
const data = encodeFunctionData({ abi: manifest.contracts.marketplace.abi, functionName: 'registerOperator', args: [] });
const expected = { action: 'registerOperator', wallet, registered: true };
const healthy = { status: 'healthy', stale: false, gap: null };

test('offline loopback HTTP: actual transaction handler waits for canonical DB catch-up then proves registration', async () => {
  const db = await createPgliteDb({ dataDir: 'memory://' });
  await migrate(db);
  const intent = { intentId, profile: profile.name, chainId: String(profile.canonicalChainId), wallet, action: 'registerOperator', expected, transaction: { from: wallet, to: profile.marketplace, value: '0', data } };
  await db.query('INSERT INTO v2_audit_events(id,actor_wallet,event_type,entity_type,entity_id,payload) VALUES($1,$2,$3,$4,$5,$6)', [intentId, wallet, 'transaction.intent.prepared', 'transaction-intent', intentId, intent]);
  const requests = [];
  const api = createV2ReadApi({ db, profile, getHealth: () => healthy, auth: { authenticateRequest: async () => ({ wallet }) },
    transport: async (method) => {
      if (method === 'eth_getTransactionReceipt') return { status: '0x1', transactionHash: hash, blockNumber: '0x64', blockHash, from: wallet, to: profile.marketplace, logs: [] };
      if (method === 'eth_getTransactionByHash') return { from: wallet, to: profile.marketplace, value: '0x0', input: data, chainId: '0x4cef52' };
      throw new Error('Unexpected transport method');
    },
    readerFactory: ({ toBlockTag }) => ({ read: async () => { assert.equal(toBlockTag, '0x64'); return { chainId: profile.canonicalChainId, blockHash, readAccount: async (address) => { assert.equal(address, wallet); return { registered: true }; } }; } }),
  });
  let origin;
  const server = createServer(async (request, response) => {
    try {
      requests.push(request.method);
      const result = await api(new Request(origin + request.url, { method: request.method }));
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(await result.text());
    } catch { response.writeHead(500); response.end('{}'); }
  });
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
    const statuses = [];
    const nativeFetch = globalThis.fetch;
    const result = await defaultReadback(hash, intentId, { timeoutMs: 5000, intervalMs: 1, fetcher: async (url, init) => {
      const response = await nativeFetch(origin + url, init);
      statuses.push(response.status);
      if (statuses.length === 1) {
        assert.equal(response.status, 503);
        assert.equal((await response.clone().json()).error, 'INDEXER_UNAVAILABLE');
        await db.query('INSERT INTO v2_indexer_blocks_fork(chain_id,stream,block_number,block_hash,parent_hash,transaction_count,canonical) VALUES($1,$2,$3,$4,$5,$6,TRUE)', [String(profile.canonicalChainId), 'marketplace', '100', blockHash, `0x${'ef'.repeat(32)}`, 1]);
        await db.query('INSERT INTO v2_indexer_cursors(chain_id,marketplace,cursor) VALUES($1,$2,$3)', [String(profile.canonicalChainId), profile.marketplace, JSON.stringify({ blockNumber: '100', blockHash })]);
      }
      return response;
    } });
    assert.deepEqual(statuses, [503, 200]);
    assert.deepEqual(requests, ['GET', 'GET']);
    assert.equal(assertReadbackIdentity(result, { ...intent, profileId: profile.name }, hash).confirmed, true);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM v2_audit_events')).rows[0].n, 1);
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await db.close();
  }
});

test('real AccountActionPanel preserves action/hash after a hard verification failure instead of Action: draft', async () => {
  const previous = { fetch: globalThis.fetch, provider: globalThis.ethereum, storage: globalThis.localStorage };
  const map = new Map();
  const clientProfile = { id: profile.name, chainId: String(profile.canonicalChainId), rpcUrl: profile.rpcUrl, marketplace: profile.marketplace, vault: profile.vault, usdc: profile.usdc };
  const stored = { intentId, profileId: profile.name, chainId: clientProfile.chainId, wallet, action: 'registerOperator', expected, status: 'broadcast', hash, to: profile.marketplace, calldataHash: keccak256(data), autoResume: true, resumeAttempts: 0 };
  globalThis.localStorage = { get length() { return map.size; }, key: (i) => [...map.keys()][i], getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
  globalThis.localStorage.setItem(storageKey(stored), JSON.stringify(stored));
  const requests = [];
  globalThis.ethereum = { request: async ({ method }) => {
    requests.push(method);
    if (method === 'eth_accounts') return [wallet];
    if (method === 'eth_chainId') return '0x4cef52';
    if (method === 'eth_getTransactionByHash') return { hash, from: wallet, to: profile.marketplace, input: data, value: '0x0', chainId: '0x4cef52' };
    if (method === 'eth_getTransactionReceipt') return { status: '0x1', transactionHash: hash };
    throw new Error('Resume must never request a signature or send');
  } };
  globalThis.fetch = async (url) => url === '/api/v2/profile' ? new Response(JSON.stringify({ profile: clientProfile })) : new Response(JSON.stringify({ error: 'READBACK_MISMATCH' }), { status: 409 });
  let renderer;
  try {
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(AccountActionPanel, { account: { operator: { registered: true } }, session: { authenticated: true, wallet, csrf: 'fixture' }, health: { data: healthy } }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const rendered = JSON.stringify(renderer.toJSON());
    assert.ok(rendered.includes(hash));
    assert.ok(rendered.includes('Action: registerOperator'));
    assert.ok(!rendered.includes('Action: draft'));
    assert.ok(!rendered.includes('Transaction confirmed.'));
    assert.ok(rendered.includes('Do not submit again'));
    assert.equal(map.size, 1);
    assert.ok(!requests.some((method) => /send|sign/i.test(method)));
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    globalThis.fetch = previous.fetch;
    if (previous.provider === undefined) delete globalThis.ethereum; else globalThis.ethereum = previous.provider;
    if (previous.storage === undefined) delete globalThis.localStorage; else globalThis.localStorage = previous.storage;
  }
});
