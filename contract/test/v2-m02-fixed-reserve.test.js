const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deploy, post, award, invariant, jump, H, DAY } = require("./helpers/v2-stage-c-fixture");

const U = 1_000_000n;

async function postSecond(e) {
  const reward = 10n * U;
  const now = BigInt((await ethers.provider.getBlock("latest")).timestamp);
  await e.token.connect(e.client).approve(e.market, reward);
  await e.market.connect(e.client).postJob(reward, now + 2n * BigInt(DAY), DAY, DAY, 12 * 3600, 2, false, H("criteria-2"), H("description-2"), false);
  return e.market.getJob(2);
}

async function awardSecond(e) {
  const job = await e.market.getJob(2);
  const net = await ethers.provider.getNetwork();
  const value = { jobId: 2n, operator: e.operator.address, termsHash: job.canonicalTermsHash, validAfter: 0, validBefore: job.applyBy, nonceEpoch: 0, operatorNonce: 0 };
  const sig = await e.operator.signTypedData({ name: "AlphaBoard Agent Marketplace V2", version: "1", chainId: net.chainId, verifyingContract: await e.market.getAddress() }, { Application: [
    { name: "jobId", type: "uint256" }, { name: "operator", type: "address" }, { name: "termsHash", type: "bytes32" }, { name: "validAfter", type: "uint64" }, { name: "validBefore", type: "uint64" }, { name: "nonceEpoch", type: "uint256" }, { name: "operatorNonce", type: "uint256" },
  ] }, value);
  await e.market.connect(e.client).awardJob(2, value, sig);
  return e.market.getJob(2);
}

describe("M-02 fixed-reserve operator-fault dispute resolution", function () {
  it("slashes the entire recorded reserve on a resolver fault decision", async function () {
    const e = await deploy();
    const j0 = await post(e);
    const j = await award(e, j0);
    await e.market.connect(e.operator).openDispute(1, j.stateVersion);
    const disputed = await e.market.getJob(1);
    const reserve = disputed.stakeReserved;
    const reward = disputed.reward;
    await expect(e.market.connect(e.owner).resolveDispute(1, 2n * U, true, H("fault"), H("evidence"), disputed.stateVersion))
      .to.emit(e.market, "OperatorFaultDeclared").withArgs(1n, e.operator.address, reserve);
    const final = await e.market.getJob(1);
    expect(final.status).to.equal(6n);
    expect(await e.market.credits(e.client)).to.equal(reward - 2n * U + reserve);
    expect(await e.market.credits(e.operator)).to.equal(2n * U - (2n * U * 500n / 10_000n));
    expect(await e.market.credits(e.treasury)).to.equal(2n * U * 500n / 10_000n);
    expect(await e.market.freeStake(e.operator.address)).to.equal(500n * U - reserve);
    expect(await e.market.reservedStake(e.operator.address)).to.equal(0n);
    await invariant(e);
  });

  it("normal false resolution releases reserve and keeps fee only on gross payout", async function () {
    const e = await deploy();
    const j = await award(e, await post(e));
    await e.market.connect(e.client).openDispute(1, j.stateVersion);
    const disputed = await e.market.getJob(1);
    const reserve = disputed.stakeReserved;
    await e.market.connect(e.owner).resolveDispute(1, 2n * U, false, H("normal"), H("evidence"), disputed.stateVersion);
    expect(await e.market.freeStake(e.operator.address)).to.equal(500n * U);
    expect(await e.market.credits(e.client)).to.equal(8n * U);
    expect(await e.market.credits(e.operator)).to.equal(1_900_000n);
    expect(await e.market.credits(e.treasury)).to.equal(100_000n);
    expect(reserve).to.be.greaterThan(0n);
    await invariant(e);
  });

  it("rejects zero-refund fault decisions before state or token mutation", async function () {
    const e = await deploy();
    const j = await award(e, await post(e));
    await e.market.connect(e.client).openDispute(1, j.stateVersion);
    const before = await e.market.getJob(1);
    const clientCredit = await e.market.credits(e.client);
    const operatorFree = await e.market.freeStake(e.operator.address);
    await expect(e.market.connect(e.owner).resolveDispute(1, before.reward, true, H("fault"), H("evidence"), before.stateVersion)).to.be.reverted;
    const after = await e.market.getJob(1);
    expect(after.status).to.equal(before.status);
    expect(after.stateVersion).to.equal(before.stateVersion);
    expect(await e.market.credits(e.client)).to.equal(clientCredit);
    expect(await e.market.freeStake(e.operator.address)).to.equal(operatorFree);
    await invariant(e);
  });

  it("does not slash when the arbiter is inactive and the dispute times out", async function () {
    const e = await deploy();
    const j = await award(e, await post(e));
    await e.market.connect(e.operator).openDispute(1, j.stateVersion);
    const disputed = await e.market.getJob(1);
    const freeBefore = await e.market.freeStake(e.operator.address);
    await jump(7 * DAY);
    await e.market.connect(e.outsider).claimDisputeTimeout(1, disputed.stateVersion);
    expect(await e.market.freeStake(e.operator.address)).to.equal(500n * U);
    expect(await e.market.reservedStake(e.operator.address)).to.equal(0n);
    await invariant(e);
  });

  it("allows a submitted-job operator fault decision and slashes the entire reserve", async function () {
    const e = await deploy();
    let j = await award(e, await post(e));
    await e.market.connect(e.operator).submitDelivery(1, H("submitted"), j.stateVersion);
    j = await e.market.getJob(1);
    await e.market.connect(e.operator).openDispute(1, j.stateVersion);
    const disputed = await e.market.getJob(1);
    const reserve = disputed.stakeReserved;
    await e.market.connect(e.owner).resolveDispute(1, 1n * U, true, H("fault"), H("evidence"), disputed.stateVersion);
    expect((await e.market.getJob(1)).status).to.equal(6n);
    expect(await e.market.credits(e.client)).to.equal(9n * U + reserve);
    expect(await e.market.reservedStake(e.operator.address)).to.equal(0n);
    expect(await e.market.activeJobs(e.operator.address)).to.equal(0n);
    await invariant(e);
  });

  it("decrements active accounting once and does not touch a second job", async function () {
    const e = await deploy();
    const first = await award(e, await post(e));
    await e.market.connect(e.operator).openDispute(1, first.stateVersion);
    await postSecond(e);
    const secondAward = await awardSecond(e);
    const before = await e.market.activeJobs(e.operator.address);
    await e.market.connect(e.owner).resolveDispute(1, 2n * U, true, H("fault"), H("evidence"), (await e.market.getJob(1)).stateVersion);
    expect(await e.market.activeJobs(e.operator.address)).to.equal(before - 1n);
    expect((await e.market.getJob(2)).stakeReserved).to.equal(secondAward.stakeReserved);
    await expect(e.market.connect(e.owner).resolveDispute(1, 2n * U, true, H("again"), H("evidence"), (await e.market.getJob(1)).stateVersion)).to.be.reverted;
    expect(await e.market.activeJobs(e.operator.address)).to.equal(before - 1n);
    await invariant(e);
  });
});
