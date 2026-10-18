const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const {
  ROLE_NAMES, PATHS, deployRoleCollisionFixture, post, application, award, submit, accounting, advance, DAY,
} = require("./helpers/role-collision-fixture");

const pairs = [];
for (let i = 0; i < ROLE_NAMES.length; i++) for (let j = i + 1; j < ROLE_NAMES.length; j++) pairs.push([ROLE_NAMES[i], ROLE_NAMES[j]]);
const rows = [];
const controls = [];
let definedCell = 0;
let definedControl = 0;
const jsonSafe = (v) => JSON.parse(JSON.stringify(v, (_, x) => typeof x === "bigint" ? x.toString() : x));
const collides = (pair, a, b) => pair.includes(a) && pair.includes(b);
const sourceRoot = path.resolve(__dirname, "..");
const fixtureFns = new Map();

function sourceHash(file) { return crypto.createHash("sha256").update(fs.readFileSync(path.join(sourceRoot, file))).digest("hex"); }
function errorSelector(market, name) { return market.interface.getError(name).selector; }
function revertData(err) { return err?.data || err?.error?.data || err?.info?.error?.data || null; }
function errorFromData(market, data) {
  if (!data || typeof data !== "string") return null;
  try { return market.interface.parseError(data)?.name || null; } catch (_) { return null; }
}

// Policy is derived from source guards, independently of observed results.
function rootBlock(pair, lifecycle, testJob) {
  if (collides(pair, "client", "resolver")) return "Conflict";
  if (lifecycle === "award" || lifecycle !== "post") {
    if (collides(pair, "client", "operator")) return "InvalidSignature";
    if (collides(pair, "operator", "resolver")) return "Conflict";
    if (collides(pair, "operator", "house") && !testJob) return "Conflict";
  }
  return null;
}
function pathTargetError(pair, lifecycle, testJob) {
  if ((lifecycle === "resolve" || lifecycle === "fault-review") && collides(pair, "operator", "house") && testJob) return "Unauthorized";
  return null;
}
function classify(pair, lifecycle, rootError) {
  if (!rootError) return { classification: "target-tested", targetCoverage: "tested", rootBlocked: false };
  if (lifecycle === "post" || lifecycle === "award") return { classification: "target-tested", targetCoverage: "tested", rootBlocked: true };
  if (collides(pair, "client", "resolver") || collides(pair, "client", "operator")) return { classification: "impossible-under-contract-invariants", targetCoverage: "impossible", rootBlocked: true };
  return { classification: "prerequisite-blocked", targetCoverage: "impossible", rootBlocked: true };
}
async function checkpoint(e, checkpoints) { checkpoints.push(await accounting(e)); }

async function allowStep(e, label, fn, checkpoints) {
  const tx = await fn();
  const receipt = tx?.wait ? await tx.wait() : tx;
  expect(receipt.status, `${label} must have a successful receipt`).to.equal(1);
  await checkpoint(e, checkpoints);
  return { label, actual: "allow", txHash: receipt.hash, revertError: null, revertData: null };
}

async function revertStep(e, label, fn, expectedError, checkpoints) {
  const outcome = await Promise.resolve().then(fn).then(
    () => ({ ok: true, error: null }),
    (error) => ({ ok: false, error }),
  );
  expect(outcome.ok, `${label} unexpectedly succeeded; expected ${expectedError}`).to.equal(false);
  const data = revertData(outcome.error);
  expect(data, `${label} did not return ABI revert data`).to.be.a("string");
  expect(data.slice(0, 10), `${label} selector`).to.equal(errorSelector(e.market, expectedError));
  expect(errorFromData(e.market, data), `${label} decoded error`).to.equal(expectedError);
  await expect(Promise.reject(outcome.error)).to.be.revertedWithCustomError(e.market, expectedError);
  await checkpoint(e, checkpoints);
  return { label, actual: "revert", txHash: outcome.error?.transactionHash || outcome.error?.transaction?.hash || null, revertError: expectedError, revertData: data };
}

async function executeCell(e, pair, lifecycle, testJob, checkpoints) {
  const rootError = rootBlock(pair, lifecycle, testJob);
  const events = [];
  if (lifecycle === "post") {
    if (rootError) events.push(await revertStep(e, "postJob", () => post(e, { testJob, gasLimit: 3_000_000 }), rootError, checkpoints));
    else {
      const p = await post(e, { testJob, gasLimit: 3_000_000 });
      await checkpoint(e, checkpoints);
      events.push({ label: "postJob", actual: "allow", txHash: p.receipt.hash, revertError: null, revertData: null });
    }
    return { events, rootError };
  }
  if (rootError) {
    // Prove the real prerequisite failure; never invoke a downstream method on
    // an uninitialized job or bypass storage to manufacture one.
    if (rootError === "Conflict" && collides(pair, "client", "resolver")) {
      events.push(await revertStep(e, "postJob(root-proof)", () => post(e, { testJob, gasLimit: 3_000_000 }), rootError, checkpoints));
    } else {
      const p = await post(e, { testJob, gasLimit: 3_000_000 });
      await checkpoint(e, checkpoints);
      events.push({ label: "postJob(root-proof)", actual: "allow", txHash: p.receipt.hash, revertError: null, revertData: null });
      events.push(await revertStep(e, "awardJob(root-proof)", async () => {
        const a = await application(e, 1);
        return e.market.connect(e.roles.client).awardJob(1, a.value, a.sig, { gasLimit: 3_000_000 });
      }, rootError, checkpoints));
    }
    return { events, rootError };
  }

  const p = await post(e, { testJob, gasLimit: 3_000_000 });
  await checkpoint(e, checkpoints);
  events.push({ label: "postJob", actual: "allow", txHash: p.receipt.hash, revertError: null, revertData: null });
  const awardError = rootBlock(pair, "award", testJob);
  if (awardError) {
    events.push(await revertStep(e, "awardJob", async () => { const a = await application(e, 1); return e.market.connect(e.roles.client).awardJob(1, a.value, a.sig, { gasLimit: 3_000_000 }); }, awardError, checkpoints));
    return { events, rootError: awardError };
  }
  events.push(await allowStep(e, "awardJob", () => award(e, 1, { gasLimit: 3_000_000 }), checkpoints));
  if (lifecycle === "award") return { events, rootError: null };

  if (lifecycle === "dispute") {
    events.push(await allowStep(e, "openDispute", async () => { const j = await e.market.getJob(1); return e.market.connect(e.roles.client).openDispute(1, j.stateVersion, { gasLimit: 3_000_000 }); }, checkpoints));
  } else if (lifecycle === "resolve") {
    events.push(await allowStep(e, "openDispute", async () => { const j = await e.market.getJob(1); return e.market.connect(e.roles.client).openDispute(1, j.stateVersion, { gasLimit: 3_000_000 }); }, checkpoints));
    const targetError = pathTargetError(pair, lifecycle, testJob);
    const fn = async () => { const j = await e.market.getJob(1); return e.market.connect(e.roles.resolver).resolveDispute(1, 0, false, ethers.keccak256(ethers.toUtf8Bytes("reason")), ethers.keccak256(ethers.toUtf8Bytes("evidence")), j.stateVersion, { gasLimit: 3_000_000 }); };
    events.push(targetError ? await revertStep(e, "resolveDispute", fn, targetError, checkpoints) : await allowStep(e, "resolveDispute", fn, checkpoints));
  } else if (lifecycle === "recovery") {
    events.push(await allowStep(e, "submitDelivery", () => submit(e, 1), checkpoints));
    events.push(await allowStep(e, "reportAccess", async () => { const j = await e.market.getJob(1); return e.market.connect(e.roles.client).reportAccess(1, j.stateVersion, { gasLimit: 3_000_000 }); }, checkpoints));
    await advance(DAY);
    events.push(await allowStep(e, "triggerAccessRecoveryDispute", async () => { const j = await e.market.getJob(1); return e.market.connect(e.outsider).triggerAccessRecoveryDispute(1, j.stateVersion, { gasLimit: 3_000_000 }); }, checkpoints));
  } else if (lifecycle === "fault-review") {
    const j = await e.market.getJob(1); const now = (await ethers.provider.getBlock("latest")).timestamp;
    if (Number(j.deliveryDeadline) > now) await advance(Number(j.deliveryDeadline) - now);
    events.push(await allowStep(e, "claimDeliveryTimeout", async () => { const x = await e.market.getJob(1); return e.market.connect(e.outsider).claimDeliveryTimeout(1, x.stateVersion, { gasLimit: 3_000_000 }); }, checkpoints));
    const targetError = pathTargetError(pair, lifecycle, testJob);
    const fn = async () => { const x = await e.market.getJob(1); return e.market.connect(e.roles.resolver).resolveFaultReview(1, 0, ethers.keccak256(ethers.toUtf8Bytes("reason")), ethers.keccak256(ethers.toUtf8Bytes("evidence")), x.stateVersion, { gasLimit: 3_000_000 }); };
    events.push(targetError ? await revertStep(e, "resolveFaultReview", fn, targetError, checkpoints) : await allowStep(e, "resolveFaultReview", fn, checkpoints));
  } else if (lifecycle === "mutual") {
    events.push(await allowStep(e, "submitDelivery", () => submit(e, 1), checkpoints));
    events.push(await allowStep(e, "proposeMutual", async () => { const j = await e.market.getJob(1); return e.market.connect(e.roles.client).proposeMutual(1, 4_000_000n, 6_000_000n, BigInt((await ethers.provider.getBlock("latest")).timestamp + DAY), j.stateVersion, { gasLimit: 3_000_000 }); }, checkpoints));
    events.push(await allowStep(e, "acceptMutual", async () => { const j = await e.market.getJob(1); return e.market.connect(e.roles.operator).acceptMutual(1, j.stateVersion, 1, { gasLimit: 3_000_000 }); }, checkpoints));
  } else if (lifecycle === "timeout") {
    const j = await e.market.getJob(1); const now = (await ethers.provider.getBlock("latest")).timestamp;
    if (Number(j.deliveryDeadline) > now) await advance(Number(j.deliveryDeadline) - now);
    events.push(await allowStep(e, "claimDeliveryTimeout", async () => { const x = await e.market.getJob(1); return e.market.connect(e.outsider).claimDeliveryTimeout(1, x.stateVersion, { gasLimit: 3_000_000 }); }, checkpoints));
  }
  return { events, rootError: null };
}

async function runRow(pair, lifecycle, options, ledger) {
  const fixtureKey = `${pair.join("=")}|${options.testJob === true}|${options.allowClientTestJob === true}`;
  if (!fixtureFns.has(fixtureKey)) fixtureFns.set(fixtureKey, async function roleCollisionFixture() { return deployRoleCollisionFixture(pair, options); });
  const e = await loadFixture(fixtureFns.get(fixtureKey));
  const before = await accounting(e);
  const checkpoints = [];
  const result = await executeCell(e, pair, lifecycle, options.testJob === true, checkpoints);
  const after = await accounting(e);
  const target = result.events[result.events.length - 1];
  const expected = result.rootError ? `revert:${result.rootError}` : (target.actual === "revert" ? `revert:${target.revertError}` : "allow");
  expect(target.actual, `${pair.join("=")} ${lifecycle} expected ${expected}`).to.equal(expected === "allow" ? "allow" : "revert");
  ledger.push({ id: options.control ? `C-${String(++definedControl).padStart(3, "0")}` : `R-${String(++definedCell).padStart(3, "0")}`, equalRoles: pair, lifecycle, variant: options.control ? options.label : "normal-job", testJob: options.testJob === true, flags: { listedHouse: true, testClient: true, clientTestClient: options.allowClientTestJob === true }, expected, actual: target.actual, expectedError: target.revertError, actualError: target.revertError, actualRevertSelector: target.revertData ? target.revertData.slice(0, 10) : null, ...classify(pair, lifecycle, result.rootError), targetEvents: result.events, accountingBefore: before, accountingAfter: after, accountingCheckpoints: checkpoints, status: "verifiedpass" });
}

describe("V2 role-collision acceptance matrix (21 pairs x 8 real paths)", function () {
  this.timeout(900000);
  for (const pair of pairs) for (const lifecycle of PATHS) it(`${pair[0]}=${pair[1]} ${lifecycle}`, async function () { await runRow(pair, lifecycle, { testJob: false }, rows); });
  for (const lifecycle of PATHS) it(`control client=testClient testJob ${lifecycle}`, async function () { await runRow(["client", "testClient"], lifecycle, { testJob: true, allowClientTestJob: true, control: true, label: "approved-testJob" }, controls); });
  for (const lifecycle of ["award", "dispute", "resolve", "recovery", "fault-review", "mutual", "timeout"]) it(`control operator=house approved testJob ${lifecycle}`, async function () { await runRow(["operator", "house"], lifecycle, { testJob: true, allowClientTestJob: true, control: true, label: "listed-house-approved-testJob" }, controls); });

  after(function () {
    const sourceFiles = ["contracts/AgentMarketplaceV2.sol", "contracts/OperatorCollateralVaultV2.sol"].map((f) => [f, sourceHash(f)]);
    const counts = rows.reduce((m, r) => (m[r.classification] = (m[r.classification] || 0) + 1, m), {});
    const controlCounts = controls.reduce((m, r) => (m[r.classification] = (m[r.classification] || 0) + 1, m), {});
    const out = { name: "v2-role-collision-matrix", generatedAt: new Date().toISOString(), command: "npx hardhat test --no-compile --config hardhat.v2.config.js --network hardhat test/v2-role-collision.test.js", roles: ROLE_NAMES, paths: PATHS, pairCount: pairs.length, cellCount: rows.length, expectedCellCount: 168, counts, controlCount: controls.length, controlCounts, sourceFiles, unexpectedAllows: rows.filter((r) => r.expected !== "allow" && r.actual === "allow").map((r) => r.id), rows, controls };
    fs.writeFileSync(path.join(sourceRoot, "docs/rolecollisionmatrix.json"), JSON.stringify(jsonSafe(out), null, 2) + "\n");
    const md = ["# V2 role-collision matrix", "", `Pair count: ${pairs.length}; lifecycle paths: ${PATHS.length}; base cells: ${rows.length}; expected base cells: 168.`, `Controls: ${controls.length}. Source hashes are recorded in the JSON evidence.`, "", `Exclusive classifications: ${JSON.stringify(counts)}. Controls: ${JSON.stringify(controlCounts)}.`, "", "Rows are actual Hardhat EVM outcomes. `prerequisite-blocked` records a real root proof and does not call an uninitialized downstream path; `impossible-under-contract-invariants` records collisions whose root guard makes the target unreachable. `target-tested` means the named target transaction was executed and either succeeded or matched its exact custom error.", "", "| ID | Equal roles | Path | Variant | Expected | Actual | Classification | Error | Status |", "|---|---|---|---|---|---|---|---|---|", ...rows.concat(controls).map((r) => `| ${r.id} | ${r.equalRoles.join(" = ")} | ${r.lifecycle} | ${r.variant} | ${r.expected} | ${r.actual} | ${r.classification} | ${r.actualError || ""} | ${r.status} |`), ""].join("\n");
    fs.writeFileSync(path.join(sourceRoot, "docs/rolecollisionmatrix.md"), md.trimEnd() + "\n");
    if (rows.length !== 168 || rows.some((r) => r.status !== "verifiedpass") || controls.some((r) => r.status !== "verifiedpass")) throw new Error(`role collision ledger incomplete: base=${rows.length}, controls=${controls.length}`);
  });
});
