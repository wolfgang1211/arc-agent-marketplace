const { expect } = require("chai");
const { deploy, post, award, jump, invariant, H, DAY } = require("./helpers/v2-stage-c-fixture");

describe("AgentMarketplaceV2 Stage C stake review and mutual replay", function () {
  const live = [];
  afterEach(async function () { for (const e of live.splice(0)) await invariant(e); });

  it("releases full fault reserve without fee and keeps a second job isolated", async function () {
    const e = await deploy(); live.push(e); let j = await award(e, await post(e));
    await e.market.connect(e.operator).submitDelivery(1, H("never"), j.stateVersion);
    // A submitted job is not a delivery fault; create a second in-progress job.
    const e2 = await deploy(); live.push(e2); j = await award(e2, await post(e2));
    await jump(Number(j.deliveryDeadline - BigInt((await require("hardhat").ethers.provider.getBlock("latest")).timestamp)) + 1);
    await e2.market.connect(e2.outsider).claimDeliveryTimeout(1, j.stateVersion); const f = await e2.market.getJob(1);
    expect(f.status).to.equal(7n); expect(f.faultReviewPending).to.equal(true);
    await jump(Number(f.faultReviewDeadline - BigInt((await require("hardhat").ethers.provider.getBlock("latest")).timestamp)));
    await e2.market.connect(e2.outsider).releaseFaultReview(1, (await e2.market.getJob(1)).stateVersion);
    expect(await e2.market.reservedStake(e2.operator.address)).to.equal(0n);
  });

  it("prevents mutual acceptance replay after terminal settlement and expiry", async function () {
    const e = await deploy(); live.push(e); let j = await award(e, await post(e));
    await e.market.connect(e.operator).submitDelivery(1, H("done"), j.stateVersion); j = await e.market.getJob(1);
    const expiry = BigInt((await require("hardhat").ethers.provider.getBlock("latest")).timestamp) + BigInt(DAY);
    await e.market.connect(e.operator).proposeMutual(1, 4n * 1_000_000n, 6n * 1_000_000n, expiry, j.stateVersion); j = await e.market.getJob(1);
    await e.market.connect(e.client).acceptMutual(1, j.stateVersion, 1); j = await e.market.getJob(1);
    await expect(e.market.connect(e.operator).acceptMutual(1, j.stateVersion, 1)).to.be.reverted;
    await expect(e.market.connect(e.client).proposeMutual(1, 4n * 1_000_000n, 6n * 1_000_000n, expiry, j.stateVersion)).to.be.reverted;
  });
});
