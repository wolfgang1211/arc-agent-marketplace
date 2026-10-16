const { expect } = require("chai");
const { ethers } = require("hardhat");
const { wrapMarket } = require("./helpers/v2-read-model");
const { deployV2Pair } = require("./helpers/deploy-v2-pair");

const U = 1_000_000n;
const H = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
const DAY = 86400;
const fixtures = [];

async function now() { return BigInt((await ethers.provider.getBlock("latest")).timestamp); }
async function jump(seconds) { await ethers.provider.send("evm_increaseTime", [seconds]); await ethers.provider.send("evm_mine"); }
async function deploy(opts = {}) {
  const [owner, client, operator, treasury, arbiter, outsider] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("MockUSDC"); const token = await Token.deploy();
  const pair = await deployV2Pair({ token, owner, treasury });
  const market = wrapMarket(pair.market); const vault = pair.vault;
  for (const s of [owner, client, operator, treasury, arbiter, outsider]) await token.mint(s.address, 2_000n * U);
  await token.connect(operator).approve(vault, 500n * U); await vault.connect(operator).depositStake(500n * U); await market.connect(operator).registerOperator();
  fixtures.push({ owner, client, operator, treasury, arbiter, outsider, token, market, vault });
  return fixtures.at(-1);
}
async function post(e, { delivery = DAY, revisionLimit = 2, unlimited = false } = {}) {
  const reward = 10n * U; await e.token.connect(e.client).approve(e.market, reward);
  const apply = (await now()) + 2n * BigInt(DAY);
  await e.market.connect(e.client).postJob(reward, apply, delivery, DAY, 12 * 3600, revisionLimit, unlimited, H("policy-root"), H("description"), false);
  const j = await e.market.getJob(1); const terms = j.canonicalTermsHash;
  const net = await ethers.provider.getNetwork();
  const value = { jobId: 1n, operator: e.operator.address, termsHash: terms, validAfter: 0, validBefore: j.applyBy, nonceEpoch: 0, operatorNonce: 0 };
  const sig = await e.operator.signTypedData({ name: "AlphaBoard Agent Marketplace V2", version: "1", chainId: net.chainId, verifyingContract: await e.market.getAddress() }, { Application: [
    { name: "jobId", type: "uint256" }, { name: "operator", type: "address" }, { name: "termsHash", type: "bytes32" },
    { name: "validAfter", type: "uint64" }, { name: "validBefore", type: "uint64" }, { name: "nonceEpoch", type: "uint256" }, { name: "operatorNonce", type: "uint256" },
  ] }, value);
  await e.market.connect(e.client).awardJob(1, value, sig);
  return e.market.getJob(1);
}
async function submit(e, label = "delivery-1") { let j = await e.market.getJob(1); await e.market.connect(e.operator).submitDelivery(1, H(label), j.stateVersion); return e.market.getJob(1); }
async function invariant(e) {
  let free = 0n, reserved = 0n, credits = 0n;
  for (const s of [e.owner, e.client, e.operator, e.treasury, e.arbiter, e.outsider]) { free += await e.market.freeStake(s.address); reserved += await e.market.reservedStake(s.address); credits += await e.market.credits(s.address); }
  let escrow = 0n; const n = Number(await e.market.nextJobId());
  for (let id = 1; id < n; id++) { const j = await e.market.getJob(id); if (Number(j.status) <= 5) escrow += j.reward; }
  expect(free + reserved).to.equal(await e.market.stakeLiability());
  expect(credits).to.equal(await e.market.creditsLiability()); expect(escrow).to.equal(await e.market.escrowed());
  expect(await e.token.balanceOf(e.market)).to.equal(escrow + await e.market.creditsLiability() + await e.market.surplus());
}

describe("AgentMarketplaceV2 Stage B work-clock workflows", function () {
  afterEach(async function () { for (const e of fixtures.splice(0)) await invariant(e); });

  it("accepts unlimited client-approved extensions, including cumulative count above two", async function () {
    const e = await deploy(); const j0 = await post(e, { delivery: DAY });
    const base = j0.deliveryDeadline; const max = base + (180n * BigInt(DAY) - j0.deliveryDuration);
    let j = j0;
    for (let i = 0; i < 3; i++) {
      const current = j.deliveryDeadline; const requested = i === 2 ? max : current + 60n * BigInt(DAY);
      const expiry = current - 1n;
      await e.market.connect(e.operator).requestDeliveryExtension(1, requested, expiry, j.stateVersion);
      j = await e.market.getJob(1);
      await e.market.connect(e.client).grantDeliveryExtension(1, j.extensionRequestId, j.stateVersion);
      j = await e.market.getJob(1);
    }
    expect(j.extensionTotal).to.equal(179n * BigInt(DAY)); expect(j.deliveryDuration + j.extensionTotal).to.equal(180n * BigInt(DAY)); expect(j.deliveryDeadline).to.equal(max);
  });

  it("enforces extension roles, one pending request, expiry and exact 180-day cap", async function () {
    const e = await deploy(); let j = await post(e, { delivery: DAY });
    const current = j.deliveryDeadline; const requested = current + BigInt(DAY); const expiry = current - 1n;
    await expect(e.market.connect(e.client).requestDeliveryExtension(1, requested, expiry, j.stateVersion)).to.be.reverted;
    await e.market.connect(e.operator).requestDeliveryExtension(1, requested, expiry, j.stateVersion); j = await e.market.getJob(1);
    await expect(e.market.connect(e.operator).requestDeliveryExtension(1, requested + BigInt(DAY), expiry, j.stateVersion)).to.be.reverted;
    await expect(e.market.connect(e.outsider).rejectDeliveryExtension(1, j.extensionRequestId, j.stateVersion)).to.be.reverted;
    await e.market.connect(e.client).rejectDeliveryExtension(1, j.extensionRequestId, j.stateVersion); j = await e.market.getJob(1);
    await e.market.connect(e.operator).requestDeliveryExtension(1, requested, expiry, j.stateVersion); j = await e.market.getJob(1);
    await e.market.connect(e.operator).revokeDeliveryExtension(1, j.extensionRequestId, j.stateVersion); j = await e.market.getJob(1);
    await e.market.connect(e.operator).requestDeliveryExtension(1, current + 179n * BigInt(DAY), current - 1n, j.stateVersion); j = await e.market.getJob(1);
    await e.market.connect(e.client).grantDeliveryExtension(1, j.extensionRequestId, j.stateVersion); j = await e.market.getJob(1);
    expect(j.deliveryDuration + j.extensionTotal).to.equal(180n * BigInt(DAY));
    await expect(e.market.connect(e.operator).requestDeliveryExtension(1, j.deliveryDeadline + 1n, j.deliveryDeadline - 1n, j.stateVersion)).to.be.reverted;
  });

  it("accepts extension expiry at D-1 and D, rejects D+1, and rejects stale/request-id mutations", async function () {
    const e = await deploy(); let j = await post(e, { delivery: DAY });
    const d = j.deliveryDeadline; const requested = d + BigInt(DAY);
    await expect(e.market.connect(e.operator).requestDeliveryExtension(1, requested, d + 1n, j.stateVersion)).to.be.reverted;
    await e.market.connect(e.operator).requestDeliveryExtension(1, requested, d - 1n, j.stateVersion); j = await e.market.getJob(1);
    await expect(e.market.connect(e.client).grantDeliveryExtension(1, 99, j.stateVersion)).to.be.reverted;
    await expect(e.market.connect(e.client).grantDeliveryExtension(1, j.extensionRequestId, j.stateVersion - 1n)).to.be.reverted;
    await e.market.connect(e.client).rejectDeliveryExtension(1, j.extensionRequestId, j.stateVersion); j = await e.market.getJob(1);
    await e.market.connect(e.operator).requestDeliveryExtension(1, requested, d, j.stateVersion); j = await e.market.getJob(1);
    await e.market.connect(e.client).grantDeliveryExtension(1, j.extensionRequestId, j.stateVersion);
    expect((await e.market.getJob(1)).extensionTotal).to.equal(BigInt(DAY));
  });  it("does not pause delivery while an extension is pending and invalidates it on delivery", async function () {
    const e = await deploy(); let j = await post(e, { delivery: DAY });
    await e.market.connect(e.operator).requestDeliveryExtension(1, j.deliveryDeadline + BigInt(DAY), j.deliveryDeadline - 1n, j.stateVersion);
    j = await submit(e, "original");
    expect(j.status).to.equal(2n); await expect(e.market.connect(e.client).grantDeliveryExtension(1, 1, j.stateVersion)).to.be.reverted;
  });

  it("uses strict revision windows, full review reset, immutable delivery history and client expiry approval", async function () {
    const e = await deploy(); let j = await post(e, { delivery: DAY }); j = await submit(e, "first");
    await e.market.connect(e.client).requestRevision(1, H("criterion-subset"), H("evidence"), j.stateVersion); j = await e.market.getJob(1);
    const firstCorrection = j.correctionDeadline; await jump(12 * 3600 + 1);
    await expect(e.market.connect(e.operator).submitRevision(1, H("late"), j.stateVersion)).to.be.reverted;
    await expect(e.market.connect(e.client).claimReviewTimeout(1, j.stateVersion)).to.be.reverted;
    await e.market.connect(e.client).approve(1, j.stateVersion);
    expect(await e.market.credits(e.operator)).to.equal(9_500_000n);
    expect(firstCorrection).to.be.greaterThan(0n);

    const e2 = await deploy({}); j = await post(e2, { delivery: DAY }); j = await submit(e2, "first");
    await e2.market.connect(e2.client).requestRevision(1, H("criterion-subset"), H("evidence"), j.stateVersion); j = await e2.market.getJob(1);
    await e2.market.connect(e2.operator).submitRevision(1, H("second"), j.stateVersion); const revised = await e2.market.getJob(1);
    expect(revised.previousDeliveryHash).to.equal(H("first")); expect(revised.deliveryHash).to.equal(H("second"));
    expect(revised.reviewDeadline).to.be.greaterThan(j.reviewDeadline);
  });

  it("allows only client access reports, max two per delivery version, and bounded repair", async function () {
    const e = await deploy(); let j = await post(e, { delivery: DAY }); j = await submit(e, "sealed");
    await expect(e.market.connect(e.operator).reportAccess(1, j.stateVersion)).to.be.reverted;
    await e.market.connect(e.client).reportAccess(1, j.stateVersion); j = await e.market.getJob(1);
    const saved = j.savedReviewRemaining; const repair = j.repairDeadline;
    await expect(e.market.connect(e.operator).recoverAccess(1, H("fixed"), j.stateVersion)).to.not.be.reverted;
    j = await e.market.getJob(1); expect(j.savedReviewRemaining).to.equal(saved); expect(j.reviewDeadline).to.be.greaterThan(await now());
    await e.market.connect(e.client).reportAccess(1, j.stateVersion); j = await e.market.getJob(1);
    await e.market.connect(e.operator).recoverAccess(1, H("fixed-again"), j.stateVersion); j = await e.market.getJob(1);
    await expect(e.market.connect(e.client).reportAccess(1, j.stateVersion)).to.be.reverted;
    await jump(Number(repair - await now()) + 1);
    expect(await e.market.getJob(1)).to.be.ok;

    const e3 = await deploy(); let late = await post(e3, { delivery: DAY }); late = await submit(e3, "late-repair");
    await e3.market.connect(e3.client).reportAccess(1, late.stateVersion); late = await e3.market.getJob(1);
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(late.repairDeadline)]);
    await expect(e3.market.connect(e3.operator).recoverAccess(1, H("too-late"), late.stateVersion)).to.be.reverted;
  });

  it("pins revision and review boundaries, rejects exhausted/zero evidence, and rejects late approval", async function () {
    const e = await deploy(); let j = await post(e, { delivery: DAY, revisionLimit: 1 }); j = await submit(e, "boundary");
    await expect(e.market.connect(e.client).requestRevision(1, ethers.ZeroHash, H("evidence"), j.stateVersion)).to.be.reverted;
    await e.market.connect(e.client).requestRevision(1, H("criterion"), H("evidence"), j.stateVersion); j = await e.market.getJob(1);
    expect(j.revisionsUsed).to.equal(1n);
    await expect(e.market.connect(e.operator).submitRevision(1, ethers.ZeroHash, j.stateVersion)).to.be.reverted;
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(j.correctionDeadline - 1n)]);
    await e.market.connect(e.operator).submitRevision(1, H("revised"), j.stateVersion); j = await e.market.getJob(1);
    expect(j.reviewDeadline).to.equal((await now()) + j.reviewDuration);
    await expect(e.market.connect(e.client).requestRevision(1, H("again"), H("evidence-2"), j.stateVersion)).to.be.reverted;

    const late = await deploy(); let l = await post(late, { delivery: DAY }); l = await submit(late, "late-approve");
    await ethers.provider.send("evm_setNextBlockTimestamp", [Number(l.reviewDeadline)]);
    await expect(late.market.connect(late.client).approve(1, l.stateVersion)).to.be.reverted;
  });

  it("restores the saved review window for identical-hash access repair and resets quota only on a new version", async function () {
    const e = await deploy(); let j = await post(e, { delivery: DAY }); j = await submit(e, "same");
    await e.market.connect(e.client).reportAccess(1, j.stateVersion); j = await e.market.getJob(1);
    const saved = j.savedReviewRemaining;
    await e.market.connect(e.operator).recoverAccess(1, j.deliveryHash, j.stateVersion); j = await e.market.getJob(1);
    expect(j.deliveryHash).to.equal(H("same")); expect(j.savedReviewRemaining).to.equal(saved);
    await e.market.connect(e.client).reportAccess(1, j.stateVersion); j = await e.market.getJob(1);
    await expect(e.market.connect(e.client).reportAccess(1, j.stateVersion)).to.be.reverted;

    const e2 = await deploy(); let r = await post(e2, { delivery: DAY, revisionLimit: 1 }); r = await submit(e2, "v1");
    await e2.market.connect(e2.client).requestRevision(1, H("criterion"), H("evidence"), r.stateVersion); r = await e2.market.getJob(1);
    await e2.market.connect(e2.operator).submitRevision(1, H("v2"), r.stateVersion); r = await e2.market.getJob(1);
    expect(r.accessReports).to.equal(0n); expect(r.deliveryVersion).to.equal(2n);
  });
  it("blocks late financial-right reversal at the delivery deadline", async function () {
    const e = await deploy(); let j = await post(e, { delivery: DAY });
    await jump(Number(j.deliveryDeadline - await now()) + 1); j = await e.market.getJob(1);
    await expect(e.market.connect(e.operator).requestDeliveryExtension(1, j.deliveryDeadline + BigInt(DAY), j.deliveryDeadline - 1n, j.stateVersion)).to.be.reverted;
    await expect(e.market.connect(e.client).openDispute(1,j.stateVersion)).to.be.reverted;
    await e.market.connect(e.outsider).claimDeliveryTimeout(1, j.stateVersion);
    expect((await e.market.getJob(1)).status).to.equal(7n);
  });
});
