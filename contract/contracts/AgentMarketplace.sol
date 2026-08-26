// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";


/// @title AgentMarketplace
/// @notice On-chain AI agent job marketplace with USDC escrow, built for Arc Testnet.
/// @dev Reward funds are held in ERC-20 USDC (6 decimals on Arc). Native gas is paid in USDC.
contract AgentMarketplace is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice ERC-20 USDC token used for job rewards (Arc Testnet: 0x3600...0000).
    IERC20 public immutable usdc;
    uint256 public constant AGENT_STAKE = 100_000000; // 100 USDC
    // One USDC keeps reputation farming materially more expensive than gas
    // while remaining accessible for legitimate testnet jobs.
    uint256 public constant MIN_JOB_REWARD = 1_000000; // 1 USDC
    uint256 public constant REPUTATION_FEE_BPS = 100; // 1% per new distinct-client point
    /// @notice Slashed registration stake stays at this non-withdrawable sink.
    /// @dev Arc'ta yakma mümkün olmadığı için slash edilen stake burada kalır; kasıtlıdır.
    address public immutable SLASH_SINK;
    uint256 public constant DELIVERY_TIMEOUT = 30 days;
    uint256 public constant APPROVAL_TIMEOUT = 30 days;
    uint256 public constant DISPUTE_TIMEOUT = 30 days;
    uint256 public constant DEFAULT_CLIENT_SHARE_ON_DISPUTE = 5000; // 50%, fixed at job creation

    enum JobStatus {
        Open,        // funded, waiting for an agent
        InProgress,  // an agent accepted the job
        Submitted,   // agent submitted the deliverable
        Disputed,    // client disputed the submitted deliverable
        Completed,   // client approved, reward paid out
        Cancelled,   // client cancelled before an agent accepted (refunded)
        ExpiredRefund,
        ExpiredPayout,
        ExpiredSplit
    }

    struct Agent {
        string name;
        string skill;
        uint256 fee;            // suggested fee in USDC base units (6 decimals)
        uint256 distinctClients;
        uint256 inProgress;
        uint256 submitted;
        uint256 approvedDeliveries;
        uint256 disputes;
        uint256 totalEarned;    // USDC base units paid through approved jobs
        uint256 stake;           // USDC held as slashable registration collateral
        uint256 activeJobs;      // jobs not yet settled
        bool registered;
    }

    struct Job {
        uint256 id;
        address client;
        address agent;
        string description;
        string deliverableURI;
        uint256 reward;         // USDC base units held in escrow
        JobStatus status;
        uint256 createdAt;
        uint256 deliveryDeadline;
        uint256 approvalDeadline;
        uint256 disputeDeadline;
        uint256 clientShareOnDispute; // reward share in basis points, fixed at creation
    }

    mapping(address => Agent) public agents;
    mapping(address => mapping(address => bool)) private servedClient;
    mapping(uint256 => Job) public jobs;
    uint256 public jobCount;
    uint256 private _slashSinkBalance;
    uint256 private _reputationFeeSink;

    event AgentRegistered(address indexed agent, string name, string skill, uint256 fee);
    event JobPosted(uint256 indexed jobId, address indexed client, uint256 reward, string description);
    event JobAccepted(uint256 indexed jobId, address indexed agent);
    event DeliverableSubmitted(uint256 indexed jobId, string deliverableURI);
    event JobApproved(uint256 indexed jobId, address indexed agent, uint256 reward);
    event ReputationFeeCharged(uint256 indexed jobId, address indexed agent, uint256 amount);
    event JobDisputed(uint256 indexed jobId, address indexed agent);
    event JobCancelled(uint256 indexed jobId);
    event JobExpiredRefunded(uint256 indexed jobId, address indexed client, uint256 reward);
    event JobExpiredPaid(uint256 indexed jobId, address indexed agent, uint256 reward);
    event JobExpiredSplit(
        uint256 indexed jobId,
        address indexed client,
        address indexed agent,
        uint256 clientAmount,
        uint256 agentAmount
    );
    event AgentSlashed(address indexed agent, uint256 amount);

    constructor(address usdcAddress) {
        require(usdcAddress != address(0), "USDC address required");
        usdc = IERC20(usdcAddress);
        SLASH_SINK = address(this);
    }

    // ---------------------------------------------------------------------
    // Agent registry
    // ---------------------------------------------------------------------

    /// @notice Register (or update) the caller as an AI agent.
    function registerAgent(string calldata name, string calldata skill, uint256 fee) external nonReentrant {
        require(bytes(name).length > 0, "Name required");
        Agent storage a = agents[msg.sender];
        require(a.activeJobs == 0, "Active job exists");
        if (!a.registered) {
            usdc.safeTransferFrom(msg.sender, address(this), AGENT_STAKE);
            a.stake = AGENT_STAKE;
        }
        a.name = name;
        a.skill = skill;
        a.fee = fee;
        a.registered = true;
        emit AgentRegistered(msg.sender, name, skill, fee);
    }

    // ---------------------------------------------------------------------
    // Jobs
    // ---------------------------------------------------------------------

    /// @notice Post a job and lock `reward` USDC in escrow.
    /// @dev Caller must approve this contract for `reward` USDC first.
    function postJob(string calldata description, uint256 reward) external nonReentrant returns (uint256) {
        require(reward >= MIN_JOB_REWARD, "Reward below minimum");
        require(bytes(description).length > 0, "Description required");

        uint256 jobId = ++jobCount;
        jobs[jobId] = Job({
            id: jobId,
            client: msg.sender,
            agent: address(0),
            description: description,
            deliverableURI: "",
            reward: reward,
            status: JobStatus.Open,
            createdAt: block.timestamp,
            deliveryDeadline: 0,
            approvalDeadline: 0,
            disputeDeadline: 0,
            clientShareOnDispute: DEFAULT_CLIENT_SHARE_ON_DISPUTE
        });

        // Pull the reward into escrow.
        usdc.safeTransferFrom(msg.sender, address(this), reward);

        emit JobPosted(jobId, msg.sender, reward, description);
        return jobId;
    }

    /// @notice An agent accepts an open job.
    function acceptJob(uint256 jobId) external {
        Job storage job = jobs[jobId];
        require(job.id != 0, "Job not found");
        require(job.status == JobStatus.Open, "Job not open");
        require(agents[msg.sender].registered, "Register as agent first");
        require(msg.sender != job.client, "Client cannot accept own job");

        job.agent = msg.sender;
        job.status = JobStatus.InProgress;
        job.deliveryDeadline = block.timestamp + DELIVERY_TIMEOUT;
        agents[msg.sender].inProgress += 1;
        agents[msg.sender].activeJobs += 1;
        emit JobAccepted(jobId, msg.sender);
    }

    /// @notice The assigned agent submits the deliverable (e.g. an IPFS/URL link).
    function submitDeliverable(uint256 jobId, string calldata deliverableURI) external {
        Job storage job = jobs[jobId];
        require(job.id != 0, "Job not found");
        require(msg.sender == job.agent, "Only assigned agent");
        require(job.status == JobStatus.InProgress, "Job not in progress");
        require(bytes(deliverableURI).length > 0, "Deliverable required");

        job.deliverableURI = deliverableURI;
        job.status = JobStatus.Submitted;
        job.approvalDeadline = block.timestamp + APPROVAL_TIMEOUT;
        agents[msg.sender].inProgress -= 1;
        agents[msg.sender].submitted += 1;
        emit DeliverableSubmitted(jobId, deliverableURI);
    }

    /// @notice The client approves the work and releases the escrowed USDC to the agent.
    function approveAndPay(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        require(job.id != 0, "Job not found");
        require(msg.sender == job.client, "Only client");
        require(job.status == JobStatus.Submitted, "Nothing to approve");

        job.status = JobStatus.Completed;
        agents[job.agent].approvedDeliveries += 1;
        agents[job.agent].activeJobs -= 1;
        uint256 reputationFee;
        if (!servedClient[job.agent][job.client]) {
            servedClient[job.agent][job.client] = true;
            agents[job.agent].distinctClients += 1;
            reputationFee = (job.reward * REPUTATION_FEE_BPS) / 10000;
            // MIN_JOB_REWARD keeps this strictly positive, so every additional
            // distinct-client reputation point has a non-amortizable USDC cost.
            require(reputationFee > 0, "Reputation fee rounds to zero");
        }

        uint256 payout = job.reward - reputationFee;
        agents[job.agent].totalEarned += payout;
        if (reputationFee > 0) {
            // Keep the fee in-contract so approval cannot depend on any mutable
            // external recipient's ability to receive USDC.
            _reputationFeeSink += reputationFee;
            emit ReputationFeeCharged(jobId, job.agent, reputationFee);
        }
        usdc.safeTransfer(job.agent, payout);

        emit JobApproved(jobId, job.agent, payout);
    }

    /// @notice The client disputes a submitted deliverable.
    /// @dev Resolution and escrow handling are intentionally left to the dispute flow.
    function disputeJob(uint256 jobId) external {
        Job storage job = jobs[jobId];
        require(job.id != 0, "Job not found");
        require(msg.sender == job.client, "Only client");
        require(job.status == JobStatus.Submitted, "Nothing to dispute");

        job.status = JobStatus.Disputed;
        job.disputeDeadline = block.timestamp + DISPUTE_TIMEOUT;
        agents[job.agent].disputes += 1;
        emit JobDisputed(jobId, job.agent);
    }

    /// @notice Settle a job after its objective, on-chain deadline has passed.
    /// @dev InProgress expiry refunds only the reward and leaves the slashed
    /// registration stake in SLASH_SINK. Later deadlines protect the party that
    /// did perform: a submitted job pays the agent, while a disputed job is split.
    function claimTimeout(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        require(job.id != 0, "Job not found");

        if (job.status == JobStatus.InProgress) {
            require(block.timestamp >= job.deliveryDeadline, "Delivery deadline not reached");
            uint256 stake = agents[job.agent].stake;
            agents[job.agent].stake = 0;
            agents[job.agent].registered = false;
            agents[job.agent].activeJobs -= 1;
            agents[job.agent].distinctClients = 0;
            agents[job.agent].inProgress = 0;
            agents[job.agent].submitted = 0;
            agents[job.agent].approvedDeliveries = 0;
            agents[job.agent].disputes = 0;
            agents[job.agent].totalEarned = 0;
            job.status = JobStatus.ExpiredRefund;
            _slashSinkBalance += stake;
            // Refund only escrow. The slashed registration stake deliberately
            // remains in-contract at SLASH_SINK and has no withdrawal path.
            usdc.safeTransfer(job.client, job.reward);
            emit AgentSlashed(job.agent, stake);
            emit JobExpiredRefunded(jobId, job.client, job.reward);
            return;
        }

        if (job.status == JobStatus.Submitted) {
            require(block.timestamp >= job.approvalDeadline, "Approval deadline not reached");
            agents[job.agent].activeJobs -= 1;
            job.status = JobStatus.ExpiredPayout;
            usdc.safeTransfer(job.agent, job.reward);
            emit JobExpiredPaid(jobId, job.agent, job.reward);
            return;
        }

        if (job.status == JobStatus.Disputed) {
            require(block.timestamp >= job.disputeDeadline, "Dispute deadline not reached");
            agents[job.agent].activeJobs -= 1;
            job.status = JobStatus.ExpiredSplit;
            uint256 clientAmount = (job.reward * job.clientShareOnDispute) / 10000;
            uint256 agentAmount = job.reward - clientAmount;
            usdc.safeTransfer(job.client, clientAmount);
            usdc.safeTransfer(job.agent, agentAmount);
            emit JobExpiredSplit(jobId, job.client, job.agent, clientAmount, agentAmount);
            return;
        }

        revert("Job not timeout eligible");
    }

    /// @notice Compatibility entry point retained only to reject arbitrary slashing.
    /// @dev Slashing is exclusively performed by claimTimeout after a missed deadline.
    function slashAgent(address) external pure {
        revert("Slash requires missed delivery deadline");
    }

    /// @notice Close registration and reclaim stake when no job is active.
    function withdrawStake() external nonReentrant {
        Agent storage agent = agents[msg.sender];
        require(agent.registered, "Agent not registered");
        require(agent.activeJobs == 0, "Active job exists");
        uint256 stake = agent.stake;
        require(stake > 0, "No stake");
        agent.stake = 0;
        agent.registered = false;
        usdc.safeTransfer(msg.sender, stake);
    }

    /// @notice The client cancels a still-open job and gets the escrow refunded.
    function cancelJob(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        require(job.id != 0, "Job not found");
        require(msg.sender == job.client, "Only client");
        require(job.status == JobStatus.Open, "Only open jobs can be cancelled");

        job.status = JobStatus.Cancelled;
        uint256 reward = job.reward;
        usdc.safeTransfer(job.client, reward);

        emit JobCancelled(jobId);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice Return all jobs (fine for a testnet MVP; paginate for production).
    function getAllJobs() external view returns (Job[] memory) {
        Job[] memory list = new Job[](jobCount);
        for (uint256 i = 0; i < jobCount; i++) {
            list[i] = jobs[i + 1];
        }
        return list;
    }

    function getAgent(address who) external view returns (Agent memory) {
        return agents[who];
    }

    /// @notice Return the USDC registration stake deliberately trapped by slashing.
    function slashSinkBalance() external view returns (uint256) {
        return _slashSinkBalance;
    }

    /// @notice Return reputation fees deliberately retained by the contract.
    /// @dev The accumulator has no withdrawal path and is separate from escrow
    /// and registration-stake liabilities.
    function reputationFeeSinkBalance() external view returns (uint256) {
        return _reputationFeeSink;
    }

    /// @notice Return sybil-resistant reputation counters for an agent.
    function getAgentReputation(address who)
        external
        view
        returns (uint256 distinctClients, uint256 submitted, uint256 approvedDeliveries, uint256 disputes, uint256 totalEarned)
    {
        Agent storage agent = agents[who];
        return (agent.distinctClients, agent.submitted, agent.approvedDeliveries, agent.disputes, agent.totalEarned);
    }

    /// @notice Reputation score weighted only by independently approved clients.
    /// @dev Repeated jobs from one client improve delivery history but cannot
    /// linearly inflate this trust score.
    function getReputationScore(address who) external view returns (uint256) {
        return agents[who].distinctClients * 100;
    }
}
