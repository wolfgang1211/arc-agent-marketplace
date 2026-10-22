import assert from 'node:assert/strict';
import test from 'node:test';
import { createJobAcl } from '../lib/v2/server/job-access.mjs';
const chainId = 5042002n; const market = '0xFA156B7A5205B123c8a22A807ba98405e36130f1';
const client = '0x0000000000000000000000000000000000000001'; const operator = '0x0000000000000000000000000000000000000002'; const resolver = '0x0000000000000000000000000000000000000003'; const other = '0x0000000000000000000000000000000000000004';
const job = (overrides = {}) => ({ chainId, marketplace: market, jobId: '7', client, operator, resolver, status: 'InProgress', ...overrides });

test('application and delivery ACLs use only client, assigned operator, and snapshot resolver', () => {
  const acl = createJobAcl({ chainId, marketplace: market });
  assert.equal(acl.canReadApplications(client, job()), true); assert.equal(acl.canReadApplications(resolver, job()), true); assert.equal(acl.canReadApplications(operator, job(), operator), true); assert.equal(acl.canReadApplications(operator, job(), other), false); assert.equal(acl.canReadApplications(operator, job(), undefined), false); assert.equal(acl.canReadApplications(operator, job(), operator), true); assert.equal(acl.canReadApplications(other, job()), false); assert.equal(acl.canReadApplications(null, job()), false);
  assert.equal(acl.canReadDeliveries(client, job()), true); assert.equal(acl.canReadDeliveries(operator, job()), true); assert.equal(acl.canReadDeliveries(resolver, job()), true); assert.equal(acl.canReadDeliveries(other, job()), false); assert.equal(acl.canReadDeliveries(other, job({ resolver: other })), true);
});

test('delivery submission follows actual V2 states and former/global owners have no backdoor', () => {
  const acl = createJobAcl({ chainId, marketplace: market });
  assert.equal(acl.canSubmitDelivery(operator, job({ status: 'InProgress' })), true); assert.equal(acl.canSubmitDelivery(operator, job({ status: 'RevisionPending' })), false); assert.equal(acl.canSubmitDelivery(operator, job({ status: 'Submitted' })), false); assert.equal(acl.canSubmitDelivery(resolver, job({ status: 'InProgress' })), false); assert.equal(acl.canSubmitDelivery(operator, job({ status: 'Completed' })), false);
  assert.equal(acl.canSubmitRevision(operator, job({ status: 'RevisionPending' })), true); assert.equal(acl.canSubmitRevision(operator, job({ status: 'InProgress' })), false); assert.equal(acl.canSubmitRevision(resolver, job({ status: 'RevisionPending' })), false);
});

test('job binding and hostile accessors fail closed', () => {
  const acl = createJobAcl({ chainId, marketplace: market });
  assert.throws(() => createJobAcl({ chainId: 1n, marketplace: market }), /fixed job binding/); assert.throws(() => createJobAcl({ chainId: '5042002', marketplace: market }), /fixed job binding/); assert.throws(() => createJobAcl({ chainId: 5042002n, marketplace: '0x1111111111111111111111111111111111111111' }), /fixed job binding/);
  assert.equal(acl.canReadApplications(client, job({ chainId: 1n })), false); assert.equal(acl.canReadApplications(client, job({ chainId: '5042002' })), false); assert.equal(acl.canReadApplications(client, job({ chainId: NaN })), false); assert.equal(acl.canReadApplications(client, job({ marketplace: '0x2222222222222222222222222222222222222222' })), false); assert.equal(acl.canReadApplications(client, job({ jobId: '-1' })), false);
  const hostile = job(); Object.defineProperty(hostile, 'client', { get() { throw new Error('should not run'); } }); assert.equal(acl.canReadApplications(client, hostile), false);
});
