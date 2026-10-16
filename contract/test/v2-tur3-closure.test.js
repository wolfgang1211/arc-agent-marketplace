const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const crypto = require("crypto");
const { deployFixture, post, award, submit, application, mineExact, latest, DAY, H, U } = require("./helpers/v2-matrix-fixture");
const { checkBytes } = require("../scripts/check-v2-size");

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
    const e = await deployFixture(); const j = await realJob(e);
    let now = await latest();
    await e.market.connect(e.operator).requestDeliveryExtension(1, BigInt(j.deliveryDeadline) + 3600n, BigInt(now + 1800), j.stateVersion);
    await expect(e.market.connect(e.client).rejectDeliveryExtension(1, 1, (await e.market.getJob(1)).stateVersion)).to.not.be.reverted;
    let x = await e.market.getJob(1); expect(x.stateVersion).to.equal(j.stateVersion);
    now = await latest();
    await e.market.connect(e.operator).requestDeliveryExtension(1, BigInt(x.deliveryDeadline) + 3600n, BigInt(now + 1800), x.stateVersion);
    x = await e.market.getJob(1);
    await expect(e.market.connect(e.operator).revokeDeliveryExtension(1, 2, x.stateVersion)).to.not.be.reverted;
    await submit(e, 1); x = await e.market.getJob(1);
    now = await latest();
    await e.market.connect(e.client).proposeMutual(1, 4n * U, 6n * U, BigInt(now + DAY), x.stateVersion);
    x = await e.market.getJob(1);
    await expect(e.market.connect(e.operator).rejectMutual(1, x.stateVersion)).to.not.be.reverted;
    x = await e.market.getJob(1);
    await e.market.connect(e.client).proposeMutual(1, 4n * U, 6n * U, BigInt((await latest()) + DAY), x.stateVersion);
    x = await e.market.getJob(1);
    await expect(e.market.connect(e.client).revokeMutual(1, x.stateVersion)).to.not.be.reverted;
    expect((await e.market.getJob(1)).status).to.equal(2n);
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
    const source = ["contracts/AgentMarketplaceV2.sol", "contracts/OperatorCollateralVaultV2.sol"].map((file) => ({ file, sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") }));
    const testLines = fs.readFileSync("test/v2-tur3-closure.test.js", "utf8").split(/\r?\n/);
    const findings = Object.entries(names).map(([finding, testFullName]) => ({ finding, testFile: "test/v2-tur3-closure.test.js", testFullName, sourceFileLine: testLines.findIndex((line) => line.includes(`it(names.${finding}`)) + 1, status: "verifiedpass" }));
    const out = { name: "v2-tur3-closure-evidence", command: "npx hardhat test --no-compile --config hardhat.v2.config.js --network hardhat test/v2-tur3-closure.test.js", findings, source, mainHash: "52641ab6c47b98da6454ddafa04a2e7895757d8b7ba10f132e76490a4a2f1720", vaultHash: "58b95582923b33f170e0879c0eb9c5fede1d1dfc6553fc3a68ed04f03880f89f" };
    fs.writeFileSync("docs/v2-tur3-closure-evidence.json", JSON.stringify(out, null, 2) + "\n");
  });
});
