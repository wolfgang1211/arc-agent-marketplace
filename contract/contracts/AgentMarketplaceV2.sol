// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";

interface IOperatorCollateralVaultV2 {
    function token() external view returns (address);
    function marketplace() external view returns (address);
    function treasury() external view returns (address);
    function freeStake(address) external view returns (uint256);
    function reservedStake(address) external view returns (uint256);
    function stakeLiability() external view returns (uint256);
    function requiredStake(uint256) external pure returns (uint256);
    function depositStake(uint256) external;
    function withdrawStake(uint256) external;
    function reserve(uint256, address, address, uint256) external;
    function release(uint256) external;
    function markFault(uint256, uint64) external;
    function slashAndRelease(uint256, uint256) external;
    function releaseFault(uint256) external;
}

/// @title AlphaBoard Agent Marketplace V2
/// @notice New, receipt-backed USDC escrow marketplace. It intentionally does not migrate V1 state.
/// @dev Delivery content is represented only by bytes32 commitments; storage/encryption is off-chain.
contract AgentMarketplaceV2 is Ownable2Step, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;


    uint256 internal constant BPS = 10_000;
    uint256 internal constant USDC = 1e6;
    uint256 internal constant MIN_REWARD_DEFAULT = USDC;
    uint256 internal constant MIN_DURATION = 1 hours;
    uint256 internal constant MAX_APPLY = 30 days;
    uint256 internal constant MAX_DELIVERY = 90 days;
    uint256 internal constant MAX_REVIEW = 14 days;
    uint256 internal constant MAX_REVISION = 14 days;
    uint256 internal constant MAX_EXTENSION_TOTAL = 180 days;
    uint256 internal constant MAX_ARBITRATION = 21 days;
    uint256 internal constant STAKE_FLOOR = 5 * USDC;
    uint256 internal constant STAKE_ROUND = 10_000; // 0.01 USDC
    bytes4 private constant ERC1271_MAGIC = IERC1271.isValidSignature.selector;
    bytes32 internal constant TERMS_SCHEMA = keccak256("AlphaBoard.AgentMarketplaceV2.JobTerms.v2");

    IERC20 public immutable usdc;
    IOperatorCollateralVaultV2 public immutable collateralVault;
    address public treasury;
    uint256 public minReward = MIN_REWARD_DEFAULT;
    uint256 public feeBps = 500;
    uint256 internal constant MAX_FEE_BPS = 500;
    mapping(address => uint256) public nonceEpoch;
    uint256 public nextJobId = 1;
    uint256 public escrowed;

    uint256 public creditsLiability;



    enum Status { Open, InProgress, Submitted, RevisionPending, AccessRecovery, Disputed, Completed, Refunded, Cancelled }
    enum ExtensionState { None, Pending, Granted, Rejected, Revoked }
    enum DisputeOutcome { None, ClientRefund, FullOperator, Partial }

    struct Job {
        address client;
        address operator;
        uint128 reward;
        uint64 createdAt;
        uint64 applyBy;
        uint64 deliveryDuration;
        uint64 deliveryDeadline;
        uint64 reviewDeadline;
        uint64 correctionDeadline;
        uint64 extensionTotal;
        uint64 reviewDuration;
        uint64 revisionDuration;
        uint256 feeBpsSnapshot;
        address treasurySnapshot;
        uint256 minRewardSnapshot;
        uint8 revisionLimit;
        uint256 revisionsUsed;
        uint8 accessReports;
        uint8 disputeCount;
        bool unlimitedRevisions;
        bool testJob;
        bool house;
        Status status;
        bytes32 criteriaHash;
        bytes32 descriptionHash;
        bytes32 canonicalTermsHash;
        bytes32 deliveryHash;
        bytes32 previousDeliveryHash;
        uint256 stakeReserved;
        uint256 stateVersion;


        uint64 savedDeliveryRemaining;
        uint64 savedReviewRemaining;
        uint64 savedCorrectionRemaining;
        uint64 extensionRequestId;
        uint64 extensionRequestedDeadline;
        uint64 extensionExpiry;
        uint64 extensionSnapshotDeadline;
        uint64 repairDeadline;
        uint64 accessReportDeliveryVersion;
        uint64 episodeStart;
        uint64 lastAdminActionAt;
        uint64 disputeTimeUsed;
        uint64 savedRepairRemaining;
        uint64 faultReviewDeadline;
        uint256 deliveryVersion;

        uint8 reviewingCount;
        Status previousStatus;
        address resolver;
        bool faultReviewPending;
        bool deadlineFailureClaimed;
        ExtensionState extensionState;
        bytes32 revisionCriterionHash;
        bytes32 revisionReferenceHash;
    }

    struct ApplicationTerms {
        uint256 jobId;
        address operator;
        bytes32 termsHash;
        uint64 validAfter;
        uint64 validBefore;
        uint256 nonceEpoch;
        uint256 operatorNonce;
    }

    struct MutualRequest { uint256 version; uint256 jobStateVersion; uint128 refund; uint128 grossPayout; uint64 expiry; address proposer; bool active; }

    mapping(uint256 => Job) private jobs;

    mapping(address => uint256) public activeJobs;
    mapping(address => bool) public registered;
    mapping(address => uint256) public maxActiveJobs;
    mapping(address => bool) listedHouse;
    mapping(address => bool) testClient;

    mapping(address => address) resolverPolicy;
    mapping(address => uint256) public deadlineFailures;
    mapping(address => uint256) public credits;

    mapping(uint256 => mapping(address => uint256)) public applicationNonce;
    mapping(uint256 => MutualRequest) mutual;

    bytes32 internal constant APPLICATION_TYPEHASH = keccak256("Application(uint256 jobId,address operator,bytes32 termsHash,uint64 validAfter,uint64 validBefore,uint256 nonceEpoch,uint256 operatorNonce)");

    event JobPosted(uint256 indexed jobId, address indexed client, uint256 reward, uint64 applyBy, bytes32 criteriaHash, bytes32 descriptionHash, bool testJob, bool house);
    event ApplicationRevoked(uint256 indexed jobId, address indexed operator, uint256 nonce);

    event JobAwarded(uint256 indexed jobId, address indexed operator, uint256 stake, bytes32 termsHash);
    // JobTerms.collateralPolicy packs maxExtensionTotal[0:64], floor[64:128], round[128:160], bps[160:176].
    event JobTerms(uint256 indexed jobId, bytes32 canonicalTermsHash, uint256 reward, uint256 feeBps, address treasury, uint256 minReward, address resolver, uint64 deliveryDuration, uint64 reviewDuration, uint64 revisionDuration, uint8 revisionLimit, bool unlimitedRevisions, uint256 collateralPolicy);
    // JobState.clockPack is delivery/review/correction/repair deadlines at 0/64/128/192;
    // counters packs accessReports[0:8], disputeCount[8:16], reviewingCount[16:24], disputeTimeUsed[24:88], pending[88].
    event JobState(uint256 indexed jobId, uint256 stateVersion, Status status, uint256 clockPack, uint256 deliveryVersion, uint256 counters, uint64 faultDeadline);
    event DeliverySubmitted(uint256 indexed jobId, address indexed operator, uint256 stateVersion, bytes32 blobHash);
    event RevisionRequested(uint256 indexed jobId, uint256 indexed revision, bytes32 criterionHash, bytes32 referenceHash, uint64 deadline);
    event RevisionSubmitted(uint256 indexed jobId, uint256 indexed revision, bytes32 blobHash);
    event AccessReported(uint256 indexed jobId, uint8 reports, uint64 repairDeadline);
    event AccessRecovered(uint256 indexed jobId, bytes32 blobHash);
    event DeliveryExtensionRequested(uint256 indexed jobId, uint256 indexed requestId, uint64 requestedDeadline, uint64 expiry);
    event DeliveryExtensionGranted(uint256 indexed jobId, uint256 indexed requestId, uint64 newDeadline);
    event DeliveryExtensionRejected(uint256 indexed jobId, uint256 indexed requestId);
    event DeliveryExtensionRevoked(uint256 indexed jobId, uint256 indexed requestId);
    event DisputeOpened(uint256 indexed jobId, address indexed opener, uint8 number, uint64 hardDeadline);
    event DisputeResolved(uint256 indexed jobId, DisputeOutcome outcome, uint256 grossPayout, uint256 refund, bytes32 reasonHash, bytes32 evidenceHash);
    event MutualProposed(uint256 indexed jobId, uint256 version, uint256 refund, uint256 grossPayout, uint64 expiry);
    event MutualRejected(uint256 indexed jobId, uint256 version);
    event MutualRevoked(uint256 indexed jobId, uint256 version);
    event Settled(uint256 indexed jobId, uint256 grossPayout, uint256 refund, uint256 fee, address indexed operator);
    event CreditWithdrawn(address indexed account, uint256 amount);

    event OperatorRegistered(address indexed operator);
    event PolicyChanged(uint256 minReward, uint256 feeBps);
    event DisputeHeartbeat(uint256 indexed jobId, uint8 reviewingCount, uint64 effectiveDeadline, bytes32 reasonHash, bytes32 evidenceHash);
    event DisputeResumed(uint256 indexed jobId, Status restoredState, uint64 deliveryDeadline, uint64 reviewDeadline, uint64 correctionDeadline, uint64 extraDelivery, bytes32 reasonHash, bytes32 evidenceHash);
    event FaultReviewOpened(uint256 indexed jobId, uint64 reviewDeadline);
    event FaultReviewResolved(uint256 indexed jobId, uint256 slash, bytes32 reasonHash, bytes32 evidenceHash);
    event FaultReviewReleased(uint256 indexed jobId);
    event OperatorFaultDeclared(uint256 indexed jobId, address indexed operator, uint256 slashedAmount);
    event TreasuryChanged(address indexed previousTreasury, address indexed newTreasury);
    event HouseStatusChanged(address indexed account, bool previousValue, bool newValue);
    event TestClientStatusChanged(address indexed account, bool previousValue, bool newValue);
    event ResolverPolicyChanged(address indexed client, address indexed previousResolver, address indexed newResolver);

    error InvalidDuration(); error InvalidState(); error Unauthorized(); error StaleVersion(); error Deadline(); error InvalidSignature(); error Insolvent(); error Conflict(); error InvalidTerms();
    error ZeroAddress(); error InvalidPolicy(); error AmountZero(); error InsufficientFreeStake(); error OperatorOnly(); error MutualInactive(); error NoCredit();

    constructor(address token, address initialOwner, address initialTreasury, address vault)
        Ownable(initialOwner) EIP712("AlphaBoard Agent Marketplace V2", "1") {
        if (token == address(0) || initialOwner == address(0) || initialTreasury == address(0) || vault.code.length == 0) revert ZeroAddress();
        if (IOperatorCollateralVaultV2(vault).token() != token || IOperatorCollateralVaultV2(vault).marketplace() != address(this) || IOperatorCollateralVaultV2(vault).treasury() != initialTreasury) revert InvalidTerms();
        usdc = IERC20(token); treasury = initialTreasury; collateralVault = IOperatorCollateralVaultV2(vault);
    }


    modifier versioned(uint256 id, uint256 expected) { if (jobs[id].stateVersion != expected) revert StaleVersion(); jobs[id].stateVersion++; _; _emitState(id); }
    modifier expectedState(uint256 id, uint256 expected) { if (jobs[id].stateVersion != expected) revert StaleVersion(); _; }

    modifier party(uint256 id) { if (msg.sender != jobs[id].client && msg.sender != jobs[id].operator) revert Unauthorized(); _; }

    function _emitState(uint256 id) internal {
        Job storage j = jobs[id];
        uint256 clocks = uint256(j.deliveryDeadline) | (uint256(j.reviewDeadline) << 64) | (uint256(j.correctionDeadline) << 128) | (uint256(j.repairDeadline) << 192);
        uint256 counters = uint256(j.accessReports) | (uint256(j.disputeCount) << 8) | (uint256(j.reviewingCount) << 16) | (uint256(j.disputeTimeUsed) << 24) | (uint256(j.extensionState==ExtensionState.Pending ? 1 : 0) << 88);
        emit JobState(id,j.stateVersion,j.status,clocks,j.deliveryVersion,counters,j.faultReviewDeadline);
    }

    function renounceOwnership() public override onlyOwner { revert Unauthorized(); }
    function setPolicy(uint256 newMinReward, uint256 newFeeBps) external onlyOwner { if (newFeeBps > MAX_FEE_BPS || newMinReward == 0) revert InvalidPolicy(); minReward = newMinReward; feeBps = newFeeBps; emit PolicyChanged(newMinReward, newFeeBps); }
    function setTreasury(address value) external onlyOwner { if (value == address(0)) revert ZeroAddress(); address old = treasury; treasury = value; emit TreasuryChanged(old, value); }
    function setMaxActiveJobs(uint256 value) external { maxActiveJobs[msg.sender] = value; }
    function setHouse(address account, bool value) external onlyOwner { if (!value) revert Conflict(); bool old = listedHouse[account]; listedHouse[account] = value; emit HouseStatusChanged(account, old, value); }
    function setTestClient(address account, bool value) external onlyOwner { bool old = testClient[account]; testClient[account] = value; emit TestClientStatusChanged(account, old, value); }
    function setResolverForClient(address client, address account) external onlyOwner { if (client == address(0)) revert Unauthorized(); address old = resolverPolicy[client]; resolverPolicy[client] = account; emit ResolverPolicyChanged(client, old, account); }
    function invalidateAllApplications() external { unchecked { nonceEpoch[msg.sender]++; } }

    function postJob(
        uint256 reward, uint64 applyBy, uint64 deliveryDuration, uint64 reviewDuration, uint64 revisionDuration,
        uint8 revisionLimit, bool unlimitedRevisions, bytes32 criteriaHash, bytes32 descriptionHash, bool testJob
    ) external nonReentrant returns (uint256 id) {
        if (reward < minReward || reward > type(uint128).max || applyBy < block.timestamp + MIN_DURATION || applyBy > block.timestamp + MAX_APPLY || deliveryDuration < MIN_DURATION || deliveryDuration > MAX_DELIVERY || reviewDuration < 24 hours || reviewDuration > MAX_REVIEW || revisionDuration < 12 hours || revisionDuration > MAX_REVISION) revert InvalidDuration();
        if (testJob && !testClient[msg.sender]) revert Conflict();
        id = nextJobId++;
        Job storage j = jobs[id];
        j.client = msg.sender; j.reward = uint128(reward); j.createdAt = uint64(block.timestamp);
        j.applyBy = applyBy; j.deliveryDuration = deliveryDuration; j.deliveryDeadline = 0;
        j.reviewDuration = reviewDuration; j.revisionDuration = revisionDuration;
        j.revisionLimit = revisionLimit; j.unlimitedRevisions = unlimitedRevisions;
        j.testJob = testJob; j.house = false; j.status = Status.Open;
        j.resolver = resolverPolicy[msg.sender] == address(0) ? owner() : resolverPolicy[msg.sender];
        if (j.resolver == address(0)) revert ZeroAddress();
        if (j.resolver == msg.sender) revert Conflict();
        j.criteriaHash = criteriaHash; j.descriptionHash = descriptionHash;
        j.feeBpsSnapshot = feeBps; j.treasurySnapshot = treasury; j.minRewardSnapshot = minReward;
        j.canonicalTermsHash = keccak256(abi.encode(
            address(usdc), address(collateralVault), j.resolver, reward, j.feeBpsSnapshot, j.treasurySnapshot, j.minRewardSnapshot,
            deliveryDuration, reviewDuration, revisionDuration, MAX_EXTENSION_TOTAL, STAKE_FLOOR, STAKE_ROUND, uint256(1000), TERMS_SCHEMA,
            revisionLimit, unlimitedRevisions, applyBy, criteriaHash, descriptionHash, testJob
        ));
        j.stateVersion = 1;
        usdc.safeTransferFrom(msg.sender, address(this), reward); escrowed += reward; _solvent();
        emit JobPosted(id,msg.sender,reward,applyBy,criteriaHash,descriptionHash,testJob,false);
        emit JobTerms(id,j.canonicalTermsHash,reward,j.feeBpsSnapshot,j.treasurySnapshot,j.minRewardSnapshot,j.resolver,deliveryDuration,reviewDuration,revisionDuration,revisionLimit,unlimitedRevisions,MAX_EXTENSION_TOTAL | (STAKE_FLOOR << 64) | (STAKE_ROUND << 128) | (uint256(1000) << 160));
    }


    function registerOperator() external { if (!registered[msg.sender]) { registered[msg.sender] = true; emit OperatorRegistered(msg.sender); } }
    function requiredStake(uint256 reward) internal view returns (uint256) { return collateralVault.requiredStake(reward); }

    function revokeApplication(uint256 id) external { applicationNonce[id][msg.sender]++; emit ApplicationRevoked(id,msg.sender,applicationNonce[id][msg.sender]); }


    function applicationDigest(ApplicationTerms calldata t) internal view returns (bytes32) { return _hashTypedDataV4(keccak256(abi.encode(APPLICATION_TYPEHASH,t.jobId,t.operator,t.termsHash,t.validAfter,t.validBefore,t.nonceEpoch,t.operatorNonce))); }
    function _validSigner(address signer, bytes32 digest, bytes calldata sig) internal view returns (bool) { if (signer.code.length == 0) return ECDSA.recover(digest,sig) == signer; (bool ok,bytes memory out)=signer.staticcall(abi.encodeCall(IERC1271.isValidSignature,(digest,sig))); return ok && out.length >= 4 && bytes4(out) == ERC1271_MAGIC; }

    function awardJob(uint256 id, ApplicationTerms calldata t, bytes calldata sig) external nonReentrant versioned(id, jobs[id].stateVersion) {
        Job storage j=jobs[id]; if (j.status != Status.Open || j.client != msg.sender || t.jobId != id || t.operator == msg.sender || t.operator == address(0) || !registered[t.operator] || t.termsHash != j.canonicalTermsHash || t.nonceEpoch != nonceEpoch[t.operator] || t.operatorNonce != applicationNonce[id][t.operator] || t.validBefore > j.applyBy || t.validAfter >= t.validBefore || block.timestamp < t.validAfter || block.timestamp >= t.validBefore || block.timestamp >= j.applyBy || !_validSigner(t.operator,applicationDigest(t),sig)) revert InvalidSignature();

        if (t.operator == j.resolver) revert Conflict();
        if (listedHouse[t.operator] && (!j.testJob || !testClient[j.client])) revert Conflict();
        if (maxActiveJobs[t.operator] != 0 && activeJobs[t.operator] >= maxActiveJobs[t.operator]) revert InvalidTerms();
        uint256 need=requiredStake(j.reward); if (collateralVault.freeStake(t.operator) < need) revert InvalidTerms();
        j.operator=t.operator; j.house=listedHouse[t.operator]; j.stakeReserved=need; j.deliveryDeadline=uint64(block.timestamp+j.deliveryDuration); j.status=Status.InProgress; collateralVault.reserve(id, t.operator, j.client, need); activeJobs[t.operator]++;
        emit JobAwarded(id,t.operator,need,t.termsHash);
    }

    function requestDeliveryExtension(uint256 id, uint64 requestedDeadline, uint64 expiry, uint256 expected) external nonReentrant expectedState(id,expected) {
        Job storage j = jobs[id];
        if (msg.sender != j.operator || j.status != Status.InProgress || block.timestamp >= j.deliveryDeadline || j.extensionState == ExtensionState.Pending) revert InvalidState();
        uint256 remainingExtension = MAX_EXTENSION_TOTAL - j.deliveryDuration - j.extensionTotal;
        if (requestedDeadline <= j.deliveryDeadline || requestedDeadline > j.deliveryDeadline + remainingExtension) revert InvalidDuration();
        if (expiry <= block.timestamp || expiry > j.deliveryDeadline) revert Deadline();
        j.extensionRequestId++;
        j.extensionRequestedDeadline = requestedDeadline;
        j.extensionExpiry = expiry;
        j.extensionSnapshotDeadline = j.deliveryDeadline;
        j.extensionState = ExtensionState.Pending;
        emit DeliveryExtensionRequested(id,j.extensionRequestId,requestedDeadline,expiry);
    }

    function grantDeliveryExtension(uint256 id, uint64 requestId, uint256 expected) external nonReentrant versioned(id,expected) {
        Job storage j = jobs[id];
        if (msg.sender != j.client || j.status != Status.InProgress || j.extensionState != ExtensionState.Pending || requestId != j.extensionRequestId || block.timestamp >= j.deliveryDeadline || block.timestamp >= j.extensionExpiry || j.deliveryDeadline != j.extensionSnapshotDeadline) revert InvalidState();
        uint64 delta = j.extensionRequestedDeadline - j.deliveryDeadline;
        if (delta == 0 || j.deliveryDuration + j.extensionTotal + delta > MAX_EXTENSION_TOTAL) revert InvalidDuration();
        j.extensionTotal += delta;
        j.deliveryDeadline = j.extensionRequestedDeadline;
        j.extensionState = ExtensionState.Granted;
        emit DeliveryExtensionGranted(id,requestId,j.deliveryDeadline);
    }

    function rejectDeliveryExtension(uint256 id, uint64 requestId, uint256 expected) external nonReentrant expectedState(id,expected) {
        Job storage j = jobs[id];
        if (msg.sender != j.client || j.status != Status.InProgress || j.extensionState != ExtensionState.Pending || requestId != j.extensionRequestId) revert InvalidState();
        j.extensionState = ExtensionState.Rejected;
        emit DeliveryExtensionRejected(id,requestId);
    }

    function revokeDeliveryExtension(uint256 id, uint64 requestId, uint256 expected) external nonReentrant expectedState(id,expected) {
        Job storage j = jobs[id];
        if (msg.sender != j.operator || j.status != Status.InProgress || j.extensionState != ExtensionState.Pending || requestId != j.extensionRequestId) revert InvalidState();
        j.extensionState = ExtensionState.Revoked;
        emit DeliveryExtensionRevoked(id,requestId);
    }

    function submitDelivery(uint256 id, bytes32 blobHash, uint256 expected) external nonReentrant versioned(id,expected) {
        Job storage j=jobs[id]; if (msg.sender != j.operator || j.status != Status.InProgress || blobHash==bytes32(0) || block.timestamp >= j.deliveryDeadline) revert InvalidState(); j.deliveryHash=blobHash; j.deliveryVersion++; j.accessReports=0; j.accessReportDeliveryVersion=uint64(j.deliveryVersion); j.reviewDeadline=uint64(block.timestamp+j.reviewDuration); j.status=Status.Submitted; emit DeliverySubmitted(id,msg.sender,j.stateVersion,blobHash);
    }
    function requestRevision(uint256 id, bytes32 criterionHash, bytes32 referenceHash, uint64 expected) external nonReentrant versioned(id,expected) { Job storage j=jobs[id]; if(msg.sender!=j.client || j.status!=Status.Submitted || block.timestamp>=j.reviewDeadline || criterionHash==bytes32(0) || referenceHash==bytes32(0) || (!j.unlimitedRevisions && j.revisionsUsed>=j.revisionLimit)) revert InvalidState(); j.revisionsUsed++; j.revisionCriterionHash=criterionHash; j.revisionReferenceHash=referenceHash; j.correctionDeadline=uint64(block.timestamp+j.revisionDuration); j.status=Status.RevisionPending; emit RevisionRequested(id,j.revisionsUsed,criterionHash,referenceHash,j.correctionDeadline); }
    function submitRevision(uint256 id, bytes32 blobHash, uint256 expected) external nonReentrant versioned(id,expected) { Job storage j=jobs[id]; if(msg.sender!=j.operator || j.status!=Status.RevisionPending || block.timestamp>=j.correctionDeadline || blobHash==bytes32(0)) revert InvalidState(); j.previousDeliveryHash=j.deliveryHash; j.deliveryHash=blobHash; j.deliveryVersion++; j.accessReports=0; j.accessReportDeliveryVersion=uint64(j.deliveryVersion); j.reviewDeadline=uint64(block.timestamp+j.reviewDuration); j.status=Status.Submitted; emit RevisionSubmitted(id,j.revisionsUsed,blobHash); }
    function reportAccess(uint256 id, uint256 expected) external nonReentrant versioned(id,expected) { Job storage j=jobs[id]; if(msg.sender!=j.client || j.status!=Status.Submitted || block.timestamp>=j.reviewDeadline || j.accessReportDeliveryVersion!=j.deliveryVersion || j.accessReports>=2 || j.reviewDeadline<=block.timestamp) revert InvalidState(); j.accessReports++; j.savedReviewRemaining=uint64(j.reviewDeadline-block.timestamp); j.repairDeadline=uint64(block.timestamp+24 hours); j.status=Status.AccessRecovery; emit AccessReported(id,j.accessReports,j.repairDeadline); }
    function recoverAccess(uint256 id, bytes32 newHash, uint256 expected) external nonReentrant versioned(id,expected) { Job storage j=jobs[id]; if(msg.sender != j.operator || j.status != Status.AccessRecovery || block.timestamp>=j.repairDeadline || newHash==bytes32(0) || j.accessReportDeliveryVersion!=j.deliveryVersion) revert InvalidState(); j.deliveryHash=newHash; j.reviewDeadline=uint64(block.timestamp+j.savedReviewRemaining); j.status=Status.Submitted; emit AccessRecovered(id,newHash); }

    function approve(uint256 id, uint256 expected) external nonReentrant versioned(id,expected) { Job storage j=jobs[id]; if(msg.sender!=j.client || (j.status!=Status.Submitted && j.status!=Status.RevisionPending) || !_financialWindowOpen(j)) revert InvalidState(); _settle(id,j.reward,0); }
    function claimReviewTimeout(uint256 id, uint256 expected) external nonReentrant versioned(id,expected) { Job storage j=jobs[id]; if(j.status!=Status.Submitted || block.timestamp<j.reviewDeadline) revert Deadline(); _settle(id,j.reward,0); }
    function claimDeliveryTimeout(uint256 id, uint256 expected) external nonReentrant versioned(id,expected) { Job storage j=jobs[id]; if(j.status!=Status.InProgress || block.timestamp<j.deliveryDeadline || j.deadlineFailureClaimed) revert Deadline(); j.deadlineFailureClaimed=true; deadlineFailures[j.operator]++; j.faultReviewPending=true; j.faultReviewDeadline=uint64(block.timestamp+7 days); collateralVault.markFault(id,j.faultReviewDeadline); emit FaultReviewOpened(id,j.faultReviewDeadline); _settleFailure(id); }

    function cancelOpenJob(uint256 id, uint256 expected) external nonReentrant versioned(id,expected) { Job storage j=jobs[id]; if(msg.sender!=j.client || j.status!=Status.Open || block.timestamp>=j.applyBy) revert InvalidState(); _settle(id,0,j.reward); }
    function claimOpenJobTimeout(uint256 id, uint256 expected) external nonReentrant versioned(id,expected) { Job storage j=jobs[id]; if(j.status!=Status.Open || block.timestamp<j.applyBy) revert Deadline(); _settle(id,0,j.reward); }

    function openDispute(uint256 id, uint256 expected) external nonReentrant versioned(id,expected) party(id) { Job storage j=jobs[id]; if(j.status<Status.InProgress || j.status==Status.Disputed || j.status>=Status.Completed || j.disputeCount>=2 || !_financialWindowOpen(j)) revert Conflict(); _authorizedResolver(j); _openDispute(j,id); }
    function triggerAccessRecoveryDispute(uint256 id, uint256 expected) external nonReentrant versioned(id,expected) { Job storage j=jobs[id]; if(j.status!=Status.AccessRecovery || block.timestamp<j.repairDeadline || j.disputeCount>=2) revert Conflict(); _authorizedResolver(j); _openDispute(j,id); }
    function resolveDispute(uint256 id, uint256 grossPayout, bool operatorFault, bytes32 reasonHash, bytes32 evidenceHash, uint256 expected) external nonReentrant versioned(id,expected) { Job storage j=jobs[id]; _authorizedResolver(j); if(j.status!=Status.Disputed || msg.sender!=j.resolver || j.house || block.timestamp>=_effectiveDisputeDeadline(j) || grossPayout>j.reward || reasonHash==bytes32(0) || evidenceHash==bytes32(0)) revert Unauthorized(); uint256 refund=j.reward-grossPayout; if(operatorFault && (refund==0 || j.operator==address(0) || j.stakeReserved==0)) revert Conflict(); if(operatorFault){ collateralVault.markFault(id,uint64(block.timestamp+7 days)); j.faultReviewPending=true; _settle(id,grossPayout,refund); uint256 slash=j.stakeReserved; collateralVault.slashAndRelease(id,slash); j.stakeReserved=0; j.faultReviewPending=false; credits[j.client]+=slash; creditsLiability+=slash; emit OperatorFaultDeclared(id,j.operator,slash); _solvent(); } else { _settle(id,grossPayout,refund); } emit DisputeResolved(id,grossPayout==0?DisputeOutcome.ClientRefund:(grossPayout==j.reward?DisputeOutcome.FullOperator:DisputeOutcome.Partial),grossPayout,refund,reasonHash,evidenceHash); }
    function heartbeatDispute(uint256 id, bytes32 reasonHash, bytes32 evidenceHash, uint256 expected) external nonReentrant versioned(id,expected) { Job storage j=jobs[id]; _authorizedResolver(j); if(j.status!=Status.Disputed || msg.sender!=j.resolver || j.house || block.timestamp>=_effectiveDisputeDeadline(j) || reasonHash==bytes32(0) || evidenceHash==bytes32(0) || j.reviewingCount>=2) revert Unauthorized(); j.reviewingCount++; j.lastAdminActionAt=uint64(block.timestamp); emit DisputeHeartbeat(id,j.reviewingCount,uint64(_effectiveDisputeDeadline(j)),reasonHash,evidenceHash); }
    function resumeWork(uint256 id, uint64 extraDelivery, bytes32 reasonHash, bytes32 evidenceHash, uint256 expected) external nonReentrant versioned(id,expected) { Job storage j=jobs[id]; _authorizedResolver(j); if(j.status!=Status.Disputed || j.disputeCount!=1 || msg.sender!=j.resolver || j.house || block.timestamp>=_effectiveDisputeDeadline(j) || reasonHash==bytes32(0) || evidenceHash==bytes32(0)) revert Unauthorized(); uint256 elapsed=block.timestamp-j.episodeStart; j.disputeTimeUsed+=uint64(elapsed); Status restored=j.previousStatus; if(restored==Status.InProgress){ if(j.deliveryDuration+j.extensionTotal+extraDelivery>MAX_EXTENSION_TOTAL) revert InvalidDuration(); j.deliveryDeadline=uint64(block.timestamp+j.savedDeliveryRemaining+extraDelivery); j.extensionTotal+=extraDelivery; } else if(restored==Status.Submitted){ j.reviewDeadline=uint64(block.timestamp+j.savedReviewRemaining); } else if(restored==Status.RevisionPending){ j.correctionDeadline=uint64(block.timestamp+j.savedCorrectionRemaining); } else if(restored==Status.AccessRecovery){ j.repairDeadline=uint64(block.timestamp+j.savedRepairRemaining); } else revert InvalidState(); j.status=restored; emit DisputeResumed(id,restored,j.deliveryDeadline,j.reviewDeadline,j.correctionDeadline,extraDelivery,reasonHash,evidenceHash); }

    function proposeMutual(uint256 id,uint256 refund,uint256 grossPayout,uint64 expiry,uint256 expected) external nonReentrant expectedState(id,expected) party(id) { Job storage j=jobs[id]; if(refund+grossPayout!=j.reward || expiry<=block.timestamp || j.status>=Status.Completed || !_financialWindowOpen(j)) revert InvalidTerms(); mutual[id]=MutualRequest({version:mutual[id].version+1,jobStateVersion:j.stateVersion,refund:uint128(refund),grossPayout:uint128(grossPayout),expiry:expiry,proposer:msg.sender,active:true}); emit MutualProposed(id,mutual[id].version,refund,grossPayout,expiry); }
    function rejectMutual(uint256 id,uint256 expected) external nonReentrant expectedState(id,expected) { if (!mutual[id].active || msg.sender == mutual[id].proposer || (msg.sender != jobs[id].client && msg.sender != jobs[id].operator)) revert MutualInactive(); mutual[id].active=false; emit MutualRejected(id,mutual[id].version); }
    function revokeMutual(uint256 id,uint256 expected) external nonReentrant expectedState(id,expected) { MutualRequest storage m=mutual[id]; if (!m.active || msg.sender != m.proposer) revert MutualInactive(); m.active=false; emit MutualRevoked(id,m.version); }
    function acceptMutual(uint256 id,uint256 expected,uint256 expectedRequestVersion) external nonReentrant versioned(id,expected) party(id) { Job storage j=jobs[id]; MutualRequest storage m=mutual[id]; if(!m.active || m.version!=expectedRequestVersion || m.jobStateVersion!=expected || m.proposer==msg.sender || block.timestamp>=m.expiry || j.status>=Status.Completed || !_financialWindowOpen(j)) revert InvalidTerms(); m.active=false; _settle(id,m.grossPayout,m.refund); }

    function resolveFaultReview(uint256 id, uint256 slash, bytes32 reasonHash, bytes32 evidenceHash, uint256 expected) external nonReentrant versioned(id,expected) { Job storage j=jobs[id]; _authorizedResolver(j); if(!j.faultReviewPending || msg.sender!=j.resolver || j.house || block.timestamp>=j.faultReviewDeadline || reasonHash==bytes32(0) || evidenceHash==bytes32(0) || slash>j.stakeReserved) revert Unauthorized(); _releaseFaultReserve(j,id,slash); emit FaultReviewResolved(id,slash,reasonHash,evidenceHash); }
    function releaseFaultReview(uint256 id, uint256 expected) external nonReentrant versioned(id,expected) { Job storage j=jobs[id]; _authorizedResolver(j); if(!j.faultReviewPending || block.timestamp<j.faultReviewDeadline) revert Deadline(); collateralVault.releaseFault(id); j.stakeReserved=0; j.faultReviewPending=false; emit FaultReviewReleased(id); }
    function claimDisputeTimeout(uint256 id, uint256 expected) external nonReentrant versioned(id,expected) { Job storage j=jobs[id]; if(j.status!=Status.Disputed || block.timestamp<_effectiveDisputeDeadline(j)) revert Deadline(); _settle(id,0,j.reward); }
    function withdrawCredit() external nonReentrant { uint256 amount=credits[msg.sender]; if (amount == 0) revert NoCredit(); credits[msg.sender]=0; creditsLiability-=amount; usdc.safeTransfer(msg.sender,amount); emit CreditWithdrawn(msg.sender,amount); _solvent(); }
    function _settleFailure(uint256 id) internal { Job storage j=jobs[id]; uint256 reward=j.reward; _closeActive(j); credits[j.client]+=reward; creditsLiability+=reward; escrowed-=reward; j.status=Status.Refunded; emit Settled(id,0,reward,0,j.operator); _solvent(); }
    function _settle(uint256 id,uint256 grossPayout,uint256 refund) internal { Job storage j=jobs[id]; if(j.status>=Status.Completed) revert InvalidState(); if(j.status==Status.Disputed){ uint256 priorUsed=j.disputeTimeUsed; uint256 deadline=_effectiveDisputeDeadline(j); uint256 until=block.timestamp<deadline?block.timestamp:deadline; j.disputeTimeUsed=uint64(priorUsed+(until-j.episodeStart)); } uint256 fee=(grossPayout*j.feeBpsSnapshot)/BPS; credits[j.treasurySnapshot]+=fee; credits[j.operator]+=grossPayout-fee; credits[j.client]+=refund; creditsLiability+=j.reward; escrowed-=j.reward; _closeActive(j); j.status=(grossPayout==0)?Status.Refunded:Status.Completed; mutual[id].active=false; if(j.operator!=address(0) && !j.faultReviewPending){ collateralVault.release(id); j.stakeReserved=0; } emit Settled(id,grossPayout,refund,fee,j.operator); _solvent(); }
    function _releaseFaultReserve(Job storage j,uint256 id,uint256 slash) internal { if (slash > j.stakeReserved) revert InvalidTerms(); collateralVault.slashAndRelease(id,slash); if (slash != 0) { credits[j.client]+=slash; creditsLiability+=slash; } j.stakeReserved=0; j.faultReviewPending=false; }
    function _openDispute(Job storage j, uint256 id) internal { j.disputeCount++; j.previousStatus=j.status; j.savedDeliveryRemaining=j.status==Status.InProgress && j.deliveryDeadline>block.timestamp?uint64(j.deliveryDeadline-block.timestamp):0; j.savedReviewRemaining=j.status==Status.Submitted && j.reviewDeadline>block.timestamp?uint64(j.reviewDeadline-block.timestamp):j.savedReviewRemaining; j.savedCorrectionRemaining=j.status==Status.RevisionPending && j.correctionDeadline>block.timestamp?uint64(j.correctionDeadline-block.timestamp):0; j.savedRepairRemaining=j.status==Status.AccessRecovery && block.timestamp<j.repairDeadline?uint64(j.repairDeadline-block.timestamp):0; uint64 episode=(j.status==Status.AccessRecovery && block.timestamp>=j.repairDeadline)?j.repairDeadline:uint64(block.timestamp); j.episodeStart=episode; j.lastAdminActionAt=episode; j.status=Status.Disputed; emit DisputeOpened(id,msg.sender,j.disputeCount,uint64(_effectiveDisputeDeadline(j))); }
    function _effectiveDisputeDeadline(Job storage j) internal view returns(uint256) { uint256 hard=j.episodeStart+MAX_ARBITRATION-j.disputeTimeUsed; uint256 idle=j.lastAdminActionAt+7 days; return hard<idle?hard:idle; }
    function _financialWindowOpen(Job storage j) internal view returns (bool) { if (j.status==Status.InProgress) return block.timestamp<j.deliveryDeadline; if (j.status==Status.Submitted) return block.timestamp<j.reviewDeadline; if (j.status==Status.RevisionPending) return true; if (j.status==Status.AccessRecovery) return block.timestamp<j.repairDeadline; if (j.status==Status.Disputed) return block.timestamp<_effectiveDisputeDeadline(j); return true; }

    function _solvent() internal view { if(usdc.balanceOf(address(this)) < escrowed+creditsLiability) revert Insolvent(); }

    function _authorizedResolver(Job storage j) internal view {
        if (j.resolver == address(0) || j.resolver == j.client || j.resolver == j.operator) revert Conflict();
    }

    function _closeActive(Job storage j) internal {
        if (j.operator != address(0) && j.status < Status.Completed) activeJobs[j.operator]--;
    }
}
