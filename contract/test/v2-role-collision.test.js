const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const {
  ROLE_NAMES, PATHS, deployRoleCollisionFixture, post, application, award, submit, accounting, advance, H, DAY,
} = require("./helpers/role-collision-fixture");

const pairs = [];
for (let i = 0; i < ROLE_NAMES.length; i++) for (let j = i + 1; j < ROLE_NAMES.length; j++) pairs.push([ROLE_NAMES[i], ROLE_NAMES[j]]);
const rows = [];
let definedCell = 0;
const fixtureFns = new Map();
const jsonSafe = (v) => JSON.parse(JSON.stringify(v, (_, x) => typeof x === "bigint" ? x.toString() : x));
function collides(pair, a, b) { return pair.includes(a) && pair.includes(b) && pair[0] !== pair[1]; }

// This policy is intentionally independent of observed contract results.
function approved(pair, lifecycle) {
  if (lifecycle === "post") return collides(pair, "client", "resolver") ? "revert:Conflict" : "allow";
  const postBlocked = collides(pair, "client", "resolver");
  const awardBlocked = postBlocked || collides(pair, "client", "operator") || collides(pair, "operator", "resolver") || collides(pair, "operator", "house");
  if (lifecycle === "award") return awardBlocked ? "revert:Conflict" : "allow";
  return awardBlocked ? "prerequisite-blocked" : "allow";
}
function errorName(err) {
  const text = String(err?.shortMessage || err?.reason || err?.message || err);
  const names = ["Conflict", "InvalidState", "Unauthorized", "InvalidSignature", "Deadline", "StaleVersion", "InvalidTerms", "InvalidDuration", "InsufficientFreeStake"];
  return names.find((n) => text.includes(n)) || text.split("\n")[0].slice(0, 240);
}
function hashOf(value) { return crypto.createHash("sha256").update(JSON.stringify(jsonSafe(value))).digest("hex"); }
async function attempt(label, fn) {
  try {
    const tx = await fn(); const receipt = tx?.wait ? await tx.wait() : tx?.receipt;
    if (!receipt) throw new Error(`${label} did not return a transaction receipt`);
    return { label, actual: "allow", txHash: receipt.hash, revertError: null };
  } catch (err) {
    return { label, actual: "revert", txHash: err?.receipt?.hash || err?.transactionHash || err?.transaction?.hash || null, revertError: errorName(err) };
  }
}
async function callPath(e, lifecycle) {
  let p;
  const gas = { gasLimit: 3_000_000 };
  const a = async (label, fn) => attempt(label, () => fn(gas));
  if (lifecycle === "post") return attempt("postJob", () => post(e, { gasLimit: gas.gasLimit }));
  const posted = await attempt("postJob", () => post(e, { gasLimit: gas.gasLimit }));
  if (posted.actual === "allow") p = posted;
  let id = 1;
  if (lifecycle === "award") return a("awardJob", async (o) => { const { value, sig } = await application(e, id); return e.market.connect(e.roles.client).awardJob(id, value, sig, o); });
  const awarded = await attempt("awardJob", () => award(e, id, gas));
  if (lifecycle === "dispute") return a("openDispute", async (o) => { const j = await e.market.getJob(id); const data = e.market.interface.encodeFunctionData("openDispute", [id, j.stateVersion]); return e.roles.client.sendTransaction({ to: await e.market.getAddress(), data, ...o }); });
  if (lifecycle === "resolve") {
    await attempt("openDispute", async () => { const j = await e.market.getJob(id); return e.market.connect(e.roles.client).openDispute(id, j.stateVersion, gas); });
    return a("resolveDispute", async (o) => { const j = await e.market.getJob(id); return e.market.connect(e.roles.resolver).resolveDispute(id, 0, false, H("reason"), H("evidence"), j.stateVersion, o); });
  }
  if (lifecycle === "recovery") {
    await attempt("submitDelivery", () => submit(e, id));
    await attempt("reportAccess", async () => { const j = await e.market.getJob(id); return e.market.connect(e.roles.client).reportAccess(id, j.stateVersion, gas); });
    await advance(DAY);
    return a("triggerAccessRecoveryDispute", async (o) => { const j = await e.market.getJob(id); return e.market.connect(e.outsider).triggerAccessRecoveryDispute(id, j.stateVersion, o); });
  }
  if (lifecycle === "fault-review") {
    const j = await e.market.getJob(id); const now = (await ethers.provider.getBlock("latest")).timestamp;
    if (Number(j.deliveryDeadline) > now) await advance(Number(j.deliveryDeadline) - now);
    await attempt("claimDeliveryTimeout", async () => { const x = await e.market.getJob(id); return e.market.connect(e.outsider).claimDeliveryTimeout(id, x.stateVersion, gas); });
    return a("resolveFaultReview", async (o) => { const x = await e.market.getJob(id); return e.market.connect(e.roles.resolver).resolveFaultReview(id, 0, H("reason"), H("evidence"), x.stateVersion, o); });
  }
  if (lifecycle === "mutual") {
    await attempt("submitDelivery", () => submit(e, id));
    await attempt("proposeMutual", async () => { const j = await e.market.getJob(id); return e.market.connect(e.roles.client).proposeMutual(id, 4n * 1_000_000n, 6n * 1_000_000n, BigInt((await ethers.provider.getBlock("latest")).timestamp + DAY), j.stateVersion, gas); });
    return a("acceptMutual", async (o) => { const j = await e.market.getJob(id); return e.market.connect(e.roles.operator).acceptMutual(id, j.stateVersion, 1, o); });
  }
  // timeout: a real delivery-deadline claim, not a synthetic expectation.
  const j = await e.market.getJob(id); const now = (await ethers.provider.getBlock("latest")).timestamp;
  if (Number(j.deliveryDeadline) > now) await advance(Number(j.deliveryDeadline) - now);
  return a("claimDeliveryTimeout", async (o) => { const x = await e.market.getJob(id); return e.market.connect(e.outsider).claimDeliveryTimeout(id, x.stateVersion, o); });
}

describe("V2 role-collision acceptance matrix (21 pairs x 8 real paths)", function () {
  this.timeout(450000);
  for (const pair of pairs) for (const lifecycle of PATHS) {
    const id = `R-${String(++definedCell).padStart(3, "0")}`;
    const expected = approved(pair, lifecycle);
    it(`${id} ${pair[0]}=${pair[1]} ${lifecycle}`, async function () {
      const key = pair.join("=");
      if (!fixtureFns.has(key)) fixtureFns.set(key, async function roleCollisionFixture() { return deployRoleCollisionFixture(pair); });
      const e = await loadFixture(fixtureFns.get(key));
      const before = await accounting(e);
      let result;
      try { result = await callPath(e, lifecycle); }
      catch (err) { result = { label: "harness-error", actual: "revert", txHash: null, revertError: errorName(err) }; }
      const after = await accounting(e);
      const expectAllow = expected === "allow";
      if (expectAllow) expect(result.actual, `${id} expected allow: ${result.revertError}`).to.equal("allow");
      else expect(result.actual, `${id} expected blocked/revert`).to.equal("revert");
      expect(after.free + after.reserved).to.equal(before.free + before.reserved);
      rows.push({ id, equalRoles: pair, lifecycle, expected, actual: result.actual, actualTxHash: result.txHash, revertError: result.revertError, testFullName: this.test.fullTitle(), accountingBefore: before, accountingAfter: after, status: (expectAllow === (result.actual === "allow")) ? "verifiedpass" : "verifiedfail" });
    });
  }
  after(function () {
    const sourceRoot = path.resolve(__dirname, "..");
    const sourceFiles = ["contracts/AgentMarketplaceV2.sol", "contracts/OperatorCollateralVaultV2.sol"].map((f) => [f, crypto.createHash("sha256").update(fs.readFileSync(path.join(sourceRoot, f))).digest("hex")]);
    const out = { name: "v2-role-collision-matrix", generatedAt: new Date().toISOString(), command: "npx hardhat test --no-compile --config hardhat.v2.config.js --network hardhat test/v2-role-collision.test.js", roles: ROLE_NAMES, paths: PATHS, pairCount: pairs.length, cellCount: rows.length, counts: rows.reduce((m, r) => (m[r.status] = (m[r.status] || 0) + 1, m), {}), sourceFiles, rows };
    fs.writeFileSync(path.join(sourceRoot, "docs/rolecollisionmatrix.json"), JSON.stringify(jsonSafe(out), null, 2) + "\n");
    fs.writeFileSync(path.join(sourceRoot, "docs/rolecollisionmatrix.md"), `# V2 role-collision matrix\n\nPair count: ${pairs.length}; lifecycle paths: ${PATHS.length}; cells: ${rows.length}.\n\nAll rows below were executed as independent Hardhat EVM transactions.\n\n| ID | Equal roles | Path | Expected | Actual | Status |\n|---|---|---|---|---|---|\n${rows.map((r) => `| ${r.id} | ${r.equalRoles.join(" = ")} | ${r.lifecycle} | ${r.expected} | ${r.actual}${r.revertError ? ` (${r.revertError})` : ""} | ${r.status} |`).join("\n")}\n`);
    if (rows.length !== 168 || rows.some((r) => r.status !== "verifiedpass")) throw new Error(`role collision ledger incomplete: ${rows.length} rows`);
  });
});
