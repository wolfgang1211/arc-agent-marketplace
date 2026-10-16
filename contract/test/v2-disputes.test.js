const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deploy, post, award, jump, invariant, DAY, H } = require("./helpers/v2-stage-c-fixture");

async function pinNextBlockTimestamp(target) {
  const latest = await ethers.provider.getBlock("latest");
  expect(target).to.be.greaterThan(BigInt(latest.timestamp));
  await ethers.provider.send("evm_setNextBlockTimestamp", [Number(target)]);
}

async function minedReceipt(value) {
  if (value && value.blockNumber != null) return value;
  return ethers.provider.getTransactionReceipt(value.transactionHash);
}

async function minedTimestamp(value) {
  const receipt = await minedReceipt(value);
  return BigInt((await ethers.provider.getBlock(receipt.blockNumber)).timestamp);
}

describe("AgentMarketplaceV2 Stage C disputes and expiry", function () {
  const live = [];
  afterEach(async function () { for (const e of live.splice(0)) await invariant(e); });

  it("RED/GREEN: client cancels Open before applyBy and anyone refunds exactly at/after applyBy", async function () {
    const e = await deploy(); live.push(e); let j = await post(e); await e.market.connect(e.client).cancelOpenJob(1, j.stateVersion);
    expect((await e.market.getJob(1)).status).to.equal(7n);
    const e2 = await deploy(); live.push(e2); j = await post(e2); await jump(Number(j.applyBy - BigInt((await ethers.provider.getBlock("latest")).timestamp)));
    await e2.market.connect(e2.outsider).claimOpenJobTimeout(1, j.stateVersion); expect((await e2.market.getJob(1)).status).to.equal(7n);
    await expect(e2.market.connect(e2.client).claimOpenJobTimeout(1, (await e2.market.getJob(1)).stateVersion)).to.be.reverted;
  });

  it("starts a fresh seven-day fault review window at the claim receipt", async function () {
    const e = await deploy(); live.push(e); const j0 = await post(e); const j = await award(e, j0);
    await jump(Number(j.deliveryDeadline - BigInt((await ethers.provider.getBlock("latest")).timestamp)) + 8 * DAY);
    const tx = await e.market.connect(e.outsider).claimDeliveryTimeout(1, j.stateVersion);
    const receipt = await tx.wait(); const claimBlock = await ethers.provider.getBlock(receipt.blockNumber);
    const failed = await e.market.getJob(1);
    expect(failed.faultReviewDeadline).to.equal(BigInt(claimBlock.timestamp) + 7n * BigInt(DAY));
    await expect(e.market.connect(e.owner).releaseFaultReview(1, failed.stateVersion)).to.be.reverted;
    const beforeDeadline = failed.faultReviewDeadline - 1n;
    await pinNextBlockTimestamp(beforeDeadline);
    const resolveBefore = await e.market.connect(e.owner).resolveFaultReview(1, 0, H("reason"), H("evidence"), (await e.market.getJob(1)).stateVersion, { gasLimit: 1_000_000 });
    expect(await minedTimestamp(await resolveBefore.wait())).to.equal(beforeDeadline);
    const e2 = await deploy(); live.push(e2); const lateJob = await award(e2, await post(e2));
    await jump(Number(lateJob.deliveryDeadline - BigInt((await ethers.provider.getBlock("latest")).timestamp)) + 8 * DAY);
    await e2.market.connect(e2.outsider).claimDeliveryTimeout(1, lateJob.stateVersion);
    const pending = await e2.market.getJob(1);
    await pinNextBlockTimestamp(pending.faultReviewDeadline);
    let boundaryError;
    try {
      const boundaryTx = await e2.market.connect(e2.owner).resolveFaultReview(1, 0, H("at-deadline"), H("evidence"), (await e2.market.getJob(1)).stateVersion, { gasLimit: 1_000_000 });
      await boundaryTx.wait();
    } catch (error) {
      boundaryError = error;
    }
    expect(boundaryError).to.exist;
    const boundaryReceipt = await minedReceipt(boundaryError);
    expect(boundaryReceipt.status).to.equal(0);
    expect(await minedTimestamp(boundaryReceipt)).to.equal(pending.faultReviewDeadline);
    await pinNextBlockTimestamp(pending.faultReviewDeadline + 1n);
    const releaseAtAfter = await e2.market.connect(e2.owner).releaseFaultReview(1, (await e2.market.getJob(1)).stateVersion, { gasLimit: 1_000_000 });
    expect(await minedTimestamp(await releaseAtAfter.wait())).to.equal(pending.faultReviewDeadline + 1n);
    const e3 = await deploy(); live.push(e3); const positive = await award(e3, await post(e3));
    await jump(Number(positive.deliveryDeadline - BigInt((await ethers.provider.getBlock("latest")).timestamp)) + 8 * DAY);
    const clientCreditBeforeClaim = await e3.market.credits(e3.client);
    const claimTx = await e3.market.connect(e3.outsider).claimDeliveryTimeout(1, positive.stateVersion);
    const claimReceipt = await claimTx.wait(); const claimBlock3 = await ethers.provider.getBlock(claimReceipt.blockNumber);
        const pendingPositive = await e3.market.getJob(1);
        expect(pendingPositive.faultReviewDeadline).to.equal(BigInt(claimBlock3.timestamp) + 7n * BigInt(DAY));
        expect(BigInt((await ethers.provider.getBlock("latest")).timestamp)).to.be.lessThan(pendingPositive.faultReviewDeadline);
    const slash = 1n * 1_000_000n;
    const vaultBalanceBefore = await e3.token.balanceOf(e3.vault);
    const marketBalanceBefore = await e3.token.balanceOf(e3.market);
    const stakeLiabilityBefore = await e3.market.stakeLiability();
    const freeStakeBefore = await e3.market.freeStake(e3.operator.address);
    await pinNextBlockTimestamp(pendingPositive.faultReviewDeadline - 1n);
    const positiveResolve = await e3.market.connect(e3.owner).resolveFaultReview(1, slash, H("positive-late-slash"), H("evidence"), pendingPositive.stateVersion, { gasLimit: 1_000_000 });
    expect(await minedTimestamp(await positiveResolve.wait())).to.equal(pendingPositive.faultReviewDeadline - 1n);
    expect(await e3.market.credits(e3.client)).to.equal(clientCreditBeforeClaim + positive.reward + slash);
    expect(await e3.market.stakeLiability()).to.equal(stakeLiabilityBefore - slash);
    expect(await e3.token.balanceOf(e3.vault)).to.equal(vaultBalanceBefore - slash);
    expect(await e3.token.balanceOf(e3.market)).to.equal(marketBalanceBefore + slash);
    expect(await e3.market.freeStake(e3.operator.address)).to.equal(freeStakeBefore + pendingPositive.stakeReserved - slash);
    expect((await e3.market.getJob(1)).faultReviewPending).to.equal(false);
  });

  it("permissionlessly opens late AccessRecovery once, preserving zero repair time", async function () {
    const e = await deploy(); live.push(e); let j = await award(e, await post(e));
    await e.market.connect(e.operator).submitDelivery(1, H("sealed"), j.stateVersion); j = await e.market.getJob(1);
    await e.market.connect(e.client).reportAccess(1, j.stateVersion); j = await e.market.getJob(1);
    await jump(Number(j.repairDeadline - BigInt((await ethers.provider.getBlock("latest")).timestamp)) + 1);
    await e.market.connect(e.outsider).triggerAccessRecoveryDispute(1, j.stateVersion); j = await e.market.getJob(1);
    expect(j.status).to.equal(5n); expect(j.savedRepairRemaining).to.equal(0n);
    await expect(e.market.connect(e.outsider).triggerAccessRecoveryDispute(1, j.stateVersion)).to.be.reverted;
  });

  it("rejects nested/third-party resolver disputes and terminal dispute replay", async function () {
    const e = await deploy(); live.push(e); let j = await award(e, await post(e));
    await expect(e.market.connect(e.outsider).openDispute(1,j.stateVersion)).to.be.reverted;
    await e.market.connect(e.client).openDispute(1,j.stateVersion); j = await e.market.getJob(1);
    await expect(e.market.connect(e.client).openDispute(1,j.stateVersion)).to.be.reverted;
    await e.market.connect(e.owner).resolveDispute(1, 0, false, H("reason"), H("evidence"), j.stateVersion); j = await e.market.getJob(1);
    await expect(e.market.connect(e.client).openDispute(1,j.stateVersion)).to.be.reverted;
  });

  it("allows a snapshotted house client to enter dispute but not resolve it", async function () {
    const e = await deploy(); live.push(e); await e.market.connect(e.owner).setHouse(e.operator.address, true); await e.market.connect(e.owner).setTestClient(e.client.address, true);
    let j = await award(e, await post(e, DAY, true));
    await e.market.connect(e.client).openDispute(1,j.stateVersion); j = await e.market.getJob(1);
    expect(j.house).to.equal(true); expect(j.status).to.equal(5n);
    await expect(e.market.connect(e.owner).resolveDispute(1, 0, false, H("reason"), H("evidence"), j.stateVersion)).to.be.reverted;
  });
});
