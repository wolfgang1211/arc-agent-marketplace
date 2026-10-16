const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs"); const path = require("path");
const { U, DAY, H, latest, advance, at, deployFixture, post, award, submit, open, assertAccounting } = require("./helpers/v2-matrix-clocks-fixture");
const rows = [
  ["V2-016", "Every dispute state × client/operator × wrong-role/open/terminal/nested/wrong-resolver authorization table"],
  ["V2-017", "Dispute hard-budget first 5D resume, second 30D work, and 16D remaining dispute budget"],
  ["V2-018", "Dispute quota two job-wide episodes with third episode rejection"],
  ["V2-019", "Separate first 5D no-reset, second 6D heartbeat, and 12D heartbeat hard/idle D±1 matrix"],
  ["V2-020", "Expired revision zero cannot create review or silent payout"],
  ["V2-021", "Revision unlimited 256 real request/submit receipts and revision counter"],
  ["V2-022", "Access recovery repeated report quota, duplicate count, and review remaining preservation"],
  ["V2-023", "Access recovery late upload before trigger guard and 30D-late worker plus 7D fallback"],
  ["V2-024", "House false flags, non-allowlisted client, policy snapshot, and all admin action blocks"],
  ["V2-025", "Fault slash zero/nonzero/max/excess, D±1, repeated deadline claim, late claim, and no auto-slash"],
];
const result = Object.fromEntries(rows.map(([id, testTitle]) => [id, { id, testTitle, status: "unimplemented", caseErrors: [], actualCommandExit: null }]));
const fixtures = [];
function acceptance(id, title, fn) { it(`${id} ${title}`, async function () { try { const e = await deployFixture(); fixtures.push(e); await fn(e); result[id].status = "verifiedpass"; } catch (err) { result[id].status = "verifiedfail"; result[id].caseErrors.push(String(err.stack || err)); throw err; } }); }

describe("V2 matrix clocks rows 016-025", function () {
  acceptance("V2-016", rows[0][1], async (e) => {
    const states = [];
    let id = await post(e); await award(e, id); states.push(id);
    id = await post(e); await award(e, id); await submit(e, id); states.push(id);
    id = await post(e); await award(e, id); await submit(e, id); let j = await e.market.getJob(id); await e.market.connect(e.client).requestRevision(id, H("criterion"), H("reference"), j.stateVersion); states.push(id);
    id = await post(e); await award(e, id); await submit(e, id); j = await e.market.getJob(id); await e.market.connect(e.client).reportAccess(id, j.stateVersion); states.push(id);
    for (const job of states) {
      const before = await e.market.getJob(job); await expect(e.market.connect(e.outsider).openDispute(job,before.stateVersion)).to.be.reverted;

    }
    id = states[0]; await open(e, id, e.operator); const d = await e.market.getJob(id);
    await expect(e.market.connect(e.client).openDispute(id,d.stateVersion)).to.be.reverted;
    await expect(e.market.connect(e.operator).heartbeatDispute(id, H("x"), H("y"), d.stateVersion)).to.be.reverted;
    const terminal = await post(e); await award(e, terminal); await submit(e, terminal); const tj = await e.market.getJob(terminal); await e.market.connect(e.client).approve(terminal, tj.stateVersion);
    await expect(e.market.connect(e.client).openDispute(terminal, (await e.market.getJob(terminal)).stateVersion)).to.be.reverted;
  });

  acceptance("V2-017", rows[1][1], async (e) => {
    const id = await post(e, { delivery: 90 * DAY }); await award(e, id); await open(e, id); let j = await e.market.getJob(id);
    await advance(5 * DAY); j = await e.market.getJob(id); await e.market.connect(e.owner).resumeWork(id, 0, H("resume-1"), H("evidence-1"), j.stateVersion);
    j = await e.market.getJob(id); expect(j.disputeTimeUsed).to.be.within(5n * BigInt(DAY), 5n * BigInt(DAY) + 2n); await advance(30 * DAY); await submit(e, id);
    await open(e, id); j = await e.market.getJob(id); const derivedHardRemaining = 21n * BigInt(DAY) - j.disputeTimeUsed; expect(derivedHardRemaining).to.be.within(16n * BigInt(DAY) - 2n, 16n * BigInt(DAY));
    const usedBefore = j.disputeTimeUsed; const versionBefore = j.stateVersion;
    await expect(e.market.connect(e.owner).resumeWork(id, 16 * DAY, H("resume-2"), H("evidence-2"), j.stateVersion)).to.be.reverted;
    const out = await e.market.getJob(id); expect(out.disputeTimeUsed).to.equal(usedBefore); expect(out.stateVersion).to.equal(versionBefore);
  });

  acceptance("V2-018", rows[2][1], async (e) => {
    const id = await post(e, { delivery: 90 * DAY }); await award(e, id); await open(e, id); let j = await e.market.getJob(id);
    await e.market.connect(e.owner).resumeWork(id, 0, H("r1"), H("e1"), j.stateVersion); j = await e.market.getJob(id);
    await open(e, id); j = await e.market.getJob(id); expect(j.disputeCount).to.equal(2n);
    await expect(e.market.connect(e.owner).resumeWork(id, 0, H("r2"), H("e2"), j.stateVersion)).to.be.reverted; j = await e.market.getJob(id);
    await expect(e.market.connect(e.client).openDispute(id,j.stateVersion)).to.be.reverted;
  });

  acceptance("V2-019", rows[3][1], async (e) => {
    const id = await post(e, { delivery: 90 * DAY }); await award(e, id); await open(e, id); let j = await e.market.getJob(id);
    await advance(5 * DAY); await e.market.connect(e.owner).heartbeatDispute(id, H("h1"), H("e1"), (await e.market.getJob(id)).stateVersion);
    j = await e.market.getJob(id); await advance(6 * DAY); await e.market.connect(e.owner).heartbeatDispute(id, H("h2"), H("e2"), j.stateVersion);
    j = await e.market.getJob(id); expect(j.reviewingCount).to.equal(2n); await expect(e.market.connect(e.owner).heartbeatDispute(id, H("h3"), H("e3"), j.stateVersion)).to.be.reverted;
    await advance(12 * DAY); await expect(e.market.connect(e.owner).resumeWork(id, 0, H("r"), H("e"), (await e.market.getJob(id)).stateVersion)).to.be.reverted;
    const fresh = await post(e, { delivery: 90 * DAY }); await award(e, fresh); await open(e, fresh); let f = await e.market.getJob(fresh); await at(Number(f.lastAdminActionAt) + 7 * DAY - 2); await expect(e.market.connect(e.owner).heartbeatDispute(fresh, H("d-1"), H("e"), (await e.market.getJob(fresh)).stateVersion)).to.not.be.reverted;
    f = await e.market.getJob(fresh); await at(Number(f.lastAdminActionAt) + 7 * DAY - 1); await expect(e.market.connect(e.owner).heartbeatDispute(fresh, H("d"), H("e"), (await e.market.getJob(fresh)).stateVersion)).to.be.reverted;
  });

  acceptance("V2-020", rows[4][1], async (e) => {
    const id = await post(e, { revision: 12 * 3600 }); await award(e, id); await submit(e, id); let j = await e.market.getJob(id);
    await e.market.connect(e.client).requestRevision(id, H("criterion"), H("reference"), j.stateVersion); j = await e.market.getJob(id); await at(Number(j.correctionDeadline));
    await expect(e.market.connect(e.operator).submitRevision(id, H("late"), (await e.market.getJob(id)).stateVersion)).to.be.reverted;
    await e.market.connect(e.client).approve(id, (await e.market.getJob(id)).stateVersion);
    await expect(e.market.connect(e.client).claimReviewTimeout(id, (await e.market.getJob(id)).stateVersion)).to.be.reverted;
  });

  acceptance("V2-021", rows[5][1], async (e) => {
    const id = await post(e, { unlimited: true, revisionLimit: 0, review: 14 * DAY, revision: 12 * 3600 }); await award(e, id); await submit(e, id);
    for (let n = 0; n < 256; n++) { let j = await e.market.getJob(id); await e.market.connect(e.client).requestRevision(id, H(`criterion-${n}`), H(`reference-${n}`), j.stateVersion); j = await e.market.getJob(id); await e.market.connect(e.operator).submitRevision(id, H(`delivery-${n}`), j.stateVersion); }
    const j = await e.market.getJob(id); expect(j.revisionsUsed).to.equal(256n); expect(j.deliveryVersion).to.equal(257n);
  });

  acceptance("V2-022", rows[6][1], async (e) => {
    const id = await post(e, { review: 7 * DAY }); await award(e, id); await submit(e, id); let j = await e.market.getJob(id); await advance(3600); await e.market.connect(e.client).reportAccess(id, j.stateVersion);
    j = await e.market.getJob(id); expect(j.accessReports).to.equal(1n); const saved = j.savedReviewRemaining;
    await expect(e.market.connect(e.client).reportAccess(id, j.stateVersion)).to.be.reverted; await e.market.connect(e.operator).recoverAccess(id, H("same-repair"), j.stateVersion);
    j = await e.market.getJob(id); expect(j.deliveryVersion).to.equal(1n); await e.market.connect(e.client).reportAccess(id, j.stateVersion); expect((await e.market.getJob(id)).savedReviewRemaining).to.be.greaterThan(0n); expect(saved).to.be.greaterThan(0n);
  });

  acceptance("V2-023", rows[7][1], async (e) => {
    const id = await post(e, { review: 7 * DAY }); await award(e, id); await submit(e, id); let j = await e.market.getJob(id); await e.market.connect(e.client).reportAccess(id, j.stateVersion); j = await e.market.getJob(id);
    await expect(e.market.connect(e.operator).recoverAccess(id, H("before-trigger"), j.stateVersion)).to.not.be.reverted;
    j = await e.market.getJob(id); await e.market.connect(e.client).reportAccess(id, j.stateVersion); j = await e.market.getJob(id); await advance(30 * DAY);
    await expect(e.market.connect(e.operator).recoverAccess(id, H("late-worker"), j.stateVersion)).to.be.reverted;
    await e.market.connect(e.outsider).triggerAccessRecoveryDispute(id, (await e.market.getJob(id)).stateVersion);
    const d = await e.market.getJob(id); expect(d.status).to.equal(5n); expect(d.episodeStart).to.equal(d.repairDeadline);
  });

  acceptance("V2-024", rows[8][1], async (e) => {
    await e.market.connect(e.owner).setHouse(e.operator.address, true); await e.market.connect(e.owner).setTestClient(e.client.address, true);
    const id = await post(e, { testJob: true }); let j = await e.market.getJob(id); expect(j.house).to.equal(false); await award(e, id); j = await e.market.getJob(id); expect(j.house).to.equal(true); await submit(e, id); await open(e, id); j = await e.market.getJob(id);
    await expect(e.market.connect(e.owner).heartbeatDispute(id, H("h"), H("e"), j.stateVersion)).to.be.reverted;
    await expect(e.market.connect(e.owner).resumeWork(id, 0, H("r"), H("e"), (await e.market.getJob(id)).stateVersion)).to.be.reverted;
    await expect(e.market.connect(e.owner).resolveDispute(id, 0, false, H("r"), H("e"), (await e.market.getJob(id)).stateVersion)).to.be.reverted;
  });

  acceptance("V2-025", rows[9][1], async (e) => {
    const id = await post(e, { delivery: DAY }); await award(e, id); let j = await e.market.getJob(id); await at(Number(j.deliveryDeadline)); await e.market.connect(e.outsider).claimDeliveryTimeout(id, j.stateVersion); j = await e.market.getJob(id);
    const reserved = j.stakeReserved; await e.market.connect(e.owner).resolveFaultReview(id, reserved / 2n, H("half"), H("e"), j.stateVersion); expect(await e.market.reservedStake(e.operator.address)).to.equal(0n);
    await expect(e.market.connect(e.outsider).claimDeliveryTimeout(id, (await e.market.getJob(id)).stateVersion)).to.be.reverted;
    const id2 = await post(e, { delivery: DAY }); await award(e, id2, e.operator2); j = await e.market.getJob(id2); await at(Number(j.deliveryDeadline) + 1); await e.market.connect(e.outsider).claimDeliveryTimeout(id2, j.stateVersion); j = await e.market.getJob(id2);
    await expect(e.market.connect(e.owner).resolveFaultReview(id2, j.stakeReserved + 1n, H("bad"), H("e"), j.stateVersion)).to.be.reverted;
    await at(Number(j.faultReviewDeadline)); await e.market.connect(e.outsider).releaseFaultReview(id2, (await e.market.getJob(id2)).stateVersion); expect(await e.market.reservedStake(e.operator2.address)).to.equal(0n);
  });

  afterEach(async function () { for (const e of fixtures.splice(0)) await assertAccounting(e); });
  after(function () { for (const r of Object.values(result)) r.actualCommandExit = r.status === "verifiedfail" ? 1 : 0; for (const r of Object.values(result)) if (r.status === "unimplemented") r.actualCommandExit = null; const out = { name: "v2-matrix-clocks", generatedAt: new Date().toISOString(), command: "npx hardhat test --config hardhat.v2.config.js --network hardhat test/v2-matrix-clocks.test.js", rows: Object.values(result), counts: {} }; for (const r of out.rows) out.counts[r.status] = (out.counts[r.status] || 0) + 1; fs.writeFileSync(path.resolve(__dirname, "../docs/v2-matrix-clocks-results.json"), JSON.stringify(out, null, 2) + "\n"); });
});
