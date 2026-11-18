import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { keccak256, stringToHex } from 'viem';
import { DeliveryReview, readDeliveryReview, safeDeliveryUrl } from '../app/v2/_components/delivery-review.mjs';
const client = '0x1111111111111111111111111111111111111111';
const operator = '0x2222222222222222222222222222222222222222';
const job = { jobId: '7', stateVersion: '3', status: 'Submitted', client, operator, document: { criteria: ['Playable loop', 'Mobile controls', 'Setup guide'] } };
const content = { link: 'https://kellearena.com/' };
const hash = keccak256(stringToHex(JSON.stringify(content)));
const response = () => ({ reviewContext: { jobId: '7', stateVersion: '3' }, canonicalDelivery: { version: '1', contentHash: hash }, items: [{ jobId: '7', version: '1', contentHash: hash, content }, { jobId: '7', version: '2', contentHash: `0x${'12'.repeat(32)}`, content: { link: 'https://draft.invalid/' } }] });
const text = tree => JSON.stringify(tree.toJSON());
test('only matching canonical version and recomputed content hash can be reviewed', () => {
  assert.equal(readDeliveryReview(response(), job).delivery.content.link, content.link);
  for (const change of [r => r.canonicalDelivery = null, r => r.reviewContext.stateVersion = '4', r => r.reviewContext.jobId = '8', r => r.items[0].jobId = '8', r => r.items[0].content.link = 'https://tampered.invalid/', r => r.canonicalDelivery.version = '2', r => r.items.push({ ...r.items[0] })]) {
    const r = structuredClone(response()); change(r); assert.equal(readDeliveryReview(r, job).delivery, null);
  }
});
test('external links accept only http(s) without credentials and never executable schemes', () => {
  assert.equal(safeDeliveryUrl(content.link), content.link);
  for (const v of ['javascript:alert(1)', 'data:text/html,evil', '//evil.invalid', 'https://name:password@evil.invalid', 'file:///C:/secret', 'https://ok.invalid/\nfoo']) assert.equal(safeDeliveryUrl(v), null);
});
test('client sees confirmed link, version, acceptance criteria and unconfirmed-draft distinction without writes', async () => {
  const calls = []; let tree;
  await act(async () => { tree = TestRenderer.create(React.createElement(DeliveryReview, { job, session: { wallet: client }, request: async (...args) => { calls.push(args); return response(); } })); });
  assert.match(text(tree), /Submitted delivery/); assert.match(text(tree), /Playable loop/); assert.match(text(tree), /Mobile controls/); assert.match(text(tree), /Setup guide/); assert.match(text(tree), /Version 1/); assert.match(text(tree), /Not the current confirmed delivery/);
  const links = tree.root.findAllByType('a'); assert.equal(links.length, 1); assert.equal(links[0].props.href, content.link); assert.equal(links[0].props.target, '_blank'); assert.match(links[0].props.rel, /noopener/);
  assert.deepEqual(calls, [['/api/v2/jobs/7/deliveries']]);
  await act(async () => tree.unmount());
});
test('missing manifest and mismatched payload never show a reviewable link', async () => {
  for (const mutate of [r => r.items = [], r => r.items[0].content.link = 'javascript:alert(1)', r => r.reviewContext.stateVersion = '4']) {
    const r = structuredClone(response()); mutate(r); let tree;
    await act(async () => { tree = TestRenderer.create(React.createElement(DeliveryReview, { job, session: { wallet: client }, request: async () => r })); });
    assert.equal(tree.root.findAllByType('a').length, 0); assert.match(text(tree), /Do not approve/); await act(async () => tree.unmount());
  }
});
test('private reads clear immediately across account changes and late responses cannot restore content', async () => {
  let release; const gate = new Promise(r => release = r); let calls = 0, tree;
  const request = async () => { calls++; return gate; };
  await act(async () => { tree = TestRenderer.create(React.createElement(DeliveryReview, { job, session: { wallet: client }, request })); });
  await act(async () => tree.update(React.createElement(DeliveryReview, { job, session: { wallet: '0x3333333333333333333333333333333333333333' }, request })));
  await act(async () => release(response())); assert.equal(tree.toJSON(), null); assert.equal(calls, 1); await act(async () => tree.unmount());
});
test('read error has explicit retry and recovery; unsafe URL is displayed as text only', async () => {
  let calls = 0, tree; const r = response(); r.items[0].content = { link: 'javascript:alert(1)' }; r.items[0].contentHash = keccak256(stringToHex(JSON.stringify(r.items[0].content))); r.canonicalDelivery.contentHash = r.items[0].contentHash;
  const request = async () => { if (++calls === 1) throw new Error('private error'); return r; };
  await act(async () => { tree = TestRenderer.create(React.createElement(DeliveryReview, { job, session: { wallet: client }, request })); });
  assert.match(text(tree), /Unable to load/); assert.doesNotMatch(text(tree), /private error/);
  await act(async () => tree.root.findByType('button').props.onClick()); assert.equal(calls, 2); assert.equal(tree.root.findAllByType('a').length, 0); assert.match(text(tree), /javascript:alert/); await act(async () => tree.unmount());
});
