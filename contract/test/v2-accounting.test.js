const { expect } = require("chai");
const { ethers } = require("hardhat");
const { wrapMarket } = require("./helpers/v2-read-model");
const { deployV2Pair } = require("./helpers/deploy-v2-pair");

const U = 1_000_000n;
const H = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
const fixtures = [];
const TYPES = { Application: [
  { name: "jobId", type: "uint256" }, { name: "operator", type: "address" },
  { name: "termsHash", type: "bytes32" }, { name: "validAfter", type: "uint64" },
  { name: "validBefore", type: "uint64" }, { name: "nonceEpoch", type: "uint256" },
  { name: "operatorNonce", type: "uint256" },
] };

async function deploy(TokenName = "V2AccountingToken") {
  const [owner, client, op1, op2, treasury1, treasury2, other] = await ethers.getSigners();
  const token = await (await ethers.getContractFactory(TokenName)).deploy();
  const pair = await deployV2Pair({ token, owner, treasury: treasury1 });
  const market = wrapMarket(pair.market); const vault = pair.vault;
  for (const s of [owner, client, op1, op2, treasury1, treasury2, other]) await token.mint(s, 1_000n * U);
  const e = { owner, client, op1, op2, treasury1, treasury2, other, token, market, vault }; fixtures.push(e); return e;
}
async function post(e, reward = U, tag = "job") {
  const { client, market, token } = e;
  await token.connect(client).approve(market, reward);
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  await market.connect(client).postJob(reward, now + 2 * 86400, 3600, 24 * 3600, 12 * 3600, 2, false, H(`${tag}-criteria`), H(`${tag}-description`), false);
  return market.getJob(await market.nextJobId() - 1n);
}
async function stakeAndRegister(e, who, amount = 100n * U) {
  await e.token.connect(who).approve(e.vault, amount); await e.vault.connect(who).depositStake(amount); await e.market.connect(who).registerOperator();
}
async function application(e, who, id, job) {
  const net = await ethers.provider.getNetwork();
  const value = { jobId: id, operator: who.address, termsHash: job.canonicalTermsHash, validAfter: 0, validBefore: job.applyBy, nonceEpoch: await e.market.nonceEpoch(who), operatorNonce: await e.market.applicationNonce(id, who) };
  const sig = await who.signTypedData({ name: "AlphaBoard Agent Marketplace V2", version: "1", chainId: net.chainId, verifyingContract: await e.market.getAddress() }, TYPES, value);
  return { value, sig };
}
async function award(e, who, id, job) { const a = await application(e, who, BigInt(id), job); await e.market.connect(e.client).awardJob(id, a.value, a.sig); }
async function settle(e, who, id) { const j = await e.market.getJob(id); await e.market.connect(who).submitDelivery(id, H(`delivery-${id}`), j.stateVersion); const s = await e.market.getJob(id); await e.market.connect(e.client).approve(id, s.stateVersion); }
async function assertAccounting(e) {
  let free = 0n, reserved = 0n, credits = 0n, escrow = 0n;
  for (const s of [e.owner, e.client, e.op1, e.op2, e.treasury1, e.treasury2, e.other]) { free += await e.market.freeStake(s); reserved += await e.market.reservedStake(s); credits += await e.market.credits(s); }
  for (let id = 1n; id < await e.market.nextJobId(); id++) { const j = await e.market.getJob(id); if (Number(j.status) <= 5) escrow += j.reward; }
  expect(free + reserved).to.equal(await e.market.stakeLiability());
  expect(credits).to.equal(await e.market.creditsLiability());
  expect(escrow).to.equal(await e.market.escrowed());
  expect(escrow + await e.market.creditsLiability() + await e.market.surplus()).to.equal(await e.token.balanceOf(e.market));
}

describe("AgentMarketplaceV2 Stage A accounting, races, and pull adversaries", function () {
  afterEach(async function () { for (const e of fixtures.splice(0)) await assertAccounting(e); });

  it("snapshots old fee/treasury, lowers policy for new jobs, and preserves canonical hashes", async function () {
    const e = await deploy(); await stakeAndRegister(e, e.op1);
    const old = await post(e, U, "old"); const oldHash = old.canonicalTermsHash;
    expect(old.feeBpsSnapshot).to.equal(500n); expect(old.treasurySnapshot).to.equal(e.treasury1.address);
    await e.market.connect(e.owner).setPolicy(200_000n, 200); await expect(e.market.connect(e.op1).setPolicy(200_000n, 300)).to.be.reverted;
    await expect(e.market.connect(e.op1).setTreasury(e.op1)).to.be.reverted; await e.market.connect(e.owner).setTreasury(e.treasury2);
    const newer = await post(e, 2n * U, "new");
    expect(newer.feeBpsSnapshot).to.equal(200n); expect(newer.treasurySnapshot).to.equal(e.treasury2.address);
    expect((await e.market.getJob(1)).canonicalTermsHash).to.equal(oldHash);
    expect(newer.canonicalTermsHash).to.not.equal(oldHash);
    await award(e, e.op1, 1, old); await award(e, e.op1, 2, newer); await settle(e, e.op1, 1); await settle(e, e.op1, 2);
    expect(await e.market.credits(e.treasury1)).to.equal(50_000n); expect(await e.market.credits(e.treasury2)).to.equal(40_000n);
    expect(await e.market.credits(e.op1)).to.equal(2_910_000n);
  });

  it("raises minimum only for new posts: old job still awards/submits/settles", async function () {
    const e = await deploy(); await stakeAndRegister(e, e.op1); const old = await post(e, U, "old-min");
    await e.market.connect(e.owner).setPolicy(2n * U, 500);
    await award(e, e.op1, 1, old); await settle(e, e.op1, 1);
    await expect(post(e, U, "new-below-min")).to.be.reverted;
    const newer = await post(e, 2n * U, "new-at-min"); expect(newer.minRewardSnapshot).to.equal(2n * U);
  });

  it("keeps operator profiles and reservations independent across jobs and operators", async function () {
    const e = await deploy(); await stakeAndRegister(e, e.op1, 20n * U); await stakeAndRegister(e, e.op2, 20n * U);
    await e.market.connect(e.op1).setMaxActiveJobs(2); await e.market.connect(e.op2).setMaxActiveJobs(1);
    const a = await post(e, U, "a"), b = await post(e, U, "b"), c = await post(e, U, "c");
    await award(e, e.op1, 1, a); await award(e, e.op1, 2, b); await award(e, e.op2, 3, c);
    const beforeB = await e.market.getJob(2), beforeC = await e.market.getJob(3), reserved2 = await e.market.reservedStake(e.op2);
    await settle(e, e.op1, 1);
    expect((await e.market.getJob(2)).deliveryDeadline).to.equal(beforeB.deliveryDeadline);
    expect((await e.market.getJob(3)).deliveryDeadline).to.equal(beforeC.deliveryDeadline);
    expect(await e.market.reservedStake(e.op2)).to.equal(reserved2);
    expect(await e.market.activeJobs(e.op2)).to.equal(1n);
  });

  it("competing awards against one operator cap reserve exactly one job", async function () {
    const e = await deploy(); await stakeAndRegister(e, e.op1, 20n * U); await e.market.connect(e.op1).setMaxActiveJobs(1);
    const j1 = await post(e, U, "race1"), j2 = await post(e, U, "race2");
    await award(e, e.op1, 1, j1);
    expect(await e.market.freeStake(e.op1)).to.be.greaterThanOrEqual(await e.market.requiredStake(j2.reward));
    const a2 = await application(e, e.op1, 2n, j2);
    const before = await Promise.all([e.token.balanceOf(e.market), e.market.escrowed(), e.market.stakeLiability(), e.market.creditsLiability(), e.market.freeStake(e.op1), e.market.reservedStake(e.op1), e.market.activeJobs(e.op1), e.market.getJob(2)]);
    await expect(e.market.connect(e.client).awardJob(2, a2.value, a2.sig)).to.be.revertedWithCustomError(e.market, "InvalidTerms");
    const after = await Promise.all([e.token.balanceOf(e.market), e.market.escrowed(), e.market.stakeLiability(), e.market.creditsLiability(), e.market.freeStake(e.op1), e.market.reservedStake(e.op1), e.market.activeJobs(e.op1), e.market.getJob(2)]);
    expect(after).to.deep.equal(before);
    expect(await e.market.activeJobs(e.op1)).to.equal(1n); expect(await e.market.reservedStake(e.op1)).to.equal(5n * U);
    expect((await e.market.getJob(2)).operator).to.equal(ethers.ZeroAddress);
  });

  it("rejects an unset-cap award for insufficient free stake without changing the second job", async function () {
    const e = await deploy(); await stakeAndRegister(e, e.op1, 5n * U);
    const j1 = await post(e, U, "stake-race1"), j2 = await post(e, U, "stake-race2");
    await award(e, e.op1, 1, j1); expect(await e.market.freeStake(e.op1)).to.be.lessThan(await e.market.requiredStake(j2.reward));
    const a2 = await application(e, e.op1, 2n, j2);
    const before = await Promise.all([e.token.balanceOf(e.market), e.market.escrowed(), e.market.stakeLiability(), e.market.creditsLiability(), e.market.freeStake(e.op1), e.market.reservedStake(e.op1), e.market.activeJobs(e.op1), e.market.getJob(2)]);
    await expect(e.market.connect(e.client).awardJob(2, a2.value, a2.sig)).to.be.revertedWithCustomError(e.market, "InvalidTerms");
    const after = await Promise.all([e.token.balanceOf(e.market), e.market.escrowed(), e.market.stakeLiability(), e.market.creditsLiability(), e.market.freeStake(e.op1), e.market.reservedStake(e.op1), e.market.activeJobs(e.op1), e.market.getJob(2)]);
    expect(after).to.deep.equal(before);
  });

  it("lowered cap does not cancel active work and blocks only further awards", async function () {
    const e = await deploy(); await stakeAndRegister(e, e.op1, 20n * U); await e.market.connect(e.op1).setMaxActiveJobs(2);
    const j1 = await post(e, U, "cap1"), j2 = await post(e, U, "cap2"), j3 = await post(e, U, "cap3");
    await award(e, e.op1, 1, j1); await award(e, e.op1, 2, j2); await e.market.connect(e.op1).setMaxActiveJobs(1);
    expect((await e.market.getJob(1)).status).to.equal(1n); expect((await e.market.getJob(2)).status).to.equal(1n);
    expect(await e.market.freeStake(e.op1)).to.be.greaterThanOrEqual(await e.market.requiredStake(j3.reward));
    const a3 = await application(e, e.op1, 3n, j3); const before = await Promise.all([e.token.balanceOf(e.market), e.market.escrowed(), e.market.stakeLiability(), e.market.creditsLiability(), e.market.freeStake(e.op1), e.market.reservedStake(e.op1), e.market.activeJobs(e.op1), e.market.getJob(3)]);
    await expect(e.market.connect(e.client).awardJob(3, a3.value, a3.sig)).to.be.revertedWithCustomError(e.market, "InvalidTerms");
    const after = await Promise.all([e.token.balanceOf(e.market), e.market.escrowed(), e.market.stakeLiability(), e.market.creditsLiability(), e.market.freeStake(e.op1), e.market.reservedStake(e.op1), e.market.activeJobs(e.op1), e.market.getJob(3)]); expect(after).to.deep.equal(before);
    await settle(e, e.op1, 1); const a3b = await application(e, e.op1, 3n, j3); await expect(e.market.connect(e.client).awardJob(3, a3b.value, a3b.sig)).to.be.revertedWithCustomError(e.market, "InvalidTerms");
    await settle(e, e.op1, 2); const a3c = await application(e, e.op1, 3n, j3); await expect(e.market.connect(e.client).awardJob(3, a3c.value, a3c.sig)).to.not.be.reverted;
  });

  it("unset cap allows a second active award and reserves both jobs", async function () {
    const e = await deploy(); await stakeAndRegister(e, e.op1, 20n * U); await e.market.connect(e.op1).setMaxActiveJobs(1);
    const j1 = await post(e, U, "unset-cap1"), j2 = await post(e, U, "unset-cap2");
    await award(e, e.op1, 1, j1); await e.market.connect(e.op1).setMaxActiveJobs(0); await award(e, e.op1, 2, j2);
    expect((await e.market.getJob(1)).operator).to.equal(e.op1.address); expect((await e.market.getJob(2)).operator).to.equal(e.op1.address);
    expect(await e.market.activeJobs(e.op1)).to.equal(2n); expect(await e.market.reservedStake(e.op1)).to.equal(10n * U); expect(await e.market.freeStake(e.op1)).to.equal(10n * U);
  });

  it("enforces ceil collateral, exact boundary, fractional +1, and uint128 bound", async function () {
    const e = await deploy(); expect(await e.market.requiredStake(5n * U)).to.equal(5n * U); expect(await e.market.requiredStake(5n * U + 1n)).to.equal(5n * U);
    expect(await e.market.requiredStake(50n * U + 1n)).to.equal(5_010_000n); expect(await e.market.requiredStake((1n << 256n) - 1n)).to.equal(11579208923731619542357098500868790785326998466564056403945758400791312970000n);
    await expect(post(e, 1n << 128n, "overflow")).to.be.reverted;
  });

  it("reserved stake cannot withdraw while free stake can, and rejected withdrawal is unchanged", async function () {
    const e = await deploy(); await stakeAndRegister(e, e.op1, 10n * U); const j = await post(e); await award(e, e.op1, 1, j);
    const before = { free: await e.market.freeStake(e.op1), bal: await e.token.balanceOf(e.op1) };
    await expect(e.vault.connect(e.op1).withdrawStake(5n * U + 1n)).to.be.reverted;
    expect(await e.market.freeStake(e.op1)).to.equal(before.free); expect(await e.token.balanceOf(e.op1)).to.equal(before.bal);
    await e.vault.connect(e.op1).withdrawStake(5n * U); expect(await e.market.freeStake(e.op1)).to.equal(0n);
  });

  it("pull withdrawal is blocked without consuming credit, while treasury/client remain withdrawable", async function () {
    const e = await deploy(); await stakeAndRegister(e, e.op1); const j = await post(e); await award(e, e.op1, 1, j); await settle(e, e.op1, 1);
    await e.token.connect(e.owner).setBlocked(e.op1, true); const opCredit = await e.market.credits(e.op1);
    await expect(e.market.connect(e.op1).withdrawCredit()).to.be.reverted; expect(await e.market.credits(e.op1)).to.equal(opCredit);
    const tBefore = await e.token.balanceOf(e.treasury1); await e.market.connect(e.treasury1).withdrawCredit(); expect(await e.token.balanceOf(e.treasury1)).to.equal(tBefore + 50_000n);
    await e.token.connect(e.owner).setBlocked(e.op1, false); await e.market.connect(e.op1).withdrawCredit(); expect(await e.market.credits(e.op1)).to.equal(0n);
    await expect(e.market.connect(e.op1).withdrawCredit()).to.be.reverted;
  });

  it("token callback cannot reenter withdrawal or settlement and cannot double-credit", async function () {
    const e = await deploy(); await stakeAndRegister(e, e.op1); const j = await post(e); await award(e, e.op1, 1, j);
    const active = await e.market.getJob(1); const settleData = e.market.interface.encodeFunctionData("claimDeliveryTimeout", [1, active.stateVersion]);
    await e.token.connect(e.owner).setCallback(e.market, settleData); await e.vault.connect(e.op1).withdrawStake(1n * U);
    expect(await e.token.callbackAttempted()).to.equal(true); expect(await e.token.callbackSucceeded()).to.equal(false);
    await settle(e, e.op1, 1);
    const withdrawData = e.market.interface.encodeFunctionData("withdrawCredit"); await e.token.connect(e.owner).setCallback(e.market, withdrawData);
    const credit = await e.market.credits(e.op1); await e.market.connect(e.op1).withdrawCredit();
    expect(await e.token.callbackAttempted()).to.equal(true); expect(await e.token.callbackSucceeded()).to.equal(false); expect(await e.market.credits(e.op1)).to.equal(0n); expect(credit).to.equal(950_000n);
  });

  it("false-return token transfer fails SafeERC20 atomically with credit preserved", async function () {
    const e = await deploy(); await stakeAndRegister(e, e.op1); const j = await post(e); await award(e, e.op1, 1, j); await settle(e, e.op1, 1);
    const credit = await e.market.credits(e.op1), marketBal = await e.token.balanceOf(e.market); await e.token.connect(e.owner).setReturnFalse(true);
    await expect(e.market.connect(e.op1).withdrawCredit()).to.be.reverted; expect(await e.market.credits(e.op1)).to.equal(credit); expect(await e.token.balanceOf(e.market)).to.equal(marketBal);
  });

  it("donation changes surplus only", async function () { const e = await deploy(); const liab = await e.market.liabilities(); await e.token.connect(e.owner).transfer(e.market, 7n * U); expect(await e.market.liabilities()).to.equal(liab); expect(await e.market.surplus()).to.equal(7n * U); });
});
