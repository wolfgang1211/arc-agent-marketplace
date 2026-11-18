import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { createPgliteDb, migrate } from '../lib/v2/server/db.mjs';
import { createV2ReadApi } from '../lib/v2/server/api-read.mjs';
import { AccountActionPanel } from '../app/v2/_components/action-panels.js';

const wallet = '0xD632648b649bD09198047388d150fF408165CC29';
const blockHash = `0x${'ab'.repeat(32)}`;
const healthy = { status: 'healthy', stale: false, gap: null };
const canonicalPath = `/api/v2/accounts/${wallet}/canonical`;
const baseAccount = { registered: false, maxActiveJobs: 0n, activeJobs: 0n, credits: 0n, freeStake: 0n, reservedStake: 0n };
const baseSnapshot = { chainId: 5042002n, blockTag: '0x64', blockHash };

test('canonical account route with a real empty PGlite projection', async (t) => {
  const db = await createPgliteDb({ dataDir: 'memory://' });
  await migrate(db);
  const make = ({ account = baseAccount, snapshot = baseSnapshot, health = () => healthy, failRead = false, missingReader = false, failAccount = false } = {}) => {
    let reads = 0;
    const api = createV2ReadApi({ db, getHealth: health, readerFactory: missingReader ? undefined : () => ({ read: async () => {
      reads += 1;
      if (failRead) throw new Error('private RPC diagnostics must not escape');
      return { ...snapshot, readAccount: async (address) => {
        assert.equal(address, wallet);
        if (failAccount) throw new Error('snapshot changed');
        return account;
      } };
    } }) });
    const call = async (path = canonicalPath) => {
      const response = await api(new Request(`http://127.0.0.1:3102${path}`));
      return { status: response.status, body: await response.json(), headers: response.headers };
    };
    return { call, reads: () => reads };
  };
  try {
    await t.test('the legacy account projection stays null and performs no chain read', async () => {
      const f = make(); const result = await f.call(`/api/v2/accounts/${wallet}`);
      assert.equal(result.status, 200);
      assert.equal(result.body.data.operator, null);
      assert.equal(result.body.data.credits, null);
      assert.equal(f.reads(), 0);
    });
    await t.test('a new wallet gets proven false/zero values and block provenance, without DB writes', async () => {
      const f = make(); const result = await f.call();
      assert.equal(result.status, 200);
      assert.equal(result.headers.get('cache-control'), 'no-store');
      assert.deepEqual(result.body.data, { address: wallet, operator: { stateVersion: null, registered: false, maxActiveJobs: '0', activeJobs: '0' }, credits: { balance: '0', free: '0', reserved: '0', stateVersion: null }, source: { block: '100', hash: blockHash } });
      for (const table of ['v2_operator_projection', 'v2_credit_projection', 'v2_audit_events']) {
        assert.equal((await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n, 0);
      }
      let renderer;
      try {
        await act(async () => { renderer = TestRenderer.create(React.createElement(AccountActionPanel, { account: result.body.data, session: { authenticated: true, wallet, csrf: 'fixture' }, health: { data: healthy } })); });
        const button = renderer.root.findAllByType('button').find((node) => node.children.join('') === 'Register operator');
        assert.ok(button);
        assert.equal(button.props.disabled, false);
      } finally { if (renderer) await act(async () => renderer.unmount()); }
    });
    await t.test('registered accounts and large amounts use current canonical values on every request', async () => {
      const account = { ...baseAccount, registered: true, maxActiveJobs: 4n, activeJobs: 2n, credits: 9007199254740993n, freeStake: 5000000n, reservedStake: 1000000n };
      const f = make({ account }); const first = await f.call();
      assert.equal(first.status, 200);
      assert.equal(first.body.data.operator.registered, true);
      assert.equal(first.body.data.credits.balance, '9007199254740993');
      account.freeStake = 7000000n;
      assert.equal((await f.call()).body.data.credits.free, '7000000');
      assert.equal(f.reads(), 2);
    });
    await t.test('stale health blocks the read without requesting a snapshot', async () => {
      const f = make({ health: () => ({ ...healthy, stale: true }) });
      assert.equal((await f.call()).status, 503); assert.equal(f.reads(), 0);
    });
    await t.test('health turning stale during a read cannot return actionable data', async () => {
      let checks = 0;
      const f = make({ health: () => (++checks === 1 ? healthy : { ...healthy, stale: true }) });
      assert.equal((await f.call()).status, 503);
    });
    for (const [name, options] of [
      ['missing reader', { missingReader: true }],
      ['snapshot failure', { failRead: true }],
      ['account or snapshot guard failure', { failAccount: true }],
      ['wrong chain', { snapshot: { ...baseSnapshot, chainId: 1n } }],
      ['missing source hash', { snapshot: { ...baseSnapshot, blockHash: undefined } }],
      ['malformed source block', { snapshot: { ...baseSnapshot, blockTag: 'latest' } }],
      ['unknown registration', { account: { ...baseAccount, registered: null } }],
      ['missing collateral', { account: { ...baseAccount, freeStake: undefined } }],
      ['negative credit', { account: { ...baseAccount, credits: -1n } }],
      ['unsafe numeric balance', { account: { ...baseAccount, credits: Number.MAX_SAFE_INTEGER + 1 } }],
    ]) await t.test(`${name} returns unavailable, never fabricated account defaults`, async () => {
      const result = await make(options).call();
      assert.equal(result.status, 503);
      assert.equal(result.body.data, undefined);
      assert.ok(!JSON.stringify(result.body).includes('private RPC diagnostics'));
    });
    await t.test('canonical route rejects extra query parameters and malformed addresses', async () => {
      const f = make();
      assert.equal((await f.call(`${canonicalPath}?limit=1`)).status, 400);
      assert.equal((await f.call('/api/v2/accounts/bad/canonical')).status, 400);
      assert.equal(f.reads(), 0);
    });
  } finally { await db.close(); }
});

test('Account page explicitly requests canonical account data, not the sparse projection', () => {
  const source = fs.readFileSync(new URL('../app/v2/account/page.js', import.meta.url), 'utf8');
  assert.ok(source.includes('`/api/v2/accounts/${wallet}/canonical`'));
});
