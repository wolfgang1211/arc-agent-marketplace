import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { AccountActionPanel, ApplicationPanel, DeliveryPanel, JobActionPanel, ResolverActionPanel, availableActions, documentHash, jobRole, uintString, hashString, stableIdempotencyKey } from '../app/v2/_components/action-panels.js';
import { normalizeCriteria, normalizeTags, durationToSeconds, usdcToUnits, unitsToUsdc, utcDateToSeconds } from '../lib/v2/ui-actions.mjs';

const session = { authenticated: true, wallet: '0x1111111111111111111111111111111111111111', csrf: 'csrf' };
const health = { data: { status: 'healthy', stale: false, gap: null } };
globalThis.ethereum = { selectedAddress: session.wallet, request: async ({ method }) => method === 'eth_accounts' ? [session.wallet] : [session.wallet] };
const job = { jobId: '7', stateVersion: '3', reward: '1000000', status: '5', client: '0x2222222222222222222222222222222222222222', resolver: session.wallet, termsHash: `0x${'a'.repeat(64)}` };

function findButton(renderer, label) { return renderer.root.findAllByType('button').find((node) => String(node.children.join('')) === label); }

test('strict uint and hash serializers preserve canonical strings', () => {
  assert.equal(uintString('0'), '0');
  assert.throws(() => uintString('000'), /whole-number/);
  assert.throws(() => uintString('1.0'));
  assert.throws(() => uintString('0', { allowZero: false }));
  assert.equal(hashString(`0x${'A'.repeat(64)}`), `0x${'a'.repeat(64)}`);
  assert.throws(() => hashString('0x12'));
  assert.match(stableIdempotencyKey('test'), /^test-/);
});

test('unknown API errors and local validation use a fixed safe fallback', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'UNKNOWN_ERROR_CODE secret-token-url' }), { status: 500, headers: { 'content-type': 'application/json' } });
  try {
    const renderer = TestRenderer.create(React.createElement(DeliveryPanel, { job: { ...job, status: '1', operator: session.wallet }, session, health }));
    await act(async () => {});
    const rendered = JSON.stringify(renderer.toJSON());
    assert.match(rendered, /The action could not be prepared\./);
    assert.doesNotMatch(rendered, /secret-token-url|UNKNOWN_ERROR_CODE/);
    renderer.unmount();

    const invalid = TestRenderer.create(React.createElement(ResolverActionPanel, { job, session, health }));
    await act(async () => invalid.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    const invalidRendered = JSON.stringify(invalid.toJSON());
    assert.match(invalidRendered, /The action could not be prepared\./);
    assert.doesNotMatch(invalidRendered, /Enter a 32-byte hex hash|Error:/);
    invalid.unmount();
  } finally { globalThis.fetch = originalFetch; }
});

test('openDispute derives the canonical expected version without a user field', async () => {
  const originalFetch = globalThis.fetch;
  let submitted;
  globalThis.fetch = async (_url, init) => { submitted = JSON.parse(init.body); return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  let renderer;
  try {
    renderer = TestRenderer.create(React.createElement(JobActionPanel, { job: { ...job, status: '1', operator: session.wallet }, session, health }));
    await act(async () => renderer.root.findByType('select').props.onChange({ target: { value: 'openDispute' } }));
    await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    assert.equal(submitted.action, 'openDispute');
    assert.equal(submitted.params.expected, '3');
    assert.equal(renderer.root.findAllByType('input').some(node => /expected|stateVersion/i.test(node.props.name || '')), false);
  } finally { renderer?.unmount(); globalThis.fetch = originalFetch; }
});

test('role/status matrix exposes only canonical actions', () => {
  const client = '0x2222222222222222222222222222222222222222';
  const operator = session.wallet;
  const resolver = '0x3333333333333333333333333333333333333333';
  const cases = [
    ['client open', { client, operator: null, resolver, status: 0 }, client, ['awardJob']],
    ['operator delivery', { client, operator, resolver, status: 1 }, operator, ['submitDelivery', 'openDispute']],
    ['client submitted', { client, operator, resolver, status: 2 }, client, ['approve', 'requestRevision', 'openDispute']],
    ['operator revision', { client, operator, resolver, status: 3 }, operator, ['submitRevision', 'openDispute']],
    ['resolver dispute', { client, operator, resolver, status: 5 }, resolver, ['resolveDispute']],
    ['wrong wallet', { client, operator, resolver, status: 1 }, '0x4444444444444444444444444444444444444444', []],
    ['outsider delivery timeout', { client, operator, resolver, status: 1, timeout: { deliveryClaimable: true } }, '0x4444444444444444444444444444444444444444', ['claimDeliveryTimeout']],
    ['operator delivery timeout', { client, operator, resolver, status: 1, timeout: { deliveryClaimable: true } }, operator, ['submitDelivery', 'openDispute', 'claimDeliveryTimeout']],
  ];
  for (const [label, value, wallet, expected] of cases) { assert.deepEqual(availableActions(value, wallet), expected, label); }
  assert.equal(jobRole({ client, operator, resolver }, client), 'client');
  assert.equal(jobRole({ client, operator, resolver }, operator), 'operator');
});

test('draft helpers preserve canonical document terms and human inputs', () => {
  assert.deepEqual(normalizeCriteria('  first  \n\n second\n'), ['first', 'second']);
  assert.deepEqual(normalizeTags('game, frontend, game'), ['game', 'frontend', 'game']);
  assert.equal(durationToSeconds('2', 'hours'), '7200');
  assert.equal(durationToSeconds('1.5', 'days'), '129600');
  assert.throws(() => durationToSeconds('1.1', 'minutes'));
  assert.equal(usdcToUnits('1.25'), '1250000');
  assert.equal(utcDateToSeconds('2026-01-01T00:00'), '1767225600');
  assert.equal(documentHash(['first', 'second']), documentHash(['first', 'second']));
  assert.throws(() => usdcToUnits('1.0000001'));
});

test('USDC display and wire conversions preserve exact fractional and large amounts', () => {
  for (const amount of ['0', '0.000001', '1', '25.123456', '1000000000000000000000000.123456']) assert.equal(unitsToUsdc(usdcToUnits(amount)), amount);
  assert.equal(unitsToUsdc('100000000'), '100');
  assert.throws(() => unitsToUsdc('-1'));
});

test('mutual proposal converts human USDC amounts and UTC expiry to canonical params', async () => {
  const originalFetch = globalThis.fetch;
  let submitted;
  globalThis.fetch = async (_url, init) => { submitted = JSON.parse(init.body); return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  let renderer;
  try {
    renderer = TestRenderer.create(React.createElement(JobActionPanel, { job: { ...job, status: '1', client: session.wallet, operator: '0x3333333333333333333333333333333333333333', resolver: '0x4444444444444444444444444444444444444444', mutual: { proposable: true } }, session, health }));
    await act(async () => renderer.root.findByType('select').props.onChange({ target: { value: 'proposeMutual' } }));
    for (const [name, value] of [['mutualRefund', '0.25'], ['grossPayout', '0.75'], ['mutualExpiry', '2026-12-15T17:00']]) await act(async () => renderer.root.findAllByType('input').find(input => input.props.name === name).props.onChange({ target: { value } }));
    await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    assert.deepEqual({ ...submitted.params, expiry: 'DATE' }, { refund: '250000', grossPayout: '750000', expiry: 'DATE', expected: '3' });
    assert.equal(new Date(Number(submitted.params.expiry) * 1000).toISOString(), '2026-12-15T17:00:00.000Z');
  } finally { renderer?.unmount(); globalThis.fetch = originalFetch; }
});

test('account actions are disabled fail-closed without session or healthy reader', () => {
  const renderer = TestRenderer.create(React.createElement(AccountActionPanel, { account: null, session: null, health: null }));
  assert.equal(renderer.root.findAllByType('button').every((node) => node.props.disabled), true);
  renderer.unmount();
  const stale = TestRenderer.create(React.createElement(AccountActionPanel, { account: null, session, health: { data: { status: 'healthy', stale: true, gap: null } } }));
  assert.equal(stale.root.findAllByType('button').every((node) => node.props.disabled), true);
});

test('resolver serializes explicit false operatorFault and uses unsigned preflight', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_path, options) => { calls.push(JSON.parse(options.body)); return new Response(JSON.stringify({ action: 'resolveDispute', transaction: { data: '0xabc' }, onchainStatus: 'not_submitted' }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  try {
    const renderer = TestRenderer.create(React.createElement(ResolverActionPanel, { job, session, health }));
    const inputs = renderer.root.findAllByType('input');
    for (const input of inputs) if (input.props.type !== 'checkbox') await act(async () => input.props.onChange({ target: { value: input.props.value || `0x${'b'.repeat(64)}` } }));
    await act(async () => findButton(renderer, 'Resolve dispute').props.onClick?.());
    const form = renderer.root.findByType('form');
    await act(async () => form.props.onSubmit({ preventDefault() {} }));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].action, 'resolveDispute');
    assert.equal(calls[0].params.operatorFault, false);
    assert.equal(calls[0].params.grossPayout, '1000000');
    assert.equal(calls[0].params.expected, '3');
    assert.equal(calls[0].params.reasonHash.length, 66);
    assert.equal(calls[0].params.evidenceHash.length, 66);
  } finally { globalThis.fetch = originalFetch; }
});

test('job action panel renders no wallet signing or transaction submission path', () => {
  const renderer = TestRenderer.create(React.createElement(JobActionPanel, { job, session, health }));
  const text = renderer.toJSON();
  const serialized = JSON.stringify(text);
  assert.match(serialized, /Available to the|No action is available/);
  assert.doesNotMatch(serialized, /eth_sendTransaction|eth_signTransaction|sendRawTransaction/);
});

test('zero-address operator is unassigned and award uses the private application API shape', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (path, options) => {
    calls.push({ path, body: options?.body ? JSON.parse(options.body) : null });
    if (options?.method === 'POST') return new Response(JSON.stringify({ action: 'awardJob', onchainStatus: 'not_submitted' }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ items: [{ id: 'app-1', jobId: '7', payload: { jobId: '7', operator: session.wallet }, signature: `0x${'11'.repeat(65)}` }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const openJob = { ...job, status: '0', operator: '0x0000000000000000000000000000000000000000', client: session.wallet };
  try {
    assert.deepEqual(availableActions(openJob, session.wallet), ['awardJob']);
    assert.equal(jobRole(openJob, session.wallet), 'client');
    const renderer = TestRenderer.create(React.createElement(ApplicationPanel, { job: openJob, session, health }));
    await act(async () => findButton(renderer, 'Load applications').props.onClick());
    await act(async () => renderer.root.findAllByType('button').find((node) => String(node.children.join('')).startsWith('Operator ')).props.onClick());
    await act(async () => findButton(renderer, 'Award job').props.onClick());
    assert.equal(calls[0].path, '/api/v2/jobs/7/applications');
    assert.equal(calls[1].path, '/api/v2/jobs/7/preflight');
    assert.deepEqual(calls[1].body, { action: 'awardJob', params: { expected: '3' }, application: { jobId: '7', operator: session.wallet }, signature: `0x${'11'.repeat(65)}` });
  } finally { globalThis.fetch = originalFetch; }
});

test('open applications are visible to an authenticated prospective operator', () => {
  const openJob = { ...job, status: '0', operator: '0x0000000000000000000000000000000000000000', client: '0x2222222222222222222222222222222222222222', resolver: '0x3333333333333333333333333333333333333333' };
  const renderer = TestRenderer.create(React.createElement(ApplicationPanel, { job: openJob, session, health }));
  assert.equal(findButton(renderer, 'Apply').props.disabled, false);
  assert.equal(renderer.root.findByProps({ 'data-testid': 'application-form' }).props['data-action'], 'application');
  renderer.unmount();
});

test('approve action supplies the canonical job version without an input', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_path, options) => { calls.push(JSON.parse(options.body)); return new Response(JSON.stringify({ action: 'approve', onchainStatus: 'not_submitted' }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  try {
    const clientSession = { ...session, wallet: '0x2222222222222222222222222222222222222222' };
    const renderer = TestRenderer.create(React.createElement(JobActionPanel, { job: { ...job, status: '2', client: clientSession.wallet, operator: session.wallet }, session: clientSession, health }));
    await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    assert.deepEqual(calls[0].params, { expected: '3' });
    assert.equal(renderer.root.findAllByType('input').some((node) => String(node.props.name || '').includes('expected')), false);
  } finally { globalThis.fetch = originalFetch; }
});

test('account registration reads nested operator.registered and posts an account action', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_path, options) => { calls.push(JSON.parse(options.body)); return new Response(JSON.stringify({ action: 'registerOperator', onchainStatus: 'not_submitted' }), { status: 200, headers: { 'content-type': 'application/json' } }); };
  try {
    const renderer = TestRenderer.create(React.createElement(AccountActionPanel, { account: { operator: { registered: false } }, session, health }));
    await act(async () => findButton(renderer, 'Register operator').props.onClick());
    assert.deepEqual(calls, [{ action: 'registerOperator', params: {} }]);
    renderer.unmount();
    const registered = TestRenderer.create(React.createElement(AccountActionPanel, { account: { operator: { registered: true } }, session, health }));
    assert.equal(findButton(registered, 'Register operator').props.disabled, true);
    registered.unmount();
    const malformed = TestRenderer.create(React.createElement(AccountActionPanel, { account: { operator: {} }, session, health }));
    assert.equal(findButton(malformed, 'Register operator').props.disabled, true);
  } finally { globalThis.fetch = originalFetch; }
});

test('delivery version is derived from private reader data and revision increments monotonically', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (path, options) => {
    calls.push({ path, body: options?.body ? JSON.parse(options.body) : null });
    if (options?.method === 'POST') return new Response(JSON.stringify({ delivery: { version: '2' } }), { status: 201, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ items: [{ id: 'd1', jobId: '7', version: '1', content: { result: 'one' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const operatorJob = { ...job, status: '3', operator: session.wallet };
  try {
    const renderer = TestRenderer.create(React.createElement(DeliveryPanel, { job: operatorJob, session, health }));
    await act(async () => {});
    const inputs = renderer.root.findAllByType('input');
    assert.equal(inputs.find((node) => node.props.name === 'version').props.value, '2');
    const select = renderer.root.findByType('select');
    assert.equal(select.props.value, 'revision');
    const textarea = renderer.root.findByType('textarea');
    await act(async () => textarea.props.onChange({ target: { value: '{"result":"two"}' } }));
    await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    assert.deepEqual(calls[0], { path: '/api/v2/jobs/7/deliveries', body: null });
    assert.equal(calls[1].path, '/api/v2/jobs/7/deliveries');
    assert.deepEqual(calls[1].body, { kind: 'revision', revision: true, version: '2', content: { result: 'two' } });
  } finally { globalThis.fetch = originalFetch; }
});



test('chip inputs serialize category and tags and keep keyboard edits out of form submit', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ policy: { minReward: '1', feeBps: '100' }, source: {}, client: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
  const { JobCreationForm } = await import('../app/v2/_components/action-panels.js');
  let renderer;
  try {
    renderer = TestRenderer.create(React.createElement(JobCreationForm, { session, health }));
    await act(async () => {});
    const tags = renderer.root.findByProps({ 'data-testid': 'tags' });
    await act(async () => tags.props.onChange({ target: { value: 'mobile,' } }));
    await act(async () => tags.props.onKeyDown({ key: 'Enter', preventDefault() {} }));
    const category = renderer.root.findByProps({ 'data-testid': 'category' });
    await act(async () => category.props.onKeyDown({ key: 'Enter', preventDefault() {} }));
    assert.equal(renderer.root.findAllByProps({ name: 'tags' }).at(-1).props.value, 'browser game,prototype,frontend,mobile');
    assert.equal(renderer.root.findAllByProps({ name: 'category' }).at(-1).props.value, 'Game');
    assert.equal(renderer.root.findAllByType('button').some((node) => node.props.type !== 'submit' && node.props['aria-label'] === 'Remove mobile'), true);
    await act(async () => tags.props.onChange({ target: { value: 'accessibility' } }));
    await act(async () => tags.props.onBlur());
    assert.equal(renderer.root.findAllByProps({ name: 'tags' }).at(-1).props.value, 'browser game,prototype,frontend,mobile,accessibility');
    let submitted = false;
    await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() { submitted = true; } }));
    assert.equal(submitted, true, 'form submit remains explicit and is not triggered by chip editing');
  } finally { renderer?.unmount(); globalThis.fetch = originalFetch; }
});

test('delivery form is absent unless the wallet is the operator in an active delivery status', () => {
  const cases = [
    [{ ...job, status: '0', operator: session.wallet }, false],
    [{ ...job, status: '2', operator: session.wallet }, false],
    [{ ...job, status: '1', operator: '0x2222222222222222222222222222222222222222' }, false],
    [{ ...job, status: '1', operator: session.wallet }, true],
    [{ ...job, status: '3', operator: session.wallet }, true],
  ];
  for (const [value, visible] of cases) {
    const renderer = TestRenderer.create(React.createElement(DeliveryPanel, { job: value, session, health }));
    assert.equal(Boolean(renderer.root.findAllByProps({ 'data-testid': 'delivery-form' }).length), visible, `${value.status}/${value.operator}`);
    renderer.unmount();
  }
});

test('successful empty application load shows empty state, while disconnected actions show only connect wallet', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  const clientJob = { ...job, status: '0', operator: '0x0000000000000000000000000000000000000000', client: session.wallet };
  let renderer;
  try {
    renderer = TestRenderer.create(React.createElement(ApplicationPanel, { job: clientJob, session, health }));
    await act(async () => renderer.root.findByType('button').props.onClick());
    assert.match(JSON.stringify(renderer.toJSON()), /No applications yet/);
    renderer.unmount();
    const provider = globalThis.ethereum;
    delete globalThis.ethereum;
    const disconnected = TestRenderer.create(React.createElement(JobActionPanel, { job: { ...job, status: '1', operator: session.wallet }, session, health }));
    assert.equal(disconnected.root.findByProps({ 'data-testid': 'job-action-connect' }).children.join(''), 'Connect wallet');
    assert.doesNotMatch(JSON.stringify(disconnected.toJSON()), /Continue/);
    disconnected.unmount();
    globalThis.ethereum = provider;
  } finally { renderer?.unmount(); globalThis.fetch = originalFetch; }
});

test('next action follows provider account and disconnect events and removes listeners', async () => {
  const previous = globalThis.ethereum;
  const listeners = new Map();
  globalThis.ethereum = { selectedAddress: session.wallet, request: async () => [session.wallet], on: (event, listener) => listeners.set(event, listener), removeListener: (event, listener) => { assert.equal(listeners.get(event), listener); listeners.delete(event); } };
  let renderer;
  try {
    await act(async () => { renderer = TestRenderer.create(React.createElement(JobActionPanel, { job: { ...job, status: '2', client: session.wallet }, session, health })); });
    assert.ok(findButton(renderer, 'Approve'));
    await act(async () => listeners.get('disconnect')());
    assert.ok(findButton(renderer, 'Connect wallet'));
    assert.equal(renderer.root.findAllByType('form').length, 0);
    await act(async () => listeners.get('accountsChanged')([session.wallet]));
    assert.ok(findButton(renderer, 'Approve'));
    assert.doesNotMatch(JSON.stringify(renderer.toJSON()), /Continue/);
    await act(async () => renderer.unmount());
    renderer = null;
    assert.equal(listeners.size, 0);
  } finally { if (renderer) await act(async () => renderer.unmount()); globalThis.ethereum = previous; }
});

test('delivery history failure and uint256 overflow stay disabled without defaulting to version one', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'INTERNAL_ERROR' }), { status: 500, headers: { 'content-type': 'application/json' } });
    const failed = TestRenderer.create(React.createElement(DeliveryPanel, { job: { ...job, status: '1', operator: session.wallet }, session, health }));
    await act(async () => {});
    assert.equal(failed.root.findAllByType('input').find((node) => node.props.name === 'version').props.value, '');
    assert.equal(failed.root.findAllByType('button').at(-1).props.disabled, true);
    assert.match(JSON.stringify(failed.toJSON()), /INTERNAL_ERROR|Delivery history is malformed/);
    failed.unmount();
    globalThis.fetch = async () => new Response(JSON.stringify({ items: [{ version: '115792089237316195423570985008687907853269984665640564039457584007913129639935' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    const overflow = TestRenderer.create(React.createElement(DeliveryPanel, { job: { ...job, status: '1', operator: session.wallet }, session, health }));
    await act(async () => {});
    assert.equal(overflow.root.findAllByType('input').find((node) => node.props.name === 'version').props.value, '');
    assert.equal(overflow.root.findAllByType('button').at(-1).props.disabled, true);
  } finally { globalThis.fetch = originalFetch; }
});
