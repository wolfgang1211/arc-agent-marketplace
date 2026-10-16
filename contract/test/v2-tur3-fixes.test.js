const { expect } = require("chai");
const { deployFixture, post, application, U } = require("./helpers/v2-matrix-fixture");

async function reserveSnapshot(e, operator) {
  return {
    job: await e.market.getJob(1),
    escrowed: await e.market.escrowed(),
    free: await e.market.freeStake(operator.address),
    reserved: await e.market.reservedStake(operator.address),
    active: await e.market.activeJobs(operator.address),
    vaultReserve: await e.vault.reserveOf(1),
  };
}

function expectSameBeforeAfter(before, after, e, operator) {
  return Promise.all([
    expect(after.job.stateVersion).to.equal(before.job.stateVersion),
    expect(after.job.status).to.equal(before.job.status),
    expect(after.job.operator).to.equal(before.job.operator),
    expect(after.escrowed).to.equal(before.escrowed),
    expect(after.free).to.equal(before.free),
    expect(after.reserved).to.equal(before.reserved),
    expect(after.active).to.equal(before.active),
    expect(after.vaultReserve.amount).to.equal(before.vaultReserve.amount),
    expect(after.vaultReserve.disposition).to.equal(before.vaultReserve.disposition),
  ]);
}

describe("V2 Tur3 approved N-01/N-02 fixes", function () {
  it("N-01 rejects an operator equal to the frozen resolver before any mutation", async function () {
    const e = await deployFixture();
    await e.market.connect(e.owner).setResolverForClient(e.client.address, e.operator.address);
    const p = await post(e);
    const signed = await application(e, p.id, e.operator);
    const before = await reserveSnapshot(e, e.operator);
    await expect(e.market.connect(e.client).awardJob(p.id, signed.value, signed.sig))
      .to.be.revertedWithCustomError(e.market, "Conflict");
    const after = await reserveSnapshot(e, e.operator);
    await expectSameBeforeAfter(before, after, e, e.operator);
    expect(await e.vault.reservedStake(e.operator.address)).to.equal(0n);
  });

  it("N-02 makes house membership permanent and rejects house operators on normal jobs", async function () {
    const e = await deployFixture();
    await expect(e.market.connect(e.owner).setHouse(e.operator.address, true))
      .to.emit(e.market, "HouseStatusChanged").withArgs(e.operator.address, false, true);
    await expect(e.market.connect(e.owner).setHouse(e.operator.address, false))
      .to.be.revertedWithCustomError(e.market, "Conflict");

    const normal = await post(e);
    const normalApplication = await application(e, normal.id, e.operator);
    const before = await reserveSnapshot(e, e.operator);
    await expect(e.market.connect(e.client).awardJob(normal.id, normalApplication.value, normalApplication.sig))
      .to.be.revertedWithCustomError(e.market, "Conflict");
    const after = await reserveSnapshot(e, e.operator);
    await expectSameBeforeAfter(before, after, e, e.operator);
  });

  it("N-02 permits only a test-client test job for a permanent house operator", async function () {
    const e = await deployFixture();
    await e.market.connect(e.owner).setHouse(e.operator.address, true);
    await e.market.connect(e.owner).setTestClient(e.client.address, true);
    const testJob = await post(e, { testJob: true, reward: 10n * U });
    const signed = await application(e, testJob.id, e.operator);
    await expect(e.market.connect(e.client).awardJob(testJob.id, signed.value, signed.sig)).to.not.be.reverted;
    const awarded = await e.market.getJob(testJob.id);
    expect(awarded.house).to.equal(true);
    expect(awarded.operator).to.equal(e.operator.address);
  });
});
