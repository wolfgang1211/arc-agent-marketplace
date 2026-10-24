import manifest from '../../lib/v2/indexer-event-manifest.json' with { type: 'json' };

export const CHAIN_ID = 5042002;
export const MARKETPLACE = manifest.emitters.marketplace;
export const VAULT = manifest.emitters.vault;
export const SNAPSHOT_BLOCK = 68072744;
export const hash = (n) => `0x${BigInt(n).toString(16).padStart(64, '0')}`;
export const address = (n) => `0x${BigInt(n).toString(16).padStart(40, '0')}`;

const JOB = {
  client: address(0x11), operator: address(0x12), resolver: address(0x13), reward: '9007199254740993',
  createdAt: '1', applyBy: '2', deliveryDuration: '3', deliveryDeadline: '4', reviewDeadline: '5', correctionDeadline: '6',
  extensionTotal: '7', reviewDuration: '8', revisionDuration: '9', feeBpsSnapshot: '10', treasurySnapshot: address(0x21),
  minRewardSnapshot: '11', revisionLimit: '12', revisionsUsed: '13', accessReports: '14', disputeCount: '15',
  unlimitedRevisions: false, testJob: false, house: false, status: '3', criteriaHash: hash(31), descriptionHash: hash(32),
  canonicalTermsHash: hash(33), deliveryHash: hash(34), previousDeliveryHash: hash(35), stakeReserved: '16', stateVersion: '7',
  savedDeliveryRemaining: '17', savedReviewRemaining: '18', savedCorrectionRemaining: '19', extensionRequestId: '20',
  extensionRequestedDeadline: '21', extensionExpiry: '22', extensionSnapshotDeadline: '23', repairDeadline: '24',
  accessReportDeliveryVersion: '25', episodeStart: '26', lastAdminActionAt: '27', disputeTimeUsed: '28', savedRepairRemaining: '29',
  faultReviewDeadline: '30', deliveryVersion: '31', reviewingCount: '32', previousStatus: '3', faultReviewPending: false,
  deadlineFailureClaimed: false, extensionState: '1', revisionCriterionHash: hash(36), revisionReferenceHash: hash(37),
};
const ACCOUNT = { registered: true, maxActiveJobs: '9', activeJobs: '3', credits: '9007199254740993', nonceEpoch: '2', freeStake: '100', reservedStake: '200' };

export function snapshot(blockNumber = SNAPSHOT_BLOCK, overrides = {}) {
  const blockTag = `0x${BigInt(blockNumber).toString(16)}`;
  const base = {
    chainId: BigInt(CHAIN_ID), blockTag, blockHash: hash(blockNumber),
    hashes: { marketplaceNormalized: hash(101), vaultNormalized: hash(102) },
    getters: { owner: address(0x21), treasury: address(0x22), minReward: '100', feeBps: '250' },
    readJob: async () => ({ jobId: '53', ...JOB }),
    readMutual: async () => ({ version: '2', jobStateVersion: '7', refund: '1', grossPayout: '2', expiry: '3', proposer: address(0x11), active: false }),
    readAccount: async () => ({ ...ACCOUNT, applicationNonce: async () => '9007199254740993' }),
    readClientPolicy: async () => ({ listedHouse: false, testClient: false, resolverPolicy: address(0x23), resolvedResolver: address(0x24) }),
  };
  return { ...base, ...overrides, blockTag, blockHash: overrides.blockHash ?? base.blockHash };
}

export function pinnedReader(overrides = {}) {
  return async ({ toBlockTag } = {}) => {
    const blockNumber = toBlockTag === undefined ? SNAPSHOT_BLOCK : Number(BigInt(toBlockTag));
    return { read: async () => snapshot(blockNumber, overrides) };
  };
}
