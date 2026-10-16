const { ethers } = require("hardhat");
const { wrapMarket } = require("./v2-read-model");
const { deployV2Pair } = require("./deploy-v2-pair");

const U = 1_000_000n;
const DAY = 86400;
const H = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));

async function deployFixture() {
  const [owner, client, operator, operator2, treasury, arbiter, outsider] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("MockUSDC");
  const token = await Token.deploy();
  const pair = await deployV2Pair({ token, owner, treasury });
  const market = wrapMarket(pair.market);
  const vault = pair.vault;
  const accounts = [owner, client, operator, operator2, treasury, arbiter, outsider];
  for (const account of accounts) await token.mint(account.address, 10_000n * U);
  for (const account of [operator, operator2]) {
    await token.connect(account).approve(await vault.getAddress(), 1_000n * U);
    await vault.connect(account).depositStake(1_000n * U);
    await market.connect(account).registerOperator();
  }
  return { owner, client, operator, operator2, treasury, arbiter, outsider, token, market, vault, accounts };
}

async function latest() { return (await ethers.provider.getBlock("latest")).timestamp; }
async function mineAt(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine");
}
async function mineExact(timestamp) {
  const now = await latest();
  if (timestamp < now) throw new Error(`cannot move backwards: ${timestamp} < ${now}`);
  await ethers.provider.send("evm_setNextBlockTimestamp", [timestamp]);
  await ethers.provider.send("evm_mine");
}
async function post(e, opts = {}) {
  const reward = opts.reward ?? 10n * U;
  const now = await latest();
  const args = {
    applyBy: BigInt(opts.applyBy ?? now + 2 * DAY),
    delivery: BigInt(opts.delivery ?? 2 * DAY),
    review: BigInt(opts.review ?? 2 * DAY),
    revision: BigInt(opts.revision ?? 12 * 3600),
    revisionLimit: opts.revisionLimit ?? 2,
    unlimited: opts.unlimited ?? false,
    testJob: opts.testJob ?? false,
  };
  await e.token.connect(e.client).approve(await e.market.getAddress(), reward);
  const tx = await e.market.connect(e.client).postJob(reward, args.applyBy, args.delivery, args.review, args.revision, args.revisionLimit, args.unlimited, H(`criteria-${await e.market.nextJobId()}`), H(`description-${await e.market.nextJobId()}`), args.testJob);
  const receipt = await tx.wait();
  return { id: Number(await e.market.nextJobId()) - 1, receipt, args, job: await e.market.getJob(Number(await e.market.nextJobId()) - 1) };
}

async function application(e, id, operator = e.operator) {
  const j = await e.market.getJob(id);
  const net = await ethers.provider.getNetwork();
  const value = { jobId: BigInt(id), operator: operator.address, termsHash: j.canonicalTermsHash, validAfter: 0, validBefore: j.applyBy, nonceEpoch: 0, operatorNonce: 0 };
  const sig = await operator.signTypedData(
    { name: "AlphaBoard Agent Marketplace V2", version: "1", chainId: net.chainId, verifyingContract: await e.market.getAddress() },
    { Application: [
      { name: "jobId", type: "uint256" }, { name: "operator", type: "address" }, { name: "termsHash", type: "bytes32" },
      { name: "validAfter", type: "uint64" }, { name: "validBefore", type: "uint64" }, { name: "nonceEpoch", type: "uint256" }, { name: "operatorNonce", type: "uint256" },
    ] }, value,
  );
  return { value, sig };
}
async function award(e, id, operator = e.operator) {
  const a = await application(e, id, operator);
  await e.market.connect(e.client).awardJob(id, a.value, a.sig);
  return e.market.getJob(id);
}
async function submit(e, id, operator = e.operator, hash = `delivery-${id}`) {
  const j = await e.market.getJob(id);
  await e.market.connect(operator).submitDelivery(id, H(hash), j.stateVersion);
  return e.market.getJob(id);
}
async function dispute(e, id, party = e.client) {
  const j = await e.market.getJob(id);
  await e.market.connect(party).openDispute(id,j.stateVersion);
  return e.market.getJob(id);
}
async function assertAccounting(e) {
  let free = 0n, reserved = 0n, credits = 0n, escrow = 0n;
  for (const s of e.accounts) {
    free += await e.market.freeStake(s.address);
    reserved += await e.market.reservedStake(s.address);
    credits += await e.market.credits(s.address);
  }
  for (let id = 1; id < Number(await e.market.nextJobId()); id++) {
    const j = await e.market.getJob(id);
    if (Number(j.status) <= 5) escrow += j.reward;
  }
  if (free + reserved !== await e.market.stakeLiability()) throw new Error("stake liability mismatch");
  if (credits !== await e.market.creditsLiability()) throw new Error("credit liability mismatch");
  if (escrow !== await e.market.escrowed()) throw new Error("escrow mismatch");
  const balance = await e.token.balanceOf(await e.market.getAddress());
  const surplus = balance - escrow - await e.market.creditsLiability();
  if (surplus !== await e.market.surplus()) throw new Error("surplus mismatch");
}
module.exports = { U, DAY, H, deployFixture, latest, mineAt, mineExact, post, application, award, submit, dispute, assertAccounting };
