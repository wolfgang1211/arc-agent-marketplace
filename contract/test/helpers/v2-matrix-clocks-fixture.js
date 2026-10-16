const { ethers } = require("hardhat");
const { wrapMarket } = require("./v2-read-model");
const { deployV2Pair } = require("./deploy-v2-pair");
const U = 1_000_000n;
const DAY = 86400;
const H = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
async function latest() { return (await ethers.provider.getBlock("latest")).timestamp; }
async function advance(seconds) { await ethers.provider.send("evm_increaseTime", [seconds]); await ethers.provider.send("evm_mine"); }
async function at(timestamp) { const now = await latest(); if (timestamp < now) throw new Error(`cannot move backwards: ${timestamp} < ${now}`); await ethers.provider.send("evm_setNextBlockTimestamp", [timestamp]); await ethers.provider.send("evm_mine"); }
async function deployFixture() {
  const [owner, client, operator, operator2, treasury, arbiter, outsider] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("MockUSDC"); const token = await Token.deploy();
  const pair = await deployV2Pair({ token, owner, treasury });
  const market = wrapMarket(pair.market); const vault = pair.vault;
  const accounts = [owner, client, operator, operator2, treasury, arbiter, outsider];
  for (const a of accounts) await token.mint(a.address, 10000n * U);
  for (const a of [operator, operator2]) { await token.connect(a).approve(await vault.getAddress(), 1000n * U); await vault.connect(a).depositStake(1000n * U); await market.connect(a).registerOperator(); }
  return { owner, client, operator, operator2, treasury, arbiter, outsider, token, market, vault, accounts };
}
async function post(e, o = {}) {
  const now = await latest(); const id = Number(await e.market.nextJobId()); const reward = o.reward ?? 10n * U;
  await e.token.connect(e.client).approve(await e.market.getAddress(), reward);
  await e.market.connect(e.client).postJob(reward, BigInt(o.applyBy ?? now + 2 * DAY), BigInt(o.delivery ?? 2 * DAY), BigInt(o.review ?? 2 * DAY), BigInt(o.revision ?? 12 * 3600), o.revisionLimit ?? 2, o.unlimited ?? false, H(`criteria-${id}`), H(`description-${id}`), o.testJob ?? false);
  return id;
}
async function application(e, id, operator = e.operator) {
  const j = await e.market.getJob(id); const net = await ethers.provider.getNetwork();
  const value = { jobId: BigInt(id), operator: operator.address, termsHash: j.canonicalTermsHash, validAfter: 0, validBefore: j.applyBy, nonceEpoch: 0, operatorNonce: 0 };
  const sig = await operator.signTypedData({ name: "AlphaBoard Agent Marketplace V2", version: "1", chainId: net.chainId, verifyingContract: await e.market.getAddress() }, { Application: [{ name: "jobId", type: "uint256" }, { name: "operator", type: "address" }, { name: "termsHash", type: "bytes32" }, { name: "validAfter", type: "uint64" }, { name: "validBefore", type: "uint64" }, { name: "nonceEpoch", type: "uint256" }, { name: "operatorNonce", type: "uint256" }] }, value);
  return { value, sig };
}
async function award(e, id, operator = e.operator) { const a = await application(e, id, operator); await e.market.connect(e.client).awardJob(id, a.value, a.sig); }
async function submit(e, id, operator = e.operator, label = `delivery-${id}`) { const j = await e.market.getJob(id); await e.market.connect(operator).submitDelivery(id, H(label), j.stateVersion); }
async function open(e, id, who = e.client) { const j = await e.market.getJob(id); await e.market.connect(who).openDispute(id,j.stateVersion); }
async function assertAccounting(e) {
  let free = 0n, reserved = 0n, credits = 0n;
  for (const a of e.accounts) { free += await e.market.freeStake(a.address); reserved += await e.market.reservedStake(a.address); credits += await e.market.credits(a.address); }
  for (let id = 1; id < Number(await e.market.nextJobId()); id++) { const j = await e.market.getJob(id); if (Number(j.status) <= 5) { /* escrow is aggregate, including disputed jobs */ } }
  if (free + reserved !== await e.market.stakeLiability()) throw new Error("stake liability mismatch");
  if (credits !== await e.market.creditsLiability()) throw new Error("credit liability mismatch");
  let escrow = 0n; for (let id = 1; id < Number(await e.market.nextJobId()); id++) { const j = await e.market.getJob(id); if (Number(j.status) <= 5) escrow += j.reward; }
  if (escrow !== await e.market.escrowed()) throw new Error("escrow mismatch");
  const balance = await e.token.balanceOf(await e.market.getAddress()); const surplus = balance - escrow - await e.market.creditsLiability();
  if (surplus !== await e.market.surplus()) throw new Error("surplus mismatch");
}
module.exports = { U, DAY, H, latest, advance, at, deployFixture, post, application, award, submit, open, assertAccounting };
