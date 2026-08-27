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
    market = await Market.deploy(
      await usdc.getAddress(),
      30 * 24 * 60 * 60,
      30 * 24 * 60 * 60,
      30 * 24 * 60 * 60,
    );
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
    await expect(market.connect(client)["postJob(string,uint256,string)"]("Summarize a PDF", REWARD, "summarization"))
      .to.emit(market, "JobPosted");

    expect(await usdc.balanceOf(await market.getAddress())).to.equal(REWARD);
    const job = await market.jobs(1);
    expect(job.client).to.equal(client.address);
    expect(job.category).to.equal("summarization");
    expect(job.reward).to.equal(REWARD);
    expect(job.status).to.equal(0n); // Open
  });

  it("keeps the legacy postJob selector uncategorized through settlement", async function () {
    const marketAddress = await market.getAddress();
    await usdc.connect(agent).approve(marketAddress, 100_000000n);
    await market.connect(agent).registerAgent("Aria", "summarization", 50_000000n);
    await usdc.connect(client).approve(marketAddress, REWARD);

    await market.connect(client)["postJob(string,uint256)"]("Legacy job", REWARD);
    const job = await market.jobs(1);
    expect(job.category).to.equal("");

    await market.connect(agent).acceptJob(1);
    await market.connect(agent).submitDeliverable(1, "ipfs://legacy-result");
    await market.connect(client).approveAndPay(1);

    expect((await market.jobs(1)).status).to.equal(4n);
    expect(await market.getReputationByCategory(agent.address, "")).to.equal(0n);
    expect((await market.getAgent(agent.address)).approvedDeliveries).to.equal(1n);
  });

  it("runs the full happy path: accept -> submit -> approve -> pay", async function () {
    await usdc.connect(agent).approve(await market.getAddress(), 100_000000n);
    await market.connect(agent).registerAgent("Aria", "summarization", 50_000000n);
    await usdc.connect(client).approve(await market.getAddress(), REWARD);
    await market.connect(client)["postJob(string,uint256,string)"]("Summarize a PDF", REWARD, "summarization");

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

  it("enforces the flat reputation fee floor and percentage crossover", async function () {
    const marketAddress = await market.getAddress();
    const signers = await ethers.getSigners();
    const reputationClients = signers.slice(2, 6);
    const minReward = await market.MIN_JOB_REWARD();
    const flatFee = await market.FLAT_REPUTATION_FEE();
    const bps = await market.REPUTATION_FEE_BPS();
    const crossover = (flatFee * 10_000n) / bps;

    expect(minReward).to.equal(5_000000n);
    expect(flatFee).to.equal(500000n);
    expect(flatFee).to.be.lessThan(minReward);
    expect(minReward - flatFee).to.be.greaterThan(0n);
    expect((minReward * bps) / 10_000n).to.be.lessThan(flatFee);
    expect((100_000000n * bps) / 10_000n).to.be.greaterThan(flatFee);
    expect(crossover).to.equal(50_000000n);

    await usdc.connect(agent).approve(marketAddress, 100_000000n);
    await market.connect(agent).registerAgent("Aria", "general", 0);

    const cases = [
      { reward: 5_000000n, expectedFee: 500000n },
      { reward: 50_000000n, expectedFee: 500000n },
      { reward: 100_000000n, expectedFee: 1_000000n },
      { reward: 1_000_000000n, expectedFee: 10_000000n },
    ];
    let totalFees = 0n;

    for (let i = 0; i < cases.length; i++) {
      const { reward, expectedFee } = cases[i];
      const reputationClient = reputationClients[i];
      const jobId = BigInt(i + 1);
      await usdc.mint(reputationClient.address, reward);
      await usdc.connect(reputationClient).approve(marketAddress, reward);
      await market.connect(reputationClient)["postJob(string,uint256,string)"]("Reputation job", reward, "general");
      await market.connect(agent).acceptJob(jobId);
      await market.connect(agent).submitDeliverable(jobId, "ipfs://result");

      const agentBefore = await usdc.balanceOf(agent.address);
      await expect(market.connect(reputationClient).approveAndPay(jobId))
        .to.emit(market, "ReputationFeeCharged")
        .withArgs(jobId, agent.address, expectedFee);
      expect(await usdc.balanceOf(agent.address) - agentBefore).to.equal(reward - expectedFee);

      totalFees += expectedFee;
      expect(await market.reputationFeeSinkBalance()).to.equal(totalFees);
      expect(await usdc.balanceOf(marketAddress)).to.equal(100_000000n + totalFees);
    }

    const repeatReward = minReward;
    const repeatClient = reputationClients[0];
    await usdc.mint(repeatClient.address, repeatReward);
    await usdc.connect(repeatClient).approve(marketAddress, repeatReward);
    await market.connect(repeatClient)["postJob(string,uint256,string)"]("Repeat client", repeatReward, "general");
    await market.connect(agent).acceptJob(5);
    await market.connect(agent).submitDeliverable(5, "ipfs://repeat");
    const repeatAgentBefore = await usdc.balanceOf(agent.address);
    await expect(market.connect(repeatClient).approveAndPay(5))
      .to.not.emit(market, "ReputationFeeCharged");
    expect(await usdc.balanceOf(agent.address) - repeatAgentBefore).to.equal(repeatReward);
    expect(await market.reputationFeeSinkBalance()).to.equal(totalFees);
    expect(await usdc.balanceOf(marketAddress)).to.equal(100_000000n + totalFees);
  });

  it("records a dispute against the assigned agent", async function () {
    await usdc.connect(agent).approve(await market.getAddress(), 100_000000n);
    await market.connect(agent).registerAgent("Aria", "summarization", 50_000000n);
    await usdc.connect(client).approve(await market.getAddress(), REWARD);
    await market.connect(client)["postJob(string,uint256,string)"]("Summarize a PDF", REWARD, "summarization");
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
    await market.connect(client)["postJob(string,uint256,string)"]("Summarize a PDF", REWARD, "summarization");

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
    await market.connect(client)["postJob(string,uint256,string)"]("Summarize a PDF", REWARD, "summarization");
    await expect(market.connect(other).acceptJob(1)).to.be.revertedWith("Register as agent first");
  });

  it("prevents the client from accepting their own job", async function () {
    await usdc.connect(client).approve(await market.getAddress(), 100_000000n);
    await market.connect(client).registerAgent("Self", "x", 0);
    await usdc.connect(client).approve(await market.getAddress(), REWARD);
    await market.connect(client)["postJob(string,uint256,string)"]("Summarize a PDF", REWARD, "summarization");
    await expect(market.connect(client).acceptJob(1)).to.be.revertedWith("Client cannot accept own job");
  });

  it("only the assigned agent can submit, only client can approve", async function () {
    await usdc.connect(agent).approve(await market.getAddress(), 100_000000n);
    await market.connect(agent).registerAgent("Aria", "x", 0);
    await usdc.connect(client).approve(await market.getAddress(), REWARD);
    await market.connect(client)["postJob(string,uint256,string)"]("Summarize a PDF", REWARD, "summarization");
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
      await market.connect(client)["postJob(string,uint256,string)"]("Repeated work", REWARD, "general");
      await market.connect(agent).acceptJob(i);
      await market.connect(agent).submitDeliverable(i, "ipfs://result");
      await market.connect(client).approveAndPay(i);
    }

    const a = await market.getAgent(agent.address);
    expect(a.distinctClients).to.equal(1n);
    expect(a.submitted).to.equal(2n);
    expect(a.approvedDeliveries).to.equal(2n);
  });

  it("isolates reputation by category and counts each client once per category", async function () {
    const marketAddress = await market.getAddress();
    await usdc.connect(agent).approve(marketAddress, 100_000000n);
    await market.connect(agent).registerAgent("Aria", "summarization", 50_000000n);
    await usdc.connect(client).approve(marketAddress, REWARD * 2n);

    for (let i = 1; i <= 2; i++) {
      await market.connect(client)["postJob(string,uint256,string)"]("Repeated category work", REWARD, "summarization");
      await market.connect(agent).acceptJob(i);
      await market.connect(agent).submitDeliverable(i, "ipfs://result");
      await market.connect(client).approveAndPay(i);
    }

    expect(await market.getReputationByCategory(agent.address, "summarization")).to.equal(100n);
    await market.connect(agent).registerAgent("Aria", "smart-contract-audit", 50_000000n);
    expect(await market.getReputationByCategory(agent.address, "smart-contract-audit")).to.equal(0n);
    expect(await market.getReputationByCategory(agent.address, "summarization")).to.equal(100n);

    await usdc.mint(other.address, REWARD);
    await usdc.connect(other).approve(marketAddress, REWARD);
    await market.connect(other)["postJob(string,uint256,string)"]("Timeout work", REWARD, "smart-contract-audit");
    await market.connect(agent).acceptJob(3);
    await market.connect(agent).submitDeliverable(3, "ipfs://result");
    await ethers.provider.send("evm_increaseTime", [31 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine", []);
    await market.claimTimeout(3);

    expect(await market.getReputationByCategory(agent.address, "smart-contract-audit")).to.equal(0n);
  });

  it("returns bounded zero-based job pages with the total count", async function () {
    const marketAddress = await market.getAddress();
    await usdc.connect(client).approve(marketAddress, REWARD * 3n);
    for (let i = 1; i <= 3; i++) {
      await market.connect(client)["postJob(string,uint256,string)"](`Job ${i}`, REWARD, "general");
    }

    const [firstPage, firstTotal] = await market.getJobsPaged(0, 2);
    expect(firstTotal).to.equal(3n);
    expect(firstPage.map(job => job.id)).to.deep.equal([1n, 2n]);

    const [lastPage, lastTotal] = await market.getJobsPaged(2, await market.MAX_PAGE_LIMIT());
    expect(lastTotal).to.equal(3n);
    expect(lastPage.map(job => job.id)).to.deep.equal([3n]);

    const [emptyPage, emptyTotal] = await market.getJobsPaged(3, 1);
    expect(emptyTotal).to.equal(3n);
    expect(emptyPage).to.have.lengthOf(0);

    const [zeroLimitPage, zeroLimitTotal] = await market.getJobsPaged(0, 0);
    expect(zeroLimitTotal).to.equal(3n);
    expect(zeroLimitPage).to.have.lengthOf(0);

    await expect(market.getJobsPaged(0, (await market.MAX_PAGE_LIMIT()) + 1n))
      .to.be.revertedWith("Page limit exceeded");
  });

  it("rejects arbitrary slashing and leaves registration stake withdrawable", async function () {
    await usdc.connect(agent).approve(await market.getAddress(), 100_000000n);
    await market.connect(agent).registerAgent("Aria", "x", 0);
    await usdc.connect(client).approve(await market.getAddress(), REWARD);
    await market.connect(client)["postJob(string,uint256,string)"]("Fraud review", REWARD, "fraud-review");

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
