import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { JobActionPanel, ResolverActionPanel } from '../app/v2/_components/action-panels.js';
import { documentHash } from '../lib/v2/ui-actions.mjs';
import { DecisionReview, RevisionReview } from '../app/v2/_components/decision-review.mjs';

const wallet = '0x1111111111111111111111111111111111111111';
const session = { authenticated: true, wallet, csrf: 'csrf' };
const health = { data: { status: 'healthy', stale: false, gap: null } };
const job = { jobId: '7', stateVersion: '3', reward: '1000000', status: '2', client: wallet, operator: '0x2222222222222222222222222222222222222222', resolver: '0x3333333333333333333333333333333333333333', document: { criteria: ['Ship the exact requested UI'] } };
const hash = `0x${'a'.repeat(64)}`;
const criterionHash = documentHash('criterion 1');
const referenceHash = documentHash('Fix button');
function text(renderer) { return JSON.stringify(renderer.toJSON()); }
function button(renderer, label) { return renderer.root.findAllByType('button').find((x) => x.children.join('') === label); }
function response(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } }); }

test('revision requires note and criterion reference, persists once, then explicitly confirms exact hashes', async () => {
  const calls = [];
  const old = globalThis.fetch;
  globalThis.fetch = async (path, init) => { calls.push({ path, body: init?.body && JSON.parse(init.body) }); return init?.method === 'POST' && path.endsWith('revision-notes') ? response({ note: { id: 'n1', jobId: '7', expectedStateVersion: '3', requestStateVersion: '4', deliveryVersion: '2', criterionReference: 'criterion 1', note: 'Fix button', criterionHash, referenceHash } }) : response({ context: { jobId: '7', stateVersion: '3', deliveryVersion: '2' }, notes: [] }); };
  try {
    const renderer = TestRenderer.create(React.createElement(RevisionReview, { job, session, health }));
    assert.equal(button(renderer, 'Review revision request')?.props.disabled, true);
    const fields = renderer.root.findAllByType('textarea');
    await act(async () => fields[0].props.onChange({ target: { value: 'Fix button' } }));
    await act(async () => renderer.root.findAllByType('input').find((x) => x.props.name === 'criterionReference').props.onChange({ target: { value: 'criterion 1' } }));
    await act(async () => button(renderer, 'Review revision request').props.onClick());
    assert.equal(calls.filter((x) => x.body).length, 1);
    assert.match(text(renderer), /Fix button/); assert.match(text(renderer), /criterion 1/); assert.match(text(renderer), /Criterion hash/);
    await act(async () => button(renderer, 'Confirm revision request').props.onClick());
    assert.equal(calls.filter((x) => x.body).length, 2); const posts = calls.filter((x) => x.body); assert.equal(posts[0].path, '/api/v2/jobs/7/revision-notes'); assert.equal(posts[1].body.params.criterionHash, criterionHash);
  } finally { globalThis.fetch = old; }
});

test('incoming mutual card has only card accept/reject and stale accept refreshes without retry', async () => {
  const calls = []; const old = globalThis.fetch;
  globalThis.fetch = async (path, init) => { calls.push({ path, body: init?.body && JSON.parse(init.body) }); return path.endsWith('decision-review') && (!init || init.method === 'GET') ? response({ context: { jobId: '7', stateVersion: '3', block: '9', blockHash: hash }, mutual: { active: true, version: '4', jobStateVersion: '3', proposer: '0x2222222222222222222222222222222222222222', client: wallet, operator:job.operator, expiry: '999', refund: '250000', grossPayout: '750000', fee: '10000', operatorNet: '740000' }, resolved: null }) : response({ error: 'STALE_DATA' }, 409); };
  try {
    const renderer = TestRenderer.create(React.createElement(DecisionReview, { job, session, health })); await act(async () => {});
    assert.match(text(renderer), /250000|0\.25/); assert.match(text(renderer), /operatorNet/);
    assert.equal(renderer.root.findAllByType('button').filter((x) => /Accept settlement|Reject settlement/.test(x.children.join(''))).length, 2);
    await act(async () => button(renderer, 'Accept settlement').props.onClick());
    assert.equal(calls.filter((x) => x.body?.action === 'acceptMutual').length, 1);
    assert.equal(calls.filter((x) => x.body?.action === 'acceptMutual').length, 1);
  } finally { globalThis.fetch = old; }
});

test('resolver preview is read-only, explicit, renders zero consequence fields, and edits invalidate it', async () => {
  const calls = []; const old = globalThis.fetch;
  globalThis.fetch = async (path, init) => { calls.push({ path, body: init?.body && JSON.parse(init.body) }); return !init || init.method === 'GET' ? response({ context: { jobId: '7', stateVersion: '3', block: '9', blockHash: hash }, mutual: null, resolved: null }) : response({ context: { jobId: '7', stateVersion: '3', block: '9', blockHash: hash }, preview: { action: 'resolveDispute', grossPayout: '0', refund: '0', fee: '0', operatorNet: '0', clientCredit: '0', treasuryCredit: '0', stakeReleased: '0', stakeSlashed: '0', slashRecipient: '0x0', releaseRecipient: '0x0', conservation: {totalBefore:'0',totalAfter:'0'} }, previewBinding: { jobId:'7', stateVersion: '3', reasonHash: hash, evidenceHash: hash } }); };
  try {
    const renderer = TestRenderer.create(React.createElement(ResolverActionPanel, { job: { ...job, client:job.operator, operator:'0x4444444444444444444444444444444444444444', status: '5', resolver: wallet }, session, health })); await act(async () => {});
    assert.equal(calls.filter((x) => x.body).length, 0); assert.equal(button(renderer, 'Review resolution')?.props.disabled, true);
    const inputs = renderer.root.findAllByType('input');
    for (const input of inputs.filter((x) => x.props.type !== 'checkbox')) await act(async () => input.props.onChange({ target: { value: input.props.name === 'grossPayout' ? '0' : 'evidence' } }));
    await act(async () => renderer.root.findAllByType('textarea').forEach((x) => x.props.onChange({ target: { value: 'reason' } })));
    await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    assert.equal(calls.filter((x) => x.body).length, 1); assert.match(text(renderer), /Stake released|Conservation/);
    await act(async () => renderer.root.findAllByType('textarea')[0].props.onChange({ target: { value: 'changed' } }));
    assert.equal(renderer.root.findAllByProps({ 'data-testid': 'economic-preview' }).length, 0);
  } finally { globalThis.fetch = old; }
});

test('malformed or pending previews never enable confirmation or send', async () => {
  const old = globalThis.fetch; globalThis.fetch = async () => response({ context: { jobId: '7', stateVersion: '3' }, preview: null });
  try { const renderer = TestRenderer.create(React.createElement(ResolverActionPanel, { job: { ...job, client:job.operator, operator:'0x4444444444444444444444444444444444444444', status: '5', resolver: wallet }, session, health })); await act(async () => {}); assert.equal(button(renderer, 'Review resolution')?.props.disabled, true); } finally { globalThis.fetch = old; }
});

test('decision review is hidden when there is nothing to decide, and on terminal jobs whose optional read fails', async () => {
  const old = globalThis.fetch;
  try {
    globalThis.fetch = async () => response({ context: { jobId: '7', stateVersion: '3', block: '9', blockHash: hash }, mutual: { active: false }, resolved: null });
    let renderer; await act(async () => { renderer = TestRenderer.create(React.createElement(DecisionReview, { job, session, health })); });
    assert.equal(renderer.toJSON(), null, 'submitted job with no proposal shows no empty card');
    globalThis.fetch = async () => response({ error: 'INTERNAL_ERROR' }, 500);
    const done = { ...job, status: '6' };
    await act(async () => { renderer = TestRenderer.create(React.createElement(DecisionReview, { job: done, session, health })); });
    assert.equal(renderer.toJSON(), null, 'completed job hides a failed optional decision read');
    await act(async () => { renderer = TestRenderer.create(React.createElement(DecisionReview, { job, session, health })); });
    assert.match(text(renderer), /Unable to load the private review/, 'active job still surfaces the failure before acting');
  } finally { globalThis.fetch = old; }
});
