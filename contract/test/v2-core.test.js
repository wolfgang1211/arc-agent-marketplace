const { expect } = require("chai");
const { ethers } = require("hardhat");
const { wrapMarket } = require("./helpers/v2-read-model");
const { deployV2Pair } = require("./helpers/deploy-v2-pair");

const U = 1_000_000n;
const H = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
const DOMAIN = { name: "AlphaBoard Agent Marketplace V2", version: "1" };
const TYPES = { Application: [
  { name: "jobId", type: "uint256" }, { name: "operator", type: "address" },
  { name: "termsHash", type: "bytes32" }, { name: "validAfter", type: "uint64" },
  { name: "validBefore", type: "uint64" }, { name: "nonceEpoch", type: "uint256" },
  { name: "operatorNonce", type: "uint256" },
] };
const fixtures = [];

async function deploy() {
  const [owner, client, op1, op2, treasury] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("MockUSDC");
  const token = await Token.deploy();
  const pair = await deployV2Pair({ token, owner, treasury });
  const market = wrapMarket(pair.market); const vault = pair.vault;
  for (const s of [owner, client, op1, op2, treasury]) await token.mint(s.address, 1_000n * U);
  const env = { owner, client, op1, op2, treasury, token, market, vault }; fixtures.push(env); return env;
}
async function post(e, reward = 10n * U, apply = 2 * 86400, delivery = 2 * 86400) {
  const { client, market, token } = e;
  await token.connect(client).approve(await market.getAddress(), reward);
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  const id = await market.nextJobId();
  await market.connect(client).postJob(reward, now + apply, delivery, 24 * 3600, 12 * 3600, 2, false, H("criteria"), H("description"), false);
  return market.getJob(id);
}
async function application(e, signer, job, id = 1n, overrides = {}) {
  if (typeof id === "object") { overrides = id; id = 1n; }
  const net = await ethers.provider.getNetwork();
  const termsHash = overrides.termsHash ?? job.canonicalTermsHash;
  const validBefore = overrides.validBefore ?? BigInt(job.applyBy);
  const value = { jobId: BigInt(id), operator: signer.address, termsHash, validAfter: overrides.validAfter ?? 0, validBefore, nonceEpoch: overrides.nonceEpoch ?? await e.market.nonceEpoch(signer.address), operatorNonce: overrides.operatorNonce ?? await e.market.applicationNonce(id, signer.address) };
  return { value, sig: await signer.signTypedData({ ...DOMAIN, chainId: net.chainId, verifyingContract: await e.market.getAddress() }, TYPES, value) };
}

async function registerAndStake(e, signer, amount = 100n * U) {
  await e.token.connect(signer).approve(e.vault, amount);
  await e.vault.connect(signer).depositStake(amount);
  await e.market.connect(signer).registerOperator();
}
async function atNextBlock(secondsFromLatest) {
  const latest = (await ethers.provider.getBlock("latest")).timestamp;
  await ethers.provider.send("evm_setNextBlockTimestamp", [latest + secondsFromLatest]);
}

function conservation(e) {
  return Promise.all([e.token.balanceOf(e.market), e.market.escrowed(), e.market.liabilities(), e.market.surplus()]).then(([b, esc, liab, surplus]) => expect(b).to.equal(esc + liab + surplus));
}

async function fullConservation(e) {
  let free = 0n, reserved = 0n, credits = 0n, escrow = 0n;
  for (const s of [e.op1, e.op2, e.owner, e.client, e.treasury]) { free += await e.market.freeStake(s.address); reserved += await e.market.reservedStake(s.address); credits += await e.market.credits(s.address); }
  const n = Number(await e.market.nextJobId());
  for (let id = 1; id < n; id++) { const j = await e.market.getJob(id); if (Number(j.status) <= 5) escrow += j.reward; }
  expect(free + reserved).to.equal(await e.market.stakeLiability());
  expect(credits).to.equal(await e.market.creditsLiability());
  expect(escrow).to.equal(await e.market.escrowed());
  await conservation(e);
}

describe("AgentMarketplaceV2 Stage A core", function () {
  afterEach(async function () { for (const e of fixtures.splice(0)) await fullConservation(e); });
  it("requires explicit self-registration before stake-backed award", async function () {
    const e = await deploy(); const job = await post(e);
    await e.token.connect(e.op1).approve(e.vault, 10n * U); await e.vault.connect(e.op1).depositStake(10n * U);
    const signed = await application(e, e.op1, job);
    await expect(e.market.connect(e.client).awardJob(1, signed.value, signed.sig)).to.be.reverted;
    await expect(e.market.connect(e.op1).registerOperator()).to.emit(e.market, "OperatorRegistered");
    await expect(e.market.connect(e.client).awardJob(1, signed.value, signed.sig)).to.not.be.reverted;
    expect(await e.market.registered(e.op1.address)).to.equal(true);
  });

  it("binds the canonical immutable terms hash and starts delivery at award", async function () {
    const e = await deploy(); const job = await post(e);
    expect(job.deliveryDeadline).to.equal(0n);
    expect(job.canonicalTermsHash).to.not.equal(ethers.ZeroHash);
    await e.token.connect(e.op1).approve(e.vault, 10n * U); await e.vault.connect(e.op1).depositStake(10n * U);
    await e.market.connect(e.op1).registerOperator();
    const bad = await application(e, e.op1, job, { termsHash: H("forged") });
    await expect(e.market.connect(e.client).awardJob(1, bad.value, bad.sig)).to.be.reverted;
    const good = await application(e, e.op1, job);
    await e.market.connect(e.client).awardJob(1, good.value, good.sig);
    const awarded = await e.market.getJob(1);
    expect(awarded.deliveryDeadline).to.be.greaterThan(0n);
    expect(awarded.deliveryDeadline).to.be.greaterThan(awarded.createdAt);
    await conservation(e);
  });

  it("isolates invalidateAll and revoke to the signing operator", async function () {
    const e = await deploy(); const job = await post(e);
    await e.token.connect(e.op1).approve(e.vault, 10n * U); await e.vault.connect(e.op1).depositStake(10n * U);
    await e.token.connect(e.op2).approve(e.vault, 10n * U); await e.vault.connect(e.op2).depositStake(10n * U);
    await e.market.connect(e.op1).registerOperator(); await e.market.connect(e.op2).registerOperator();
    const a1 = await application(e, e.op1, job); const a2 = await application(e, e.op2, job);
    await e.market.connect(e.op1).invalidateAllApplications();
    await expect(e.market.connect(e.client).awardJob(1, a2.value, a2.sig)).to.not.be.reverted;
    await e.market.connect(e.op1).revokeApplication(1);
    expect(await e.market.applicationNonce(1, e.op1.address)).to.equal(1n);
    await expect(e.market.connect(e.client).awardJob(1, a1.value, a1.sig)).to.be.reverted;
  });

  it("uses per-operator concurrency, snapshots fee and treasury, and excludes escrow from liabilities", async function () {
    const e = await deploy(); await e.market.connect(e.op1).setMaxActiveJobs(1);
    await e.token.connect(e.op1).approve(e.vault, 100n * U); await e.vault.connect(e.op1).depositStake(100n * U);
    await e.market.connect(e.op1).registerOperator();
    const j1 = await post(e); const a1 = await application(e, e.op1, j1);
    await e.market.connect(e.client).awardJob(1, a1.value, a1.sig);
    expect(await e.market.maxActiveJobs(e.op1.address)).to.equal(1n);
    await expect(e.market.connect(e.op1).setMaxActiveJobs(0)).to.not.be.reverted;
    await conservation(e);
  });

  it("rejects uint128 reward overflow", async function () {
    const e = await deploy();
    await expect(post(e, (1n << 128n))).to.be.reverted;
  });

  it("covers applyBy minimum/exact/maximum boundaries", async function () {
    const e = await deploy();
    for (const [label, value, valid] of [["min-1", 3600 - 1, false], ["min", 3600, true], ["max", 30 * 86400, true], ["max+1", 30 * 86400 + 1, false]]) {
      await e.token.connect(e.client).approve(e.market, U);
      const now = (await ethers.provider.getBlock("latest")).timestamp; await atNextBlock(1);
      const tx = e.market.connect(e.client).postJob(U, now + 1 + value, 3600, 24 * 3600, 12 * 3600, 0, false, H(label), H(label), false);
      if (valid) await expect(tx, label).to.not.be.reverted; else await expect(tx, label).to.be.reverted;
    }
  });

  it("covers delivery duration minimum/exact/maximum boundaries", async function () {
    const e = await deploy();
    for (const [label, value, valid] of [["min-1", 3600 - 1, false], ["min", 3600, true], ["max", 90 * 86400, true], ["max+1", 90 * 86400 + 1, false]]) {
      const now = (await ethers.provider.getBlock("latest")).timestamp;
      await e.token.connect(e.client).approve(e.market, U);
      const tx = e.market.connect(e.client).postJob(U, now + 2 * 86400, value, 24 * 3600, 12 * 3600, 0, false, H(label), H(label), false);
      if (valid) await expect(tx, label).to.not.be.reverted; else await expect(tx, label).to.be.reverted;
    }
  });

  it("covers review duration minimum/exact/maximum boundaries", async function () {
    const e = await deploy();
    for (const [label, value, valid] of [["min-1", 24 * 3600 - 1, false], ["min", 24 * 3600, true], ["max", 14 * 86400, true], ["max+1", 14 * 86400 + 1, false]]) {
      const now = (await ethers.provider.getBlock("latest")).timestamp;
      await e.token.connect(e.client).approve(e.market, U);
      const tx = e.market.connect(e.client).postJob(U, now + 2 * 86400, 3600, value, 12 * 3600, 0, false, H(label), H(label), false);
      if (valid) await expect(tx, label).to.not.be.reverted; else await expect(tx, label).to.be.reverted;
    }
  });

  it("covers revision duration minimum/exact/maximum boundaries", async function () {
    const e = await deploy();
    for (const [label, value, valid] of [["min-1", 12 * 3600 - 1, false], ["min", 12 * 3600, true], ["max", 14 * 86400, true], ["max+1", 14 * 86400 + 1, false]]) {
      const now = (await ethers.provider.getBlock("latest")).timestamp;
      await e.token.connect(e.client).approve(e.market, U);
      const tx = e.market.connect(e.client).postJob(U, now + 2 * 86400, 3600, 24 * 3600, value, 0, false, H(label), H(label), false);
      if (valid) await expect(tx, label).to.not.be.reverted; else await expect(tx, label).to.be.reverted;
    }
  });

  it("enforces inclusive validAfter and exclusive validBefore and applyBy", async function () {
    const e = await deploy(); await registerAndStake(e, e.op1); const job = await post(e); const now = (await ethers.provider.getBlock("latest")).timestamp;
    const at = await application(e, e.op1, job, { validAfter: now + 2, validBefore: BigInt(job.applyBy) });
    await expect(e.market.connect(e.client).awardJob(1, at.value, at.sig)).to.be.reverted;
    await atNextBlock(2);
    const good = await application(e, e.op1, job, { validAfter: BigInt((await ethers.provider.getBlock("latest")).timestamp), validBefore: BigInt(job.applyBy) });
    await expect(e.market.connect(e.client).awardJob(1, good.value, good.sig)).to.not.be.reverted;
  });

  it("rejects every EIP712 domain and application identity mismatch", async function () {
    const e = await deploy(); await registerAndStake(e, e.op1); const job = await post(e); const good = await application(e, e.op1, job);
    const net = await ethers.provider.getNetwork();
    for (const domain of [{ name: "Wrong", version: "1" }, { name: DOMAIN.name, version: "2" }, { name: DOMAIN.name, version: DOMAIN.version, chainId: net.chainId + 1n }, { name: DOMAIN.name, version: DOMAIN.version, chainId: net.chainId, verifyingContract: e.op2.address }]) {
      const sig = await e.op1.signTypedData({ chainId: net.chainId, verifyingContract: await e.market.getAddress(), ...domain }, TYPES, good.value);
      await expect(e.market.connect(e.client).awardJob(1, good.value, sig), domain.name || "bad-domain").to.be.reverted;
    }
    for (const change of [{ jobId: 2n }, { operator: e.op2.address }, { termsHash: H("different") }, { operatorNonce: 1n }, { nonceEpoch: 1n }]) {
      const value = { ...good.value, ...change }; const sig = await e.op1.signTypedData({ ...DOMAIN, chainId: net.chainId, verifyingContract: await e.market.getAddress() }, TYPES, value);
      await expect(e.market.connect(e.client).awardJob(1, value, sig)).to.be.reverted;
    }
  });

  it("enforces cap one, unlimited zero, lower cap non-cancellation, and owner isolation", async function () {
    const e = await deploy(); await registerAndStake(e, e.op1, 100n * U); await e.market.connect(e.op1).setMaxActiveJobs(1);
    await post(e); const j1 = await e.market.getJob(1); const a1 = await application(e, e.op1, j1); await e.market.connect(e.client).awardJob(1, a1.value, a1.sig);
    await e.token.connect(e.client).approve(e.market, U); await e.market.connect(e.client).postJob(U, (await ethers.provider.getBlock("latest")).timestamp + 2 * 86400, 3600, 24 * 3600, 12 * 3600, 0, false, H("two"), H("two"), false);
    const j2 = await e.market.getJob(2); const a2 = await application(e, e.op1, j2); await expect(e.market.connect(e.client).awardJob(2, a2.value, a2.sig)).to.be.reverted;
    await expect(e.market.connect(e.op2).setMaxActiveJobs(1)).to.not.be.reverted; expect(await e.market.maxActiveJobs(e.op1.address)).to.equal(1n);
  });

  it("preserves old fee snapshots and canonical hashes through policy decrease/re-increase settlement", async function () {
    const e = await deploy();
    const jobs = [];
    for (const [fee, tag] of [[500, "old-500"], [100, "old-100"], [400, "old-400"]]) {
      await e.market.connect(e.owner).setPolicy(U, fee);
      const j = await post(e, U, 2 * 86400, 2 * 86400);
      jobs.push({ id: jobs.length + 1, job: j, hash: j.canonicalTermsHash, fee: BigInt(fee) });
      expect(j.feeBpsSnapshot, tag).to.equal(BigInt(fee));
    }
    await e.market.connect(e.owner).setPolicy(U, 0);
    await e.market.connect(e.owner).setPolicy(U, 500);
    for (const row of jobs) {
      const unchanged = await e.market.getJob(row.id);
      expect(unchanged.canonicalTermsHash).to.equal(row.hash);
      expect(unchanged.feeBpsSnapshot).to.equal(row.fee);
    }
    await registerAndStake(e, e.op1, 100n * U);
    for (const row of jobs) {
      const signed = await application(e, e.op1, row.job, row.id);
      await e.market.connect(e.client).awardJob(row.id, signed.value, signed.sig);
      const awarded = await e.market.getJob(row.id);
      await e.market.connect(e.op1).submitDelivery(row.id, H(`fee-old-${row.id}`), awarded.stateVersion);
      const submitted = await e.market.getJob(row.id);
      await e.market.connect(e.client).approve(row.id, submitted.stateVersion);
    }
    expect(await e.market.credits(e.treasury)).to.equal(100_000n);
    expect(await e.market.credits(e.op1)).to.equal(2_900_000n);
    await e.market.connect(e.owner).setPolicy(U, 100);
    const new100 = await post(e, U, 2 * 86400, 2 * 86400);
    await e.market.connect(e.owner).setPolicy(U, 400);
    const new400 = await post(e, U, 2 * 86400, 2 * 86400);
    expect(new100.feeBpsSnapshot).to.equal(100n); expect(new400.feeBpsSnapshot).to.equal(400n);
    for (const [id, job] of [[4, new100], [5, new400]]) {
      const signed = await application(e, e.op1, job, id);
      await e.market.connect(e.client).awardJob(id, signed.value, signed.sig);
      const awarded = await e.market.getJob(id);
      await e.market.connect(e.op1).submitDelivery(id, H(`fee-new-${id}`), awarded.stateVersion);
      const submitted = await e.market.getJob(id);
      await e.market.connect(e.client).approve(id, submitted.stateVersion);
    }
    expect(await e.market.credits(e.treasury)).to.equal(150_000n);
    expect(await e.market.credits(e.op1)).to.equal(4_850_000n);
    await expect(e.market.connect(e.owner).setPolicy(0, 0)).to.be.reverted;
    await expect(e.market.connect(e.owner).setPolicy(2n * U, 501)).to.be.reverted;
    await expect(e.market.connect(e.op1).setPolicy(2n * U, 100)).to.be.reverted;
  });

  it("blocks ownership renunciation and emits admin configuration changes", async function () {
    const e = await deploy(); const ownerBefore = await e.market.owner();
    await expect(e.market.connect(e.op1).renounceOwnership()).to.be.reverted;
    await expect(e.market.connect(e.owner).renounceOwnership()).to.be.revertedWithCustomError(e.market, "Unauthorized");
    expect(await e.market.owner()).to.equal(ownerBefore);
    await expect(e.market.connect(e.owner).setTreasury(e.op1.address)).to.emit(e.market, "TreasuryChanged").withArgs(e.treasury.address, e.op1.address);
    await expect(e.market.connect(e.owner).setHouse(e.op1.address, true)).to.emit(e.market, "HouseStatusChanged").withArgs(e.op1.address, false, true);
    await expect(e.market.connect(e.owner).setTestClient(e.client.address, true)).to.emit(e.market, "TestClientStatusChanged").withArgs(e.client.address, false, true);
    await expect(e.market.connect(e.owner).setResolverForClient(e.client.address, e.op1.address)).to.emit(e.market, "ResolverPolicyChanged").withArgs(e.client.address, ethers.ZeroAddress, e.op1.address);
  });

  it("keeps collateral ceil, reservation, and free stake independent per job", async function () {
    const e = await deploy(); await registerAndStake(e, e.op1, 20n * U);
    expect(await e.market.requiredStake(5n * U)).to.equal(5n * U); expect(await e.market.requiredStake(5n * U + 1n)).to.equal(5n * U); expect(await e.market.requiredStake(50n * U + 1n)).to.equal(5_010_000n);
    expect(await e.market.requiredStake((1n << 256n) - 1n)).to.equal(11579208923731619542357098500868790785326998466564056403945758400791312970000n);
    const j = await post(e); const a = await application(e, e.op1, j); await e.market.connect(e.client).awardJob(1, a.value, a.sig);
    expect(await e.market.reservedStake(e.op1.address)).to.equal(5n * U); expect(await e.market.freeStake(e.op1.address)).to.equal(15n * U);
    await expect(e.vault.connect(e.op1).withdrawStake(15n * U + 1n)).to.be.reverted;
  });

  it("records direct token donations only as surplus", async function () {
    const e = await deploy(); const before = await e.market.liabilities(); await e.token.connect(e.owner).transfer(e.market, 7n * U);
    expect(await e.market.liabilities()).to.equal(before); expect(await e.market.surplus()).to.equal(7n * U); expect(await e.market.escrowed()).to.equal(0n);
  });
});
