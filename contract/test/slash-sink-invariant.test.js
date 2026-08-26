const { expect } = require("chai");
const { ethers } = require("hardhat");

const DAY = 24 * 60 * 60;
const REWARD_TO_SLASH = 100_000000n;
const ACTIVE_REWARD = 70_000000n;
const CANCELLED_REWARD = 30_000000n;

async function warp(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

describe("contract balance accounting invariant", function () {
  it("decomposes USDC into slash sink, reputation fee sink, live escrow, and locked stakes", async function () {
    const [client, slashedAgent, activeAgent, withdrawingAgent, stranger] =
      await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy();
    const Market = await ethers.getContractFactory("AgentMarketplace");
    const market = await Market.deploy(await usdc.getAddress());
    const marketAddress = await market.getAddress();
    const stake = await market.AGENT_STAKE();

    const registeredAgents = [slashedAgent, activeAgent, withdrawingAgent];
    for (const agent of registeredAgents) {
      await usdc.mint(agent.address, stake);
      await usdc.connect(agent).approve(marketAddress, stake);
      await market.connect(agent).registerAgent("Agent", "test", 0);
    }

    async function expectAccounting(activeEscrowLiabilities, lockedStakeAgents) {
      let lockedRegistrationStakes = 0n;
      for (const agent of lockedStakeAgents) {
        lockedRegistrationStakes += (await market.getAgent(agent.address)).stake;
      }
      const slashSink = await market.slashSinkBalance();
      const reputationFeeSink = await market.reputationFeeSinkBalance();
      expect(await usdc.balanceOf(marketAddress)).to.equal(
        slashSink + reputationFeeSink + activeEscrowLiabilities + lockedRegistrationStakes
      );
    }

    const totalRewards = REWARD_TO_SLASH + ACTIVE_REWARD + CANCELLED_REWARD;
    await usdc.mint(client.address, totalRewards);
    await usdc.connect(client).approve(marketAddress, totalRewards);

    await market.connect(client).postJob("will time out", REWARD_TO_SLASH);
    await market.connect(slashedAgent).acceptJob(1);
    await market.connect(client).postJob("remains active", ACTIVE_REWARD);
    await market.connect(activeAgent).acceptJob(2);
    await market.connect(client).postJob("will be cancelled", CANCELLED_REWARD);

    await expectAccounting(totalRewards, registeredAgents);
    expect(await market.slashSinkBalance()).to.equal(0n);

    const clientBeforeCancel = await usdc.balanceOf(client.address);
    await market.connect(client).cancelJob(3);
    expect(await usdc.balanceOf(client.address) - clientBeforeCancel).to.equal(
      CANCELLED_REWARD
    );
    await expectAccounting(REWARD_TO_SLASH + ACTIVE_REWARD, registeredAgents);

    await warp(31 * DAY);
    const clientBeforeTimeoutRefund = await usdc.balanceOf(client.address);
    await market.connect(stranger).claimTimeout(1);

    expect(await usdc.balanceOf(client.address) - clientBeforeTimeoutRefund).to.equal(
      REWARD_TO_SLASH
    );
    expect(await market.slashSinkBalance()).to.equal(stake);
    expect((await market.getAgent(slashedAgent.address)).stake).to.equal(0n);
    expect((await market.getAgent(activeAgent.address)).stake).to.equal(stake);
    await expectAccounting(ACTIVE_REWARD, [activeAgent, withdrawingAgent]);

    const agentBeforeWithdrawal = await usdc.balanceOf(withdrawingAgent.address);
    await market.connect(withdrawingAgent).withdrawStake();
    expect(await usdc.balanceOf(withdrawingAgent.address) - agentBeforeWithdrawal).to.equal(
      stake
    );
    await expectAccounting(ACTIVE_REWARD, [activeAgent]);

    expect((await market.jobs(2)).status).to.equal(1n);
    expect((await market.getAgent(activeAgent.address)).activeJobs).to.equal(1n);
    await expect(market.connect(activeAgent).withdrawStake()).to.be.revertedWith(
      "Active job exists"
    );
    await expectAccounting(ACTIVE_REWARD, [activeAgent]);
  });
});
