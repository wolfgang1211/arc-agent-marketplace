/**
 * TIMEOUT SPEC: assertions and values in this file are acceptance criteria.
 * Fix the contract or fixtures when red; do not narrow these assertions.
 */
const { expect } = require("chai");
const { ethers } = require("hardhat");

const DELIVERY_TIMEOUT = 600;
const APPROVAL_TIMEOUT = 1200;
const DISPUTE_TIMEOUT = 1800;
const PRODUCTION_TIMEOUT = 30 * 24 * 60 * 60;
const REWARD = 100_000000n;

async function deployMarket(delivery, approval, dispute) {
  const [client, agent] = await ethers.getSigners();
  const usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
  const Market = await ethers.getContractFactory("AgentMarketplace");
  const market = await Market.deploy(await usdc.getAddress(), 100_000000n, delivery, approval, dispute);
  await market.waitForDeployment();
  return { client, agent, usdc, Market, market, address: await market.getAddress() };
}

async function prepareActors({ client, agent, usdc, market, address }, jobCount = 1) {
  const stake = await market.AGENT_STAKE();
  await usdc.mint(agent.address, stake);
  await usdc.connect(agent).approve(address, stake);
  await market.connect(agent).registerAgent("Timeout agent", "verification", 0);
  await usdc.mint(client.address, REWARD * BigInt(jobCount));
  await usdc.connect(client).approve(address, REWARD * BigInt(jobCount));
}

async function postJob({ client, market }, description) {
  const jobId = (await market.jobCount()) + 1n;
  await market.connect(client)["postJob(string,uint256,string)"](
    description,
    REWARD,
    "verification",
  );
  return jobId;
}

describe("TIMEOUT SPEC — constructor-configured verification windows", function () {
  it("applies delivery=600s, approval=1200s, and dispute=1800s independently", async function () {
    const fixture = await deployMarket(DELIVERY_TIMEOUT, APPROVAL_TIMEOUT, DISPUTE_TIMEOUT);
    const { client, agent, usdc, market } = fixture;
    await prepareActors(fixture, 3);

    const deliveryJobId = await postJob(fixture, "delivery window");
    const acceptReceipt = await (await market.connect(agent).acceptJob(deliveryJobId)).wait();
    const acceptBlock = await ethers.provider.getBlock(acceptReceipt.blockNumber);
    const deliveryJob = await market.jobs(deliveryJobId);
    expect(deliveryJob.deliveryDeadline - BigInt(acceptBlock.timestamp)).to.equal(600n);

    const approvalJobId = await postJob(fixture, "approval window");
    await market.connect(agent).acceptJob(approvalJobId);
    const submitReceipt = await (
      await market.connect(agent).submitDeliverable(approvalJobId, "ipfs://approval")
    ).wait();
    const submitBlock = await ethers.provider.getBlock(submitReceipt.blockNumber);
    const approvalJob = await market.jobs(approvalJobId);
    expect(approvalJob.approvalDeadline - BigInt(submitBlock.timestamp)).to.equal(1200n);

    await ethers.provider.send("evm_setNextBlockTimestamp", [submitBlock.timestamp + 900]);
    await expect(market.claimTimeout(approvalJobId)).to.be.revertedWith(
      "Approval deadline not reached",
    );
    const beforePayout = await usdc.balanceOf(agent.address);
    await ethers.provider.send("evm_setNextBlockTimestamp", [submitBlock.timestamp + 1300]);
    await market.claimTimeout(approvalJobId);
    expect(await usdc.balanceOf(agent.address) - beforePayout).to.equal(REWARD);

    const disputeJobId = await postJob(fixture, "dispute window");
    await market.connect(agent).acceptJob(disputeJobId);
    await market.connect(agent).submitDeliverable(disputeJobId, "ipfs://dispute");
    const disputeReceipt = await (await market.connect(client).disputeJob(disputeJobId)).wait();
    const disputeBlock = await ethers.provider.getBlock(disputeReceipt.blockNumber);
    const disputeJob = await market.jobs(disputeJobId);
    expect(disputeJob.disputeDeadline - BigInt(disputeBlock.timestamp)).to.equal(1800n);
  });

  it("rejects each timeout independently below MIN_TIMEOUT", async function () {
    const usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
    const Market = await ethers.getContractFactory("AgentMarketplace");
    const usdcAddress = await usdc.getAddress();

    await expect(Market.deploy(usdcAddress, 100_000000n, 299, 300, 300)).to.be.revertedWith(
      "Delivery timeout below minimum",
    );
    await expect(Market.deploy(usdcAddress, 100_000000n, 300, 299, 300)).to.be.revertedWith(
      "Approval timeout below minimum",
    );
    await expect(Market.deploy(usdcAddress, 100_000000n, 300, 300, 299)).to.be.revertedWith(
      "Dispute timeout below minimum",
    );
  });

  it("exposes the exact constructor values through public immutable getters", async function () {
    const { market } = await deployMarket(DELIVERY_TIMEOUT, APPROVAL_TIMEOUT, DISPUTE_TIMEOUT);

    expect(await market.MIN_TIMEOUT()).to.equal(300n);
    expect(await market.DELIVERY_TIMEOUT()).to.equal(600n);
    expect(await market.APPROVAL_TIMEOUT()).to.equal(1200n);
    expect(await market.DISPUTE_TIMEOUT()).to.equal(1800n);
  });

  it("preserves the prior 30-day production timeout behavior", async function () {
    const fixture = await deployMarket(PRODUCTION_TIMEOUT, PRODUCTION_TIMEOUT, PRODUCTION_TIMEOUT);
    const { agent, market } = fixture;
    await prepareActors(fixture);
    const jobId = await postJob(fixture, "production window");
    const acceptReceipt = await (await market.connect(agent).acceptJob(jobId)).wait();
    const acceptBlock = await ethers.provider.getBlock(acceptReceipt.blockNumber);
    const job = await market.jobs(jobId);

    expect(await market.DELIVERY_TIMEOUT()).to.equal(BigInt(PRODUCTION_TIMEOUT));
    expect(await market.APPROVAL_TIMEOUT()).to.equal(BigInt(PRODUCTION_TIMEOUT));
    expect(await market.DISPUTE_TIMEOUT()).to.equal(BigInt(PRODUCTION_TIMEOUT));
    expect(job.deliveryDeadline - BigInt(acceptBlock.timestamp)).to.equal(BigInt(PRODUCTION_TIMEOUT));

    await ethers.provider.send("evm_setNextBlockTimestamp", [
      acceptBlock.timestamp + PRODUCTION_TIMEOUT - 1,
    ]);
    await expect(market.claimTimeout(jobId)).to.be.revertedWith(
      "Delivery deadline not reached",
    );
    await ethers.provider.send("evm_setNextBlockTimestamp", [
      acceptBlock.timestamp + PRODUCTION_TIMEOUT,
    ]);
    await market.claimTimeout(jobId);
    expect((await market.jobs(jobId)).status).to.equal(6n);
  });
});
