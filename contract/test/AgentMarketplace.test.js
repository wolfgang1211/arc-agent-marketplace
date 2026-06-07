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

    // Fund the client with USDC.
    await usdc.mint(client.address, 1_000_000000n); // 1,000 USDC
  });

  it("registers an agent", async function () {
    await expect(market.connect(agent).registerAgent("Aria", "summarization", 50_000000n))
      .to.emit(market, "AgentRegistered")
      .withArgs(agent.address, "Aria", "summarization", 50_000000n);

    const a = await market.getAgent(agent.address);
    expect(a.registered).to.equal(true);
    expect(a.name).to.equal("Aria");
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
    await market.connect(agent).registerAgent("Aria", "summarization", 50_000000n);
    await usdc.connect(client).approve(await market.getAddress(), REWARD);
    await market.connect(client).postJob("Summarize a PDF", REWARD);

    await market.connect(agent).acceptJob(1);
    await market.connect(agent).submitDeliverable(1, "ipfs://result");

    const before = await usdc.balanceOf(agent.address);
    await expect(market.connect(client).approveAndPay(1))
      .to.emit(market, "JobApproved")
      .withArgs(1, agent.address, REWARD);
    const after = await usdc.balanceOf(agent.address);

    expect(after - before).to.equal(REWARD);
    const job = await market.jobs(1);
    expect(job.status).to.equal(3n); // Completed
    const a = await market.getAgent(agent.address);
    expect(a.completedJobs).to.equal(1n);
  });

  it("lets the client cancel an open job and refunds", async function () {
    await usdc.connect(client).approve(await market.getAddress(), REWARD);
    await market.connect(client).postJob("Summarize a PDF", REWARD);

    const before = await usdc.balanceOf(client.address);
    await expect(market.connect(client).cancelJob(1)).to.emit(market, "JobCancelled");
    const after = await usdc.balanceOf(client.address);

    expect(after - before).to.equal(REWARD);
    const job = await market.jobs(1);
    expect(job.status).to.equal(4n); // Cancelled
  });

  it("blocks non-registered agents from accepting", async function () {
    await usdc.connect(client).approve(await market.getAddress(), REWARD);
    await market.connect(client).postJob("Summarize a PDF", REWARD);
    await expect(market.connect(other).acceptJob(1)).to.be.revertedWith("Register as agent first");
  });

  it("prevents the client from accepting their own job", async function () {
    await market.connect(client).registerAgent("Self", "x", 0);
    await usdc.connect(client).approve(await market.getAddress(), REWARD);
    await market.connect(client).postJob("Summarize a PDF", REWARD);
    await expect(market.connect(client).acceptJob(1)).to.be.revertedWith("Client cannot accept own job");
  });

  it("only the assigned agent can submit, only client can approve", async function () {
    await market.connect(agent).registerAgent("Aria", "x", 0);
    await usdc.connect(client).approve(await market.getAddress(), REWARD);
    await market.connect(client).postJob("Summarize a PDF", REWARD);
    await market.connect(agent).acceptJob(1);

    await expect(market.connect(other).submitDeliverable(1, "ipfs://x"))
      .to.be.revertedWith("Only assigned agent");

    await market.connect(agent).submitDeliverable(1, "ipfs://x");
    await expect(market.connect(other).approveAndPay(1)).to.be.revertedWith("Only client");
  });
});
