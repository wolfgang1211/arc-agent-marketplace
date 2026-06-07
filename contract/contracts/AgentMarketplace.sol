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

    enum JobStatus {
        Open,        // funded, waiting for an agent
        InProgress,  // an agent accepted the job
        Submitted,   // agent submitted the deliverable
        Completed,   // client approved, reward paid out
        Cancelled    // client cancelled before an agent accepted (refunded)
    }

    struct Agent {
        string name;
        string skill;
        uint256 fee;            // suggested fee in USDC base units (6 decimals)
        uint256 completedJobs;
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
    }

    mapping(address => Agent) public agents;
    mapping(uint256 => Job) public jobs;
    uint256 public jobCount;

    event AgentRegistered(address indexed agent, string name, string skill, uint256 fee);
    event JobPosted(uint256 indexed jobId, address indexed client, uint256 reward, string description);
    event JobAccepted(uint256 indexed jobId, address indexed agent);
    event DeliverableSubmitted(uint256 indexed jobId, string deliverableURI);
    event JobApproved(uint256 indexed jobId, address indexed agent, uint256 reward);
    event JobCancelled(uint256 indexed jobId);

    constructor(address usdcAddress) {
        require(usdcAddress != address(0), "USDC address required");
        usdc = IERC20(usdcAddress);
    }

    // ---------------------------------------------------------------------
    // Agent registry
    // ---------------------------------------------------------------------

    /// @notice Register (or update) the caller as an AI agent.
    function registerAgent(string calldata name, string calldata skill, uint256 fee) external {
        require(bytes(name).length > 0, "Name required");
        Agent storage a = agents[msg.sender];
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
        require(reward > 0, "Reward must be > 0");
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
            createdAt: block.timestamp
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
        emit DeliverableSubmitted(jobId, deliverableURI);
    }

    /// @notice The client approves the work and releases the escrowed USDC to the agent.
    function approveAndPay(uint256 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        require(job.id != 0, "Job not found");
        require(msg.sender == job.client, "Only client");
        require(job.status == JobStatus.Submitted, "Nothing to approve");

        job.status = JobStatus.Completed;
        agents[job.agent].completedJobs += 1;

        uint256 reward = job.reward;
        usdc.safeTransfer(job.agent, reward);

        emit JobApproved(jobId, job.agent, reward);
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
}
