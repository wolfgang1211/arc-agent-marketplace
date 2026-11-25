import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalLoopbackUrl } from '../lib/v2/client-origin.mjs';

test('localhost is redirected to the canonical 127.0.0.1 origin, keeping port, path and query', () => {
  assert.equal(canonicalLoopbackUrl('http://localhost:3102/v2/jobs/8?x=1#d'), 'http://127.0.0.1:3102/v2/jobs/8?x=1#d');
});
test('other hosts are never redirected', () => {
  for (const href of ['http://127.0.0.1:3102/v2', 'https://arc-agent-marketplace.vercel.app/v2', 'http://localhost.evil.test/v2', 'not a url']) assert.equal(canonicalLoopbackUrl(href), null);
});
