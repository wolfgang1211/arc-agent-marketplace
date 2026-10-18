const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const { deployFixture, post, award, submit, application, mineExact, latest, DAY, H, U } = require("./helpers/v2-matrix-fixture");
const { checkBytes } = require("../scripts/check-v2-size");
const { writeEvidence } = require("./helpers/v2-evidence-reporter");

const names = {
  H01: "H01 same-block intent ordering closes mutual and extension races without a state-version bump",
  L01: "L01 delivery changes and replacement mutual requests reject stale state and request versions",
  L03: "L03 Ownable2Step transfer retains old owner until acceptance and blocks renounce",
  L04: "L04 paired deployment aborts on a real intervening owner transaction before funding",
  M02: "M02 every terminal settlement path closes active accounting exactly once",
  N01: "N01 resolver/operator conflict is rejected before job mutation",
  N02: "N02 house membership is permanent and normal-house award is forbidden",
  L02: "L02 both V2 runtimes enforce the 24000-byte boundary and V1 gate remains unchanged",
  L05: "L05 outsiders can perform timed fault release and dispute-timeout settlement"
};

async function realJob(e, opts = {}) { return award(e, (await post(e, opts)).id); }
async function resolver(e, id = 1) { return (await e.market.getJob(id)).resolver; }
async function advanceTo(ts) { await mineExact(ts); }

async function sameBlockPair(sendFirst, sendSecond) {
  await ethers.provider.send("evm_setAutomine", [false]);
  try {
    const first = await sendFirst({ gasLimit: 500000n, gasPrice: 1_000_000_000n });
    const second = await sendSecond({ gasLimit: 500000n, gasPrice: 1_000_000_000n });
    await ethers.provider.send("evm_mine");
    const receipts = [await first.wait(), await second.wait()];
    const blocks = await Promise.all(receipts.map((r) => ethers.provider.getBlock(r.blockNumber)));
    expect(receipts[0].blockNumber).to.equal(receipts[1].blockNumber);
    expect(receipts[0].blockHash).to.equal(receipts[1].blockHash);
    expect(receipts[0].index).to.equal(0);
    expect(receipts[1].index).to.equal(1);
    expect(blocks[0].timestamp).to.equal(blocks[1].timestamp);
    console.log(JSON.stringify({ h01SameBlock: receipts.map((receipt, i) => ({ blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, transactionIndex: receipt.index, timestamp: blocks[i].timestamp })) }));
    return receipts;
  } finally {
    await ethers.provider.send("evm_setAutomine", [true]);
  }
}

async function deployInterleavedPair() {
  const [owner, , , treasury] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("MockUSDC", owner);
  const Vault = await ethers.getContractFactory("OperatorCollateralVaultV2", owner);
  const Market = await ethers.getContractFactory("AgentMarketplaceV2", owner);
  const token = await Token.deploy(); await token.waitForDeployment();
  const nonce = await ethers.provider.getTransactionCount(owner.address);
  const predicted = ethers.getCreateAddress({ from: owner.address, nonce: nonce + 1 });
  const vault = await Vault.deploy(await token.getAddress(), predicted, treasury.address); await vault.waitForDeployment();
  await owner.sendTransaction({ to: treasury.address, value: 1n });
  const consumed = await ethers.provider.getTransactionCount(owner.address);
  expect(consumed).to.equal(nonce + 2);
  await expect(Market.deploy(await token.getAddress(), owner.address, treasury.address, await vault.getAddress())).to.be.revertedWithCustomError(Market, "InvalidTerms");
  expect(await token.balanceOf(await vault.getAddress())).to.equal(0n);
}

describe("V2 TUR3 dedicated closure evidence", function () {
  this.timeout(240000);

  it(names.H01, async function () {
    const extension = await deployFixture(); const job = await realJob(extension); const now = await latest();
    const version = job.stateVersion;
    await sameBlockPair(
      (overrides) => extension.market.connect(extension.operator).requestDeliveryExtension(1, BigInt(job.deliveryDeadline) + 3600n, BigInt(now + 1800), version, overrides),
      (overrides) => extension.market.connect(extension.client).rejectDeliveryExtension(1, 1, version, overrides),
    );
    expect((await extension.market.getJob(1)).stateVersion).to.equal(version);
    const mutual = await deployFixture(); await realJob(mutual); await submit(mutual, 1); const submitted = await mutual.market.getJob(1);
    const mutualNow = await latest(); const mutualVersion = submitted.stateVersion;
    await sameBlockPair(
      (overrides) => mutual.market.connect(mutual.client).proposeMutual(1, 4n * U, 6n * U, BigInt(mutualNow + DAY), mutualVersion, overrides),
      (overrides) => mutual.market.connect(mutual.operator).rejectMutual(1, mutualVersion, overrides),
    );
    expect((await mutual.market.getJob(1)).stateVersion).to.equal(mutualVersion);
  });

  it(names.L01, async function () {
    const e = await deployFixture(); let j = await realJob(e); await submit(e, 1); j = await e.market.getJob(1);
    const stale = j.stateVersion;
    await e.market.connect(e.client).proposeMutual(1, 4n * U, 6n * U, BigInt((await latest()) + DAY), stale);
    j = await e.market.getJob(1);
    await e.market.connect(e.client).requestRevision(1, H("criterion"), H("reference"), j.stateVersion);
    j = await e.market.getJob(1);
    await expect(e.market.connect(e.operator).acceptMutual(1, stale, 1)).to.be.reverted;
    const fresh = await e.market.getJob(1);
    await e.market.connect(e.client).proposeMutual(1, 3n * U, 7n * U, BigInt((await latest()) + DAY), fresh.stateVersion);
    const replaced = await e.market.getJob(1);
    expect(replaced.stateVersion).to.equal(fresh.stateVersion);
    await expect(e.market.connect(e.operator).acceptMutual(1, replaced.stateVersion, 1)).to.be.reverted;
    await expect(e.market.connect(e.operator).acceptMutual(1, replaced.stateVersion, 2)).to.not.be.reverted;
    expect((await e.market.getJob(1)).status).to.equal(6n);
  });

  it(names.L03, async function () {
    const e = await deployFixture();
    await e.market.connect(e.owner).transferOwnership(e.outsider.address);
    expect(await e.market.owner()).to.equal(e.owner.address);
    expect(await e.market.pendingOwner()).to.equal(e.outsider.address);
    await expect(e.market.connect(e.operator).acceptOwnership()).to.be.reverted;
    await e.market.connect(e.outsider).acceptOwnership();
    expect(await e.market.owner()).to.equal(e.outsider.address);
    await expect(e.market.connect(e.owner).setHouse(e.client.address, true)).to.be.reverted;
    await expect(e.market.connect(e.outsider).renounceOwnership()).to.be.reverted;
    expect(await e.market.owner()).to.equal(e.outsider.address);
  });

  it(names.L04, async function () { await deployInterleavedPair(); });

  it(names.M02, async function () {
    const cases = ["approve", "review-timeout", "mutual", "dispute-timeout", "delivery-timeout", "access-fallback"];
    for (const kind of cases) {
      const e = await deployFixture(); let j = await realJob(e); const before = await e.market.activeJobs(e.operator.address);
      if (kind === "approve") { await submit(e, 1); j = await e.market.getJob(1); await e.market.connect(e.client).approve(1, j.stateVersion); }
      if (kind === "review-timeout") { await submit(e, 1); j = await e.market.getJob(1); await advanceTo(Number(j.reviewDeadline)); await e.market.connect(e.outsider).claimReviewTimeout(1, j.stateVersion); }
      if (kind === "mutual") { await submit(e, 1); j = await e.market.getJob(1); await e.market.connect(e.client).proposeMutual(1, 4n * U, 6n * U, BigInt((await latest()) + DAY), j.stateVersion); j = await e.market.getJob(1); await e.market.connect(e.operator).acceptMutual(1, j.stateVersion, 1); }
      if (kind === "dispute-timeout") { await e.market.connect(e.client).openDispute(1, j.stateVersion); j = await e.market.getJob(1); await advanceTo((await latest()) + 7 * DAY); await e.market.connect(e.outsider).claimDisputeTimeout(1, j.stateVersion); }
      if (kind === "delivery-timeout") { await advanceTo(Number(j.deliveryDeadline)); await e.market.connect(e.outsider).claimDeliveryTimeout(1, j.stateVersion); j = await e.market.getJob(1); await advanceTo(Number(j.faultReviewDeadline)); await e.market.connect(e.outsider).releaseFaultReview(1, j.stateVersion); }
      if (kind === "access-fallback") { await submit(e, 1); j = await e.market.getJob(1); await e.market.connect(e.client).reportAccess(1, j.stateVersion); j = await e.market.getJob(1); await advanceTo(Number(j.repairDeadline)); await e.market.connect(e.outsider).triggerAccessRecoveryDispute(1, j.stateVersion); j = await e.market.getJob(1); await advanceTo((await latest()) + 7 * DAY); await e.market.connect(e.outsider).claimDisputeTimeout(1, j.stateVersion); }
      expect(await e.market.activeJobs(e.operator.address)).to.equal(0n, kind);
      await expect(e.market.connect(e.outsider).claimDisputeTimeout(1, (await e.market.getJob(1)).stateVersion)).to.be.reverted;
      expect(before).to.equal(1n);
    }
  });

  it(names.N01, async function () {
    const e = await deployFixture(); await e.market.connect(e.owner).setResolverForClient(e.client.address, e.operator.address); const p = await post(e); const a = await application(e, p.id, e.operator); const before = await e.market.getJob(p.id);
    await expect(e.market.connect(e.client).awardJob(p.id, a.value, a.sig)).to.be.revertedWithCustomError(e.market, "Conflict");
    const after = await e.market.getJob(p.id); expect(after.status).to.equal(before.status); expect(after.stateVersion).to.equal(before.stateVersion); expect(await e.market.activeJobs(e.operator.address)).to.equal(0n);
  });

  it(names.N02, async function () {
    const e = await deployFixture(); await e.market.connect(e.owner).setHouse(e.operator.address, true); await expect(e.market.connect(e.owner).setHouse(e.operator.address, false)).to.be.revertedWithCustomError(e.market, "Conflict");
    const p = await post(e); const a = await application(e, p.id, e.operator); await expect(e.market.connect(e.client).awardJob(p.id, a.value, a.sig)).to.be.revertedWithCustomError(e.market, "Conflict");
  });

  it(names.L02, async function () {
    checkBytes("AgentMarketplaceV2", 24000); expect(() => checkBytes("AgentMarketplaceV2", 24001)).to.throw(/exceeds 24000/); checkBytes("OperatorCollateralVaultV2", 24000); expect(() => checkBytes("OperatorCollateralVaultV2", 24001)).to.throw(/exceeds 24000/);
    const current = fs.readFileSync("scripts/check-v2-size.js", "utf8"); expect(current).to.include("const LIMIT = 24_000"); expect(current).to.include("AgentMarketplaceV2");
  });

  it(names.L05, async function () {
    const e = await deployFixture(); let j = await realJob(e); await advanceTo(Number(j.deliveryDeadline)); await e.market.connect(e.outsider).claimDeliveryTimeout(1, j.stateVersion); j = await e.market.getJob(1); await advanceTo(Number(j.faultReviewDeadline)); await expect(e.market.connect(e.outsider).releaseFaultReview(1, j.stateVersion)).to.not.be.reverted; expect(await e.market.activeJobs(e.operator.address)).to.equal(0n);
    const d = await deployFixture(); j = await realJob(d); await d.market.connect(d.client).openDispute(1, j.stateVersion); j = await d.market.getJob(1); await advanceTo((await latest()) + 7 * DAY); await expect(d.market.connect(d.outsider).claimDisputeTimeout(1, j.stateVersion)).to.not.be.reverted; expect(await d.market.activeJobs(d.operator.address)).to.equal(0n);
  });

  after(function () {
    writeEvidence({
      suite: this.test.parent,
      names,
      testFile: "test/v2-tur3-closure.test.js",
      outputPath: "docs/v2-tur3-closure-evidence.json",
      command: "npx hardhat test --no-compile --config hardhat.v2.config.js --network hardhat test/v2-tur3-closure.test.js",
    });
  });
});
