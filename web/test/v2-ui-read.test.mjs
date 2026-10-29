import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeStatus,
  statusGroup,
  statusLabel,
  isV2Healthy,
  readJobs,
  readJob,
} from '../lib/v2/ui-read-model.mjs';

const contractPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../contract/contracts/AgentMarketplaceV2.sol');
const contractSource = fs.readFileSync(contractPath, 'utf8');
const statusEnum = contractSource.match(/enum\s+Status\s*\{([^}]*)\}/)?.[1];
assert.ok(statusEnum, `missing Status enum in ${contractPath}`);
const canonicalStatusNames = statusEnum.split(',').map((name) => name.trim()).filter(Boolean);
const statuses = canonicalStatusNames.map((name, code) => [String(code), name, code === 0 ? 'open' : code <= 5 ? 'active' : 'closed']);

test('normalizes all canonical numeric and enum-name statuses consistently', () => {
  for (const [code, name, group] of statuses) {
    const numeric = normalizeStatus(code);
    const named = normalizeStatus(name.toLowerCase());
    assert.equal(numeric.name, name);
    assert.equal(named.name, name);
    assert.equal(numeric.group, group);
    assert.equal(statusGroup(code), group);
    assert.equal(statusLabel(code), numeric.label);
  }
});

test('V2 workflow fixtures keep intermediate recovery/dispute states active and terminal states closed', () => {
  const fixtures = [
    { status: 3, name: 'RevisionPending', group: 'active' },
    { status: 4, name: 'AccessRecovery', group: 'active' },
    { status: 5, name: 'Disputed', group: 'active' },
    { status: 6, name: 'Completed', group: 'closed' },
    { status: 7, name: 'Refunded', group: 'closed' },
    { status: 8, name: 'Cancelled', group: 'closed' },
  ];
  assert.equal(statuses.length, 9);
  for (const fixture of fixtures) {
    const model = normalizeStatus(fixture.status);
    assert.equal(model?.code, fixture.status);
    assert.equal(model?.name, fixture.name);
    assert.equal(model?.group, fixture.group);
    assert.equal(statusGroup(fixture.status), fixture.group);
  }
});

test('status normalization is strict and never categorizes malformed values', () => {
  for (const value of ['9', '-1', '01', '1.0', '1e0', '', 'open-ish', 'bogus', null, undefined, {}, 1.5, 9]) {
    assert.equal(normalizeStatus(value), null);
    assert.equal(statusGroup(value), 'unknown');
    assert.equal(statusLabel(value), 'Unknown');
  }
});

test('reader health requires healthy status, stale false, and a null gap', () => {
  assert.equal(isV2Healthy({ data: { status: 'healthy', stale: false, gap: null } }), true);
  assert.equal(isV2Healthy({ status: 'healthy', stale: false, gap: null }), true);
  for (const health of [
    { data: { status: 'healthy', stale: false, gap: 0 } },
    { data: { status: 'healthy', stale: true, gap: null } },
    { data: { status: 'degraded', stale: false, gap: null } },
    { data: { status: 'unavailable', stale: false, gap: null } },
    { data: {} },
    null,
    undefined,
  ]) assert.equal(isV2Healthy(health), false);
});

test('read model unwraps real API envelopes without inventing rows', () => {
  const items = [{ jobId: '1', status: '0', data: { status: 'bad' } }];
  assert.deepEqual(readJobs({ source: { version: 'v2' }, data: { items } }), items);
  assert.deepEqual(readJobs({ data: { items: null } }), []);
  assert.deepEqual(readJobs({}), []);
  const job = { jobId: '1', document: { title: 'Canonical' }, status: '4' };
  assert.deepEqual(readJob({ source: {}, data: job }), job);
  assert.equal(readJob({ data: { items } }), null);
});
