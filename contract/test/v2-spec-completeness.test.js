const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployFixture, post, application } = require("./helpers/v2-matrix-fixture");

const U = 1_000_000n;

describe("AgentMarketplaceV2 verified acceptance gaps", function () {
  it("rejects every non-test award to a listed house operator before reservation", async function () {
    const e = await deployFixture();
    await e.market.connect(e.owner).setHouse(e.operator.address, true);
    const p = await post(e);
    const before = await e.market.getJob(p.id);
    const freeBefore = await e.market.freeStake(e.operator.address);
    const activeBefore = await e.market.activeJobs(e.operator.address);
    await expect(e.market.connect(e.client).awardJob(p.id, ...(Object.values(await application(e, p.id)))))
      .to.be.reverted;
    const after = await e.market.getJob(p.id);
    expect(after.stateVersion).to.equal(before.stateVersion);
    expect(after.status).to.equal(before.status);
    expect(await e.market.freeStake(e.operator.address)).to.equal(freeBefore);
    expect(await e.market.activeJobs(e.operator.address)).to.equal(activeBefore);

    await e.market.connect(e.owner).setTestClient(e.client.address, true);
    const testJob = await post(e, { testJob: true });
    await e.market.connect(e.owner).setTestClient(e.client.address, false);
    await expect(e.market.connect(e.client).awardJob(testJob.id, ...(Object.values(await application(e, testJob.id)))))
      .to.be.reverted;

    await expect(e.market.connect(e.owner).setHouse(e.operator.address, false))
      .to.be.revertedWithCustomError(e.market, "Conflict");
    await expect(e.market.connect(e.client).awardJob(p.id, ...(Object.values(await application(e, p.id)))))
      .to.be.reverted;
  });

  it("binds resolver and collateral/extension policy in canonical terms and emits readable terms/state", async function () {
    const e = await deployFixture();
    const first = await post(e);
    const termsLog = first.receipt.logs.find((x) => x.fragment?.name === "JobTerms");
    expect(termsLog).to.not.equal(undefined);
    expect(termsLog.args.canonicalTermsHash).to.equal(first.job.canonicalTermsHash);
    expect(termsLog.args.resolver).to.equal(first.job.resolver);
    const policy = termsLog.args.collateralPolicy;
    expect(policy & ((1n << 64n) - 1n)).to.equal(180n * 86400n);
    expect((policy >> 64n) & ((1n << 64n) - 1n)).to.equal(5n * U);
    expect((policy >> 128n) & ((1n << 32n) - 1n)).to.equal(10_000n);
    expect((policy >> 160n) & ((1n << 16n) - 1n)).to.equal(1000n);

    await e.market.connect(e.owner).setResolverForClient(e.client.address, e.arbiter.address);
    const second = await post(e);
    expect(second.job.resolver).to.equal(e.arbiter.address);
    expect(second.job.canonicalTermsHash).to.not.equal(first.job.canonicalTermsHash);

    const signed = await application(e, first.id);
    const awardTx = await e.market.connect(e.client).awardJob(first.id, signed.value, signed.sig);
    const receipt = await awardTx.wait();
    const state = receipt.logs.find((x) => x.fragment?.name === "JobState");
    expect(state).to.not.equal(undefined);
    expect(state.args.jobId).to.equal(BigInt(first.id));
    expect(state.args.stateVersion).to.equal(2n);
    expect(state.args.status).to.equal(1n);
    expect(state.args.clockPack & ((1n << 64n) - 1n)).to.be.greaterThan(0n);
    expect((state.args.counters >> 88n) & 1n).to.equal(0n);
  });
});
