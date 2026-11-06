import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import React, { act } from 'react';
import TestRenderer from 'react-test-renderer';
import { JobActionPanel, JobCreationForm } from '../app/v2/_components/action-panels.js';

const session = { authenticated: true, wallet: '0x1111111111111111111111111111111111111111', csrf: 'csrf' };
const health = { data: { status: 'healthy', stale: false, gap: null } };
globalThis.ethereum = { selectedAddress: session.wallet, request: async ({ method }) => method === 'eth_accounts' ? [session.wallet] : [session.wallet] };
const job = {
  jobId: '7', stateVersion: '3', reward: '1000000', status: '1',
  client: '0x2222222222222222222222222222222222222222',
  operator: session.wallet, resolver: '0x3333333333333333333333333333333333333333',
  mutual: { proposable: true },
};

test('public checkbox has a narrow layout hook and remains checked by default', async () => {
  const source = fs.readFileSync(new URL('../app/v2/v2.css', import.meta.url), 'utf8');
  assert.match(source, /\.v2-public-check\s+input\[type=["']checkbox["']\]/);
  assert.match(source, /\.v2-public-check\s+input\[type=["']checkbox["']\][^{]*\{[^}]*width:\s*18px[^}]*height:\s*18px/s);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ policy: { minReward: '1', feeBps: '100' }, source: {}, client: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
  let renderer;
  try {
    renderer = TestRenderer.create(React.createElement(JobCreationForm, { session, health }));
    await act(async () => {});
    const checkbox = renderer.root.findByProps({ type: 'checkbox' });
    assert.equal(checkbox.props.checked, true);
    assert.equal(checkbox.parent.props.className, 'v2-field v2-check v2-public-check');
    assert.equal(checkbox.parent.children[1].children.join(''), 'Make this job public');
  } finally {
    renderer?.unmount();
    globalThis.fetch = originalFetch;
  }
});

test('proposal expiry defaults three days from the current clock and preserves edits across renders', async () => {
  const originalNow = Date.now;
  const fixedNow = Date.parse('2026-11-06T09:07:41.000Z');
  Date.now = () => fixedNow;
  let renderer;
  try {
    renderer = TestRenderer.create(React.createElement(JobActionPanel, { job, session, health }));
    const expiry = renderer.root.findByProps({ name: 'mutualExpiry' });
    assert.equal(expiry.props.value, '2026-11-09T09:07');
    await act(async () => expiry.props.onChange('2026-12-01T12:30'));
    renderer.update(React.createElement(JobActionPanel, { job, session, health }));
    assert.equal(renderer.root.findByProps({ name: 'mutualExpiry' }).props.value, '2026-12-01T12:30');
    const expiryLabel = renderer.root.findAllByType('span').find((node) => node.children.join('') === 'Proposal expires (UTC) *');
    assert.ok(expiryLabel, 'proposal expiry label should match the visible form field');
  } finally {
    renderer?.unmount();
    Date.now = originalNow;
  }
});
