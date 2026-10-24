import assert from 'node:assert/strict';
import test from 'node:test';
import manifest from '../lib/v2/indexer-event-manifest.json' with { type: 'json' };
import { prepareV2Projection, createV2IndexerProjector } from '../lib/v2/server/indexer-projection.mjs';
import { snapshot as pinnedSnapshot } from './fixtures/v2-indexer-snapshot.mjs';

const chainId = 5042002;
const marketplace = manifest.emitters.marketplace;
const hash = `0x${'11'.repeat(32)}`;
const client = '0x0000000000000000000000000000000000000011';
const operator = '0x0000000000000000000000000000000000000012';
const job = { client, operator, reward: '9007199254740993', createdAt: '1', applyBy: '2', deliveryDuration: '3', deliveryDeadline: '4', reviewDeadline: '5', correctionDeadline: '6', extensionTotal: '7', reviewDuration: '8', revisionDuration: '9', feeBpsSnapshot: '10', treasurySnapshot: operator, minRewardSnapshot: '11', revisionLimit: '12', revisionsUsed: '13', accessReports: '14', disputeCount: '15', unlimitedRevisions: false, testJob: false, house: false, status: '3', criteriaHash: hash, descriptionHash: hash, canonicalTermsHash: hash, deliveryHash: hash, previousDeliveryHash: hash, stakeReserved: '16', stateVersion: '7', savedDeliveryRemaining: '17', savedReviewRemaining: '18', savedCorrectionRemaining: '19', extensionRequestId: '20', extensionRequestedDeadline: '21', extensionExpiry: '22', extensionSnapshotDeadline: '23', repairDeadline: '24', accessReportDeliveryVersion: '25', episodeStart: '26', lastAdminActionAt: '27', disputeTimeUsed: '28', savedRepairRemaining: '29', faultReviewDeadline: '30', deliveryVersion: '31', reviewingCount: '32', previousStatus: '3', resolver: operator, faultReviewPending: false, deadlineFailureClaimed: false, extensionState: '1', revisionCriterionHash: hash, revisionReferenceHash: hash };
function account() { return { registered: true, maxActiveJobs: '1', activeJobs: '1', credits: '9007199254740993', nonceEpoch: '2', freeStake: '3', reservedStake: '4', applicationNonce: async () => '9007199254740993' }; }
function snapshot() {
  return { chainId: BigInt(chainId), blockTag: '0x10', blockHash: hash, hashes: { marketplaceNormalized: hash, vaultNormalized: hash }, getters: { owner: operator, treasury: operator, minReward: '1', feeBps: '9007199254740993' },
    readJob: async () => job, readMutual: async () => ({ proposer: client, version: '2', jobStateVersion: '7', refund: '1', grossPayout: '2', expiry: '3', active: false }), readAccount: async () => account(), readClientPolicy: async () => ({ listedHouse: true, testClient: false, resolverPolicy: operator, resolvedResolver: operator }) };
}
const posted = { eventName: 'JobPosted', decoded: { args: { jobId: '1', client, reward: '9007199254740993', applyBy: '2', criteriaHash: hash, descriptionHash: hash, testJob: false, house: false } } };

function completeSnapshot(calls = {}) { return { ...pinnedSnapshot(), readJob: async () => { calls.job = (calls.job ?? 0) + 1; return { jobId: '53', ...job }; }, readMutual: async () => { calls.mutual = (calls.mutual ?? 0) + 1; return { proposer: client, version: '2', jobStateVersion: '7', refund: '1', grossPayout: '2', expiry: '3', active: false }; }, readAccount: async () => ({ ...account(), applicationNonce: async () => { calls.applicationNonce = (calls.applicationNonce ?? 0) + 1; return '9007199254740993'; } }), readClientPolicy: async () => { calls.clientPolicy = (calls.clientPolicy ?? 0) + 1; return { listedHouse: false, testClient: false, resolverPolicy: operator, resolvedResolver: operator }; } }; }
function eventValue(input, index) {
  if (input.name === 'jobId') return '53';
  if (input.type === 'address') return input.name.toLowerCase().includes('client') ? client : input.name.toLowerCase().includes('owner') ? '0x0000000000000000000000000000000000000021' : operator;
  if (input.type === 'bytes32') return `0x${String(index + 40).padStart(64, '0')}`;
  if (input.type === 'bool') return index % 2 === 0;
  return '9007199254740993';
}
const allEvents = [...manifest.abis.marketplace, ...manifest.abis.vault].filter((event) => event.type === 'event');

test('all 42 canonical manifest events prepare through the strict pinned reader', async (t) => {
  assert.equal(allEvents.length, 42);
  for (const [index, abi] of allEvents.entries()) await t.test(`${abi.name} (${abi.inputs.length} ABI args)`, async () => {
    const calls = {};
    const args = Object.fromEntries(abi.inputs.map((input, inputIndex) => [input.name, eventValue(input, index + inputIndex)]));
    const prepared = await prepareV2Projection({ chainId, marketplace, snapshot: completeSnapshot(calls), events: [{ eventName: abi.name, decoded: { args } }] });
    assert.equal(prepared.events.length, 1);
    assert.equal(prepared.events[0].eventName, abi.name);
    if (abi.inputs.some((input) => input.name === 'jobId')) { assert.equal(prepared.jobs[0].jobId, '53'); assert.ok(calls.job > 0); if (abi.name === 'JobPosted') assert.ok(calls.applicationNonce > 0); }
    if (abi.inputs.some((input) => input.type === 'address')) assert.ok(calls.clientPolicy > 0);
  });
});

test('preparation requires the verified pinned snapshot and preserves uint256 strings', async () => {
  await assert.rejects(prepareV2Projection({ chainId, marketplace, events: [] }), /PROJECTION_SNAPSHOT_REQUIRED/);
  const prepared = await prepareV2Projection({ chainId, marketplace, snapshot: snapshot(), events: [posted] });
  assert.equal(prepared.jobs[0].reward, '9007199254740993');
  assert.equal(prepared.accounts[0].credits, '9007199254740993');
  assert.equal(prepared.source.blockHash, hash);
  assert.equal(Object.isFrozen(prepared), true);
});

test('projector refuses unprepared writes and performs only transaction-handle queries', async () => {
  const projector = createV2IndexerProjector({ chainId, marketplace });
  const calls = [];
  const tx = { query: async (sql, params) => { calls.push([sql, params]); return { rows: [] }; } };
  await assert.rejects(projector(tx, { events: [] }), /PROJECTION_SNAPSHOT_REQUIRED/);
  const prepared = await prepareV2Projection({ chainId, marketplace, snapshot: snapshot(), events: [posted] });
  await projector(tx, { prepared });
  assert.ok(calls.length > 0);
});
