const { ethers } = require("hardhat");
const { wrapMarket } = require("./v2-read-model");
const { deployV2Pair } = require("./deploy-v2-pair");
const U = 1_000_000n;
const H = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
const DAY = 86400;
async function deploy() {
  const [owner, client, operator, treasury, arbiter, outsider] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("MockUSDC"); const token = await Token.deploy();
  const pair = await deployV2Pair({ token, owner, treasury });
  const market = wrapMarket(pair.market); const vault = pair.vault;
  for (const s of [owner, client, operator, treasury, arbiter, outsider]) await token.mint(s.address, 2_000n * U);
  await token.connect(operator).approve(vault, 500n * U); await vault.connect(operator).depositStake(500n * U); await market.connect(operator).registerOperator();
  return { owner, client, operator, treasury, arbiter, outsider, token, market, vault };
}
async function post(e, delivery = DAY, testJob = false) {
  const reward = 10n * U; await e.token.connect(e.client).approve(e.market, reward);
  const now = BigInt((await ethers.provider.getBlock("latest")).timestamp);
  await e.market.connect(e.client).postJob(reward, now + 2n * BigInt(DAY), delivery, DAY, 12 * 3600, 2, false, H("criteria"), H("description"), testJob);
  return e.market.getJob(1);
}
async function award(e, job = null) {
  job ??= await e.market.getJob(1); const net = await ethers.provider.getNetwork();
  const value = { jobId: 1n, operator: e.operator.address, termsHash: job.canonicalTermsHash, validAfter: 0, validBefore: job.applyBy, nonceEpoch: 0, operatorNonce: 0 };
  const sig = await e.operator.signTypedData({ name: "AlphaBoard Agent Marketplace V2", version: "1", chainId: net.chainId, verifyingContract: await e.market.getAddress() }, { Application: [
    { name: "jobId", type: "uint256" }, { name: "operator", type: "address" }, { name: "termsHash", type: "bytes32" }, { name: "validAfter", type: "uint64" }, { name: "validBefore", type: "uint64" }, { name: "nonceEpoch", type: "uint256" }, { name: "operatorNonce", type: "uint256" },
  ] }, value);
  await e.market.connect(e.client).awardJob(1, value, sig); return e.market.getJob(1);
}
async function jump(seconds) { await ethers.provider.send("evm_increaseTime", [seconds]); await ethers.provider.send("evm_mine"); }
async function invariant(e) {
  let free = 0n, reserved = 0n, credits = 0n, escrow = 0n;
  for (const s of [e.owner,e.client,e.operator,e.treasury,e.arbiter,e.outsider]) { free += await e.market.freeStake(s.address); reserved += await e.market.reservedStake(s.address); credits += await e.market.credits(s.address); }
  for (let id=1; id<Number(await e.market.nextJobId()); id++) { const j=await e.market.getJob(id); if(Number(j.status)<=5) escrow+=j.reward; }
  if (free+reserved !== await e.market.stakeLiability()) throw new Error("stake invariant");
  if (credits !== await e.market.creditsLiability()) throw new Error("credit invariant");
  if (escrow !== await e.market.escrowed()) throw new Error("escrow invariant");
}
module.exports = { deploy, post, award, jump, invariant, DAY, H };
