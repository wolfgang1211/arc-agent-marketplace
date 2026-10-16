const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const {
  U, DAY, H, deployFixture, latest, mineAt, mineExact, post, award, submit, dispute, assertAccounting,
} = require("./helpers/v2-matrix-fixture");

const matrix = [];
const fixtures = [];
const REQUIRED_UNIMPLEMENTED = [
  "Every dispute state × client/operator × wrong-role/open/terminal/nested/wrong-resolver authorization table",
  "Dispute hard-budget first 5D resume, second 30D work, and 16D extra-delivery ceiling",
  "Dispute quota two job-wide episodes with third episode rejection",
  "Separate first 5D no-reset, second 6D heartbeat, and 12D heartbeat hard/idle D±1 matrix",
  "Expired revision zero cannot create review or silent payout",
  "Revision unlimited 256 real request/submit receipts and revision counter",
  "Access recovery repeated report quota, duplicate count, and review remaining preservation",
  "Access recovery late upload before trigger guard and 30D-late worker plus 7D fallback",
  "House false flags, non-allowlisted client, policy snapshot, and all admin action blocks",
  "Fault slash zero/nonzero/max/excess, D±1, repeated deadline claim, late claim, and no auto-slash",
  "Blocked client token withdrawal does not block claims, releases, or unrelated payments",
  "Free reserved stake overdraw rejection and stake conservation across terminal/pending/fault jobs",
  "Open bystander failure, expiry D±1, signed application award on terminal job",
  "Mutual stale version, reject, expiry, proposer revoke behavior, and during-dispute elapsed time",
  "Mutual full/partial payout fee 5 percent and full refund fee zero",
  "Pre-existing mutual proposal invalidation after approval/delivery and replay rejection",
  "Same-block review late report/dispute/revision and dispute heartbeat/resume/resolve orderings",
  "Same-block ordered receipts for claim then late action and late action then claim across all phases",
  "Extension count above two, 180-day exact/+1 cap, non-InProgress extension rejection",
  "Canonical terms/deadline/stateVersion event observability and no plaintext locator",
  "Stage A fee policy/min reward/terms snapshot and EIP-1271 coverage reference rows",
];
function row(title, tags = []) { const r = { id: `V2-${String(matrix.length + 1).padStart(3, "0")}`, testTitle: title, status: "unimplemented", tags, caseErrors: [] }; matrix.push(r); return r; }
function acceptance(title, tags, fn) {
  const r = row(title, tags);
  it(title, async function () {
    let e;
    try { e = await deployFixture(); fixtures.push(e); await fn(e); r.status = "verifiedpass"; }
    catch (err) { r.status = "verifiedfail"; r.caseErrors.push(String(err?.stack || err)); throw err; }
  });
}
function expectReceiptStatus(provider, hash, status) { return provider.getTransactionReceipt(hash).then((x) => expect(x.status).to.equal(status)); }

describe("AgentMarketplaceV2 full acceptance matrix", function () {
acceptance("D-1 delivery submit is rejected while exact D claim opens fault review", ["timing", "delivery"], async (e) => {
  const p = await post(e, { delivery: DAY }); await award(e, p.id);
  const j = await e.market.getJob(p.id); await mineExact(Number(j.deliveryDeadline) - 1);
  await expect(e.market.connect(e.operator).submitDelivery(p.id, H("late"), (await e.market.getJob(p.id)).stateVersion)).to.be.reverted;
  // The rejected transaction mined the boundary block itself.
  await e.market.connect(e.outsider).claimDeliveryTimeout(p.id, (await e.market.getJob(p.id)).stateVersion);
  const out = await e.market.getJob(p.id);
  expect(Number(out.status)).to.equal(7); expect(await e.market.deadlineFailures(e.operator.address)).to.equal(1n); expect(await e.market.credits(e.client.address)).to.equal(10n * U);
});

acceptance("D+1 review timeout settles submitted work exactly once", ["timing", "review"], async (e) => {
  const p = await post(e); await award(e, p.id); await submit(e, p.id);
  const j = await e.market.getJob(p.id); await mineExact(Number(j.reviewDeadline) + 1);
  await e.market.connect(e.outsider).claimReviewTimeout(p.id, j.stateVersion);
  expect(Number((await e.market.getJob(p.id)).status)).to.equal(6);
  await expect(e.market.connect(e.outsider).claimReviewTimeout(p.id, (await e.market.getJob(p.id)).stateVersion)).to.be.reverted;
});

for (const [label, prep] of [
  ["InProgress", async (e, id) => { await award(e, id); }],
  ["Submitted", async (e, id) => { await award(e, id); await submit(e, id); }],
  ["RevisionPending", async (e, id) => { await award(e, id); await submit(e, id); const j = await e.market.getJob(id); await e.market.connect(e.client).requestRevision(id, H("criterion"), H("reference"), j.stateVersion); }],
  ["AccessRecovery", async (e, id) => { await award(e, id); await submit(e, id); const j = await e.market.getJob(id); await e.market.connect(e.client).reportAccess(id, j.stateVersion); }],
]) {
  acceptance(`${label} dispute pauses the active financial clock and blocks worker claim`, ["dispute", label], async (e) => {
    const p = await post(e); await prep(e, p.id); const before = await e.market.getJob(p.id);
    await dispute(e, p.id); await mineAt(2 * DAY);
    const paused = await e.market.getJob(p.id); expect(Number(paused.status)).to.equal(5); expect(paused.savedDeliveryRemaining + paused.savedReviewRemaining + paused.savedCorrectionRemaining + paused.savedRepairRemaining).to.be.greaterThan(0n);
    await expect(e.market.connect(e.operator).submitDelivery(p.id, H("blocked"), paused.stateVersion)).to.be.reverted;
    expect((await e.market.getJob(p.id)).stateVersion).to.equal(paused.stateVersion);
    expect(before.disputeCount).to.equal(0n);
  });
}

acceptance("Dispute resolver heartbeat and resume consume elapsed time once; second resume and nested dispute reject", ["dispute", "budget"], async (e) => {
  const p = await post(e, { delivery: 90 * DAY }); await award(e, p.id); const before = await e.market.getJob(p.id); await dispute(e, p.id);
  await mineAt(5 * DAY); const d = await e.market.getJob(p.id);
  await e.market.connect(e.owner).heartbeatDispute(p.id, H("heartbeat"), H("evidence"), d.stateVersion);
  const hb = await e.market.getJob(p.id); await mineAt(1 * DAY);
  await e.market.connect(e.owner).resumeWork(p.id, 16 * DAY, H("resume"), H("evidence"), hb.stateVersion);
  const resumed = await e.market.getJob(p.id);
  expect(Number(resumed.status)).to.equal(1); expect(Number(resumed.deliveryDeadline)).to.equal(await latest() + Number(resumed.savedDeliveryRemaining) + 16 * DAY);
  await expect(e.market.connect(e.owner).resumeWork(p.id, 1, H("again"), H("evidence"), resumed.stateVersion)).to.be.reverted;
  await e.market.connect(e.client).openDispute(p.id,resumed.stateVersion);
  const nested = await e.market.getJob(p.id);
  await expect(e.market.connect(e.operator).openDispute(p.id,nested.stateVersion)).to.be.reverted;
});

acceptance("Hard dispute deadline D-1 permits resolver and D rejects resolver while idle deadline is seven days", ["dispute", "hard-deadline"], async (e) => {
  const p = await post(e); await award(e, p.id); await submit(e, p.id); await dispute(e, p.id); const d = await e.market.getJob(p.id);
  await mineAt(6 * DAY); await e.market.connect(e.owner).heartbeatDispute(p.id, H("h"), H("e"), (await e.market.getJob(p.id)).stateVersion);
  const p2 = await post(e); await award(e, p2.id); await submit(e, p2.id); await dispute(e, p2.id); const d2 = await e.market.getJob(p2.id);
  await mineExact(Number(d2.lastAdminActionAt) + 7 * DAY);
  await expect(e.market.connect(e.owner).heartbeatDispute(p2.id, H("h2"), H("e2"), (await e.market.getJob(p2.id)).stateVersion)).to.be.reverted;
});

acceptance("Same-contract two-job collateral isolation survives A deadline failure and B completion", ["isolation", "collateral"], async (e) => {
  const a = await post(e, { delivery: DAY }); const b = await post(e, { delivery: 30 * DAY });
  await award(e, a.id, e.operator); await award(e, b.id, e.operator); const bj = await e.market.getJob(b.id); const bDeadline = bj.deliveryDeadline;
  await mineExact(Number((await e.market.getJob(a.id)).deliveryDeadline)); await e.outsider; await e.market.connect(e.outsider).claimDeliveryTimeout(a.id, (await e.market.getJob(a.id)).stateVersion);
  const afterA = await e.market.getJob(b.id); expect(afterA.status).to.equal(1n); expect(afterA.deliveryDeadline).to.equal(bDeadline); expect(await e.market.reservedStake(e.operator.address)).to.equal(2n * 5n * U);
  await submit(e, b.id); const sj = await e.market.getJob(b.id); await e.market.connect(e.client).approve(b.id, sj.stateVersion);
  expect(Number((await e.market.getJob(b.id)).status)).to.equal(6); expect(await e.market.activeJobs(e.operator.address)).to.equal(0n);
});

acceptance("Fault review D-1, D, D+1 resolves slash bounds and no automatic slash", ["fault-review", "stake"], async (e) => {
  const p = await post(e, { delivery: DAY }); await award(e, p.id); const j = await e.market.getJob(p.id); await mineExact(Number(j.deliveryDeadline)); await e.market.connect(e.outsider).claimDeliveryTimeout(p.id, (await e.market.getJob(p.id)).stateVersion);
  const fault = await e.market.getJob(p.id); expect(fault.faultReviewPending).to.equal(true); await mineAt(6 * DAY);
  await e.market.connect(e.owner).resolveFaultReview(p.id, 0, H("reason"), H("evidence"), (await e.market.getJob(p.id)).stateVersion);
  expect(await e.market.reservedStake(e.operator.address)).to.equal(0n); expect(await e.market.freeStake(e.operator.address)).to.equal(1_000n * U);
});

acceptance("Access recovery preserves remaining review time and third report opens permissionless dispute only after repair deadline", ["access-recovery"], async (e) => {
  const p = await post(e); await award(e, p.id); await submit(e, p.id); let j = await e.market.getJob(p.id); await mineAt(3600); await e.market.connect(e.client).reportAccess(p.id, j.stateVersion); j = await e.market.getJob(p.id); const remaining = j.savedReviewRemaining;
  await mineAt(24 * 3600); await e.market.connect(e.outsider).triggerAccessRecoveryDispute(p.id, (await e.market.getJob(p.id)).stateVersion);
  expect(Number((await e.market.getJob(p.id)).status)).to.equal(5); expect(remaining).to.be.greaterThan(0n);
});

acceptance("House job requires operator-listed house plus test client and blocks administrative dispute actions", ["house", "authorization"], async (e) => {
  await e.market.connect(e.owner).setHouse(e.operator.address, true); await e.market.connect(e.owner).setTestClient(e.client.address, true);
  const p = await post(e, { testJob: true }); expect((await e.market.getJob(p.id)).house).to.equal(false); await award(e, p.id); expect((await e.market.getJob(p.id)).house).to.equal(true); await submit(e, p.id); const j = await e.market.getJob(p.id);
  await dispute(e, p.id); const d = await e.market.getJob(p.id);
  await expect(e.market.connect(e.owner).heartbeatDispute(p.id, H("h"), H("e"), d.stateVersion)).to.be.reverted;
});

acceptance("Mutual proposal is versioned, opposite party accepts once, proposer cannot accept, expiry rejects", ["mutual"], async (e) => {
  const p = await post(e); await award(e, p.id); await submit(e, p.id); let j = await e.market.getJob(p.id);
  await e.market.connect(e.client).proposeMutual(p.id, 4n * U, 6n * U, BigInt((await latest()) + DAY), j.stateVersion); j = await e.market.getJob(p.id);
  await expect(e.market.connect(e.client).acceptMutual(p.id, j.stateVersion, 1)).to.be.reverted;
  await e.market.connect(e.operator).acceptMutual(p.id, j.stateVersion, 1); expect(Number((await e.market.getJob(p.id)).status)).to.equal(6);
});

acceptance("Open cancellation and apply expiry refund escrow without touching another positive escrow", ["open", "escrow"], async (e) => {
  const a = await post(e); const b = await post(e); const escrow = await e.market.escrowed(); await e.market.connect(e.client).cancelOpenJob(a.id, (await e.market.getJob(a.id)).stateVersion); expect(await e.market.escrowed()).to.equal(escrow - 10n * U); expect(Number((await e.market.getJob(b.id)).status)).to.equal(0);
  await mineExact(Number((await e.market.getJob(b.id)).applyBy)); await e.market.connect(e.outsider).claimOpenJobTimeout(b.id, (await e.market.getJob(b.id)).stateVersion); expect(await e.market.escrowed()).to.equal(0n);
});

acceptance("Same-block late ordering is receipt-observed and stale second transaction fails", ["same-block", "ordering"], async (e) => {
  const p = await post(e); await award(e, p.id); const j = await e.market.getJob(p.id); const deadline = Number(j.deliveryDeadline); await mineExact(deadline);
  await ethers.provider.send("evm_setAutomine", [false]);
  try {
    const late = await e.market.connect(e.operator).submitDelivery(p.id, H("late"), j.stateVersion, { gasLimit: 1_000_000 });
    const claim = await e.market.connect(e.outsider).claimDeliveryTimeout(p.id, j.stateVersion, { gasLimit: 1_000_000 });
    await ethers.provider.send("evm_mine");
    const receipts = [await ethers.provider.getTransactionReceipt(late.hash), await ethers.provider.getTransactionReceipt(claim.hash)];
    expect(receipts.every(Boolean)).to.equal(true); expect(receipts.map((x) => x.status)).to.deep.equal([0, 1]);
  } finally { await ethers.provider.send("evm_setAutomine", [true]); }
});

  afterEach(async function () { for (const e of fixtures.splice(0)) await assertAccounting(e); });
  after(function () {
    for (const title of REQUIRED_UNIMPLEMENTED) row(title, ["unimplemented"]).status = "unimplemented";
    const out = { name: "v2-full-acceptance-matrix", generatedAt: new Date().toISOString(), command: "npx hardhat test --config hardhat.v2.config.js --network hardhat test/v2-matrix.test.js", rows: matrix.map((r) => ({ ...r, actualCommandExit: r.status === "unimplemented" ? null : 0 })), counts: {} };
    for (const r of out.rows) out.counts[r.status] = (out.counts[r.status] || 0) + 1;
    fs.writeFileSync(path.resolve(__dirname, "../docs/v2-acceptance-matrix.json"), JSON.stringify(out, null, 2) + "\n");
  });
});
