const { ethers } = require("hardhat");
const { wrapMarket } = require("./v2-read-model");
const { deployV2Pair } = require("./deploy-v2-pair");
const U = 1_000_000n;
const DAY = 86400;
const H = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
async function deployFixture() {
  const [owner, client, operator, operator2, treasury, arbiter, outsider] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("V2AccountingToken");
  const token = await Token.deploy();
  const pair = await deployV2Pair({ token, owner, treasury });
  const market = wrapMarket(pair.market); const vault = pair.vault;
  const accounts = [owner, client, operator, operator2, treasury, arbiter, outsider];
  for (const a of accounts) await token.mint(a.address, 10_000n * U);
  for (const a of [operator, operator2]) {
    await token.connect(a).approve(await vault.getAddress(), 1_000n * U);
    await vault.connect(a).depositStake(1_000n * U);
    await market.connect(a).registerOperator();
  }
  return { owner, client, operator, operator2, treasury, arbiter, outsider, token, market, vault, accounts };
}
async function latest() { return (await ethers.provider.getBlock("latest")).timestamp; }
async function mineAt(seconds) { await ethers.provider.send("evm_increaseTime", [seconds]); await ethers.provider.send("evm_mine"); }
async function mineExact(ts) { const now = await latest(); if (ts < now) throw new Error(`cannot move backwards: ${ts} < ${now}`); await ethers.provider.send("evm_setNextBlockTimestamp", [ts]); await ethers.provider.send("evm_mine"); }
async function post(e, o = {}) {
  const reward = o.reward ?? 10n * U; const now = await latest();
  const a = { applyBy: BigInt(o.applyBy ?? now + 2 * DAY), delivery: BigInt(o.delivery ?? 2 * DAY), review: BigInt(o.review ?? 2 * DAY), revision: BigInt(o.revision ?? 12 * 3600), revisionLimit: o.revisionLimit ?? 2, unlimited: o.unlimited ?? false, testJob: o.testJob ?? false };
  await e.token.connect(e.client).approve(await e.market.getAddress(), reward);
  const n = await e.market.nextJobId();
  const tx = await e.market.connect(e.client).postJob(reward, a.applyBy, a.delivery, a.review, a.revision, a.revisionLimit, a.unlimited, H(`criteria-${n}`), H(`description-${n}`), a.testJob);
  const receipt = await tx.wait(); return { id: Number(n), args: a, receipt, job: await e.market.getJob(Number(n)) };
}
async function application(e, id, operator = e.operator, validBefore) {
  const j = await e.market.getJob(id); const net = await ethers.provider.getNetwork();
  const value = { jobId: BigInt(id), operator: operator.address, termsHash: j.canonicalTermsHash, validAfter: 0, validBefore: validBefore ?? j.applyBy, nonceEpoch: 0, operatorNonce: 0 };
  const sig = await operator.signTypedData({ name: "AlphaBoard Agent Marketplace V2", version: "1", chainId: net.chainId, verifyingContract: await e.market.getAddress() }, { Application: [{ name: "jobId", type: "uint256" }, { name: "operator", type: "address" }, { name: "termsHash", type: "bytes32" }, { name: "validAfter", type: "uint64" }, { name: "validBefore", type: "uint64" }, { name: "nonceEpoch", type: "uint256" }, { name: "operatorNonce", type: "uint256" }] }, value);
  return { value, sig };
}
async function award(e, id, operator = e.operator, validBefore) { const a = await application(e, id, operator, validBefore); return e.market.connect(e.client).awardJob(id, a.value, a.sig); }
async function submit(e, id, operator = e.operator, hash = `delivery-${id}`) { const j = await e.market.getJob(id); return e.market.connect(operator).submitDelivery(id, H(hash), j.stateVersion); }
async function openDispute(e,party = e.client) { const j = await e.market.getJob(id); return e.market.connect(party).openDispute(id,j.stateVersion); }
async function assertAccounting(e) {
  let free = 0n, reserved = 0n, credits = 0n, escrow = 0n;
  for (const a of e.accounts) { free += await e.market.freeStake(a.address); reserved += await e.market.reservedStake(a.address); credits += await e.market.credits(a.address); }
  for (let id = 1; id < Number(await e.market.nextJobId()); id++) { const j = await e.market.getJob(id); if (Number(j.status) <= 5) escrow += j.reward; }
  if (free + reserved !== await e.market.stakeLiability()) throw new Error("stake liability mismatch");
  if (credits !== await e.market.creditsLiability()) throw new Error("credit liability mismatch");
  if (escrow !== await e.market.escrowed()) throw new Error("escrow mismatch");
  const balance = await e.token.balanceOf(await e.market.getAddress());
  if (balance - escrow - await e.market.creditsLiability() !== await e.market.surplus()) throw new Error("surplus mismatch");
}
module.exports = { U, DAY, H, deployFixture, latest, mineAt, mineExact, post, application, award, submit, openDispute, assertAccounting };
