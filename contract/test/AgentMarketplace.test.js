const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("AgentMarketplace", function () {
  let usdc, market, client, agent, other;
  const REWARD = 100_000000n; // 100 USDC (6 decimals)

  beforeEach(async function () {
    [client, agent, other] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy();
    await usdc.waitForDeployment();

    const Market = await ethers.getContractFactory("AgentMarketplace");
    market = await Market.deploy(await usdc.getAddress());
    await market.waitForDeployment();

    // Fund the client and agent with USDC.
    await usdc.mint(client.address, 1_000_000000n); // 1,000 USDC
    await usdc.mint(agent.address, 100_000000n); // registration stake
  });

  it("registers an agent", async function () {
    await usdc.connect(agent).approve(await market.getAddress(), 100_000000n);
    await expect(market.connect(agent).registerAgent("Aria", "summarization", 50_000000n))
      .to.emit(market, "AgentRegistered")
      .withArgs(agent.address, "Aria", "summarization", 50_000000n);

    const a = await market.getAgent(agent.address);
    expect(a.registered).to.equal(true);
    expect(a.name).to.equal("Aria");
    expect(a.stake).to.equal(100_000000n);
    expect(await usdc.balanceOf(await market.getAddress())).to.equal(100_000000n);
  });

  it("posts a job and escrows USDC", async function () {
    await usdc.connect(client).approve(await market.getAddress(), REWARD);
    await expect(market.connect(client).postJob("Summarize a PDF", REWARD))
      .to.emit(market, "JobPosted");

    expect(await usdc.balanceOf(await market.getAddress())).to.equal(REWARD);
    const job = await market.jobs(1);
    expect(job.client).to.equal(client.address);
    expect(job.reward).to.equal(REWARD);
    expect(job.status).to.equal(0n); // Open
  });

  it("runs the full happy path: accept -> submit -> approve -> pay", async function () {
    await usdc.connect(agent).approve(await market.getAddress(), 100_000000n);
    await market.connect(agent).registerAgent("Aria", "summarization", 50_000000n);
    await usdc.connect(client).approve(await market.getAddress(), REWARD);
    await market.connect(client).postJob("Summarize a PDF", REWARD);

    await market.connect(agent).acceptJob(1);
    await market.connect(agent).submitDeliverable(1, "ipfs://result");

    const reputationFee = (REWARD * await market.REPUTATION_FEE_BPS()) / 10_000n;
    const payout = REWARD - reputationFee;
    const before = await usdc.balanceOf(agent.address);
    await expect(market.connect(client).approveAndPay(1))
      .to.emit(market, "JobApproved")
      .withArgs(1, agent.address, payout);
    const after = await usdc.balanceOf(agent.address);

    expect(after - before).to.equal(payout);
    expect(await market.reputationFeeSinkBalance()).to.equal(reputationFee);
    const job = await market.jobs(1);
    expect(job.status).to.equal(4n); // Completed
    const a = await market.getAgent(agent.address);
    expect(a.distinctClients).to.equal(1n);
    expect(a.inProgress).to.equal(0n);
    expect(a.submitted).to.equal(1n);
    expect(a.approvedDeliveries).to.equal(1n);
    expect(a.disputes).to.equal(0n);
    expect(a.totalEarned).to.equal(payout);

    expect(await market.getAgentReputation(agent.address)).to.deep.equal([1n, 1n, 1n, 0n, payout]);
    expect(await usdc.balanceOf(await market.getAddress())).to.equal(100_000000n + reputationFee);
  });

  it("records a dispute against the assigned agent", async function () {
    await usdc.connect(agent).approve(await market.getAddress(), 100_000000n);
    await market.connect(agent).registerAgent("Aria", "summarization", 50_000000n);
    await usdc.connect(client).approve(await market.getAddress(), REWARD);
    await market.connect(client).postJob("Summarize a PDF", REWARD);
    await market.connect(agent).acceptJob(1);
    await market.connect(agent).submitDeliverable(1, "ipfs://result");

    await expect(market.connect(client).disputeJob(1))
      .to.emit(market, "JobDisputed")
      .withArgs(1, agent.address);

    const job = await market.jobs(1);
    expect(job.status).to.equal(3n); // Disputed
    expect(await market.getAgentReputation(agent.address)).to.deep.equal([0n, 1n, 0n, 1n, 0n]);
    expect(await usdc.balanceOf(await market.getAddress())).to.equal(100_000000n + REWARD);
  });

  it("lets the client cancel an open job and refunds", async function () {
    await usdc.connect(client).approve(await market.getAddress(), REWARD);
    await market.connect(client).postJob("Summarize a PDF", REWARD);

    const before = await usdc.balanceOf(client.address);
    await expect(market.connect(client).cancelJob(1)).to.emit(market, "JobCancelled");
    const after = await usdc.balanceOf(client.address);

    expect(after - before).to.equal(REWARD);
    const job = await market.jobs(1);
    expect(job.status).to.equal(5n); // Cancelled
    expect(await usdc.balanceOf(await market.getAddress())).to.equal(0n);
  });

  it("blocks non-registered agents from accepting", async function () {
    await usdc.connect(client).approve(await market.getAddress(), REWARD);
    await market.connect(client).postJob("Summarize a PDF", REWARD);
    await expect(market.connect(other).acceptJob(1)).to.be.revertedWith("Register as agent first");
  });

  it("prevents the client from accepting their own job", async function () {
    await usdc.connect(client).approve(await market.getAddress(), 100_000000n);
    await market.connect(client).registerAgent("Self", "x", 0);
    await usdc.connect(client).approve(await market.getAddress(), REWARD);
    await market.connect(client).postJob("Summarize a PDF", REWARD);
    await expect(market.connect(client).acceptJob(1)).to.be.revertedWith("Client cannot accept own job");
  });

  it("only the assigned agent can submit, only client can approve", async function () {
    await usdc.connect(agent).approve(await market.getAddress(), 100_000000n);
    await market.connect(agent).registerAgent("Aria", "x", 0);
    await usdc.connect(client).approve(await market.getAddress(), REWARD);
    await market.connect(client).postJob("Summarize a PDF", REWARD);
    await market.connect(agent).acceptJob(1);

    await expect(market.connect(other).submitDeliverable(1, "ipfs://x"))
      .to.be.revertedWith("Only assigned agent");

    await market.connect(agent).submitDeliverable(1, "ipfs://x");
    await expect(market.connect(other).approveAndPay(1)).to.be.revertedWith("Only client");
  });

  it("counts a client once across repeated completed jobs", async function () {
    await usdc.connect(agent).approve(await market.getAddress(), 100_000000n);
    await market.connect(agent).registerAgent("Aria", "x", 0);
    await usdc.connect(client).approve(await market.getAddress(), REWARD * 2n);

    for (let i = 1; i <= 2; i++) {
      await market.connect(client).postJob("Repeated work", REWARD);
      await market.connect(agent).acceptJob(i);
      await market.connect(agent).submitDeliverable(i, "ipfs://result");
      await market.connect(client).approveAndPay(i);
    }

    const a = await market.getAgent(agent.address);
    expect(a.distinctClients).to.equal(1n);
    expect(a.submitted).to.equal(2n);
    expect(a.approvedDeliveries).to.equal(2n);
  });

  it("rejects arbitrary slashing and leaves registration stake withdrawable", async function () {
    await usdc.connect(agent).approve(await market.getAddress(), 100_000000n);
    await market.connect(agent).registerAgent("Aria", "x", 0);
    await usdc.connect(client).approve(await market.getAddress(), REWARD);
    await market.connect(client).postJob("Fraud review", REWARD);

    await expect(market.connect(other).slashAgent(agent.address))
      .to.be.revertedWith("Slash requires missed delivery deadline");
    await expect(market.slashAgent(agent.address))
      .to.be.revertedWith("Slash requires missed delivery deadline");
    expect(await usdc.balanceOf(await market.getAddress())).to.equal(100_000000n + REWARD);
    expect((await market.getAgent(agent.address)).registered).to.equal(true);

    const before = await usdc.balanceOf(agent.address);
    await market.connect(agent).withdrawStake();
    expect(await usdc.balanceOf(agent.address) - before).to.equal(100_000000n);
    expect(await usdc.balanceOf(await market.getAddress())).to.equal(REWARD);
    expect((await market.getAgent(agent.address)).registered).to.equal(false);
  });
});
