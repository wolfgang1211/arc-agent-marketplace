const { expect } = require("chai");
const { ethers } = require("hardhat");
const { wrapMarket } = require("./helpers/v2-read-model");
const { deployV2Pair } = require("./helpers/deploy-v2-pair");

const U = 1_000_000n;
const h = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
const fixtures = [];
async function jump(seconds) { await ethers.provider.send("evm_increaseTime", [seconds]); await ethers.provider.send("evm_mine"); }

async function signedApplication(market, operator, jobId, termsHash, validBefore, operatorNonce = 0n) {
  const net = await ethers.provider.getNetwork();
  return operator.signTypedData(
    { name: "AlphaBoard Agent Marketplace V2", version: "1", chainId: net.chainId, verifyingContract: await market.getAddress() },
    { Application: [
      { name: "jobId", type: "uint256" }, { name: "operator", type: "address" },
      { name: "termsHash", type: "bytes32" }, { name: "validAfter", type: "uint64" },
      { name: "validBefore", type: "uint64" }, { name: "nonceEpoch", type: "uint256" },
      { name: "operatorNonce", type: "uint256" },
    ] },
    { jobId, operator: await operator.getAddress(), termsHash, validAfter: 0, validBefore, nonceEpoch: 0, operatorNonce },
  );
}

async function deploy() {
  const [owner, client, operator, treasury, arbiter, other] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("MockUSDC"); const token = await Token.deploy();
  const pair = await deployV2Pair({ token, owner, treasury });
  const market = wrapMarket(pair.market); const vault = pair.vault;
  for (const a of [owner, client, operator, treasury, arbiter, other]) await token.mint(await a.getAddress(), 1_000n * U);
  const env = { owner, client, operator, treasury, arbiter, other, token, market, vault }; fixtures.push(env); return env;
}

async function post(env, reward = 10n * U, testJob = false) {
  const { client, market, token } = env;
  await token.connect(client).approve(await market.getAddress(), reward)
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  return market.connect(client).postJob(reward, now + 2 * 86400, 2 * 86400, 2 * 86400, 12 * 3600, 2, false, h("criteria"), h("description"), testJob);
}

describe("AgentMarketplaceV2 acceptance", function () {
  afterEach(async function () {
    for (const e of fixtures.splice(0)) {
      let free = 0n, reserved = 0n, credits = 0n, escrow = 0n;
      for (const s of [e.owner, e.client, e.operator, e.treasury, e.arbiter, e.other]) { free += await e.market.freeStake(s.address); reserved += await e.market.reservedStake(s.address); credits += await e.market.credits(s.address); }
      const n = Number(await e.market.nextJobId());
      for (let id = 1; id < n; id++) { const j = await e.market.getJob(id); if (Number(j.status) <= 5) escrow += j.reward; }
      expect(free + reserved).to.equal(await e.market.stakeLiability());
      expect(credits).to.equal(await e.market.creditsLiability());
      expect(escrow).to.equal(await e.market.escrowed());
      expect(await e.token.balanceOf(e.market)).to.equal(escrow + await e.market.creditsLiability() + await e.market.surplus());
    }
  });
  it("posts, signs, awards, delivers, approves, and withdraws gross payout plus treasury fee", async function () {
    const e = await deploy(); const { market, token, operator, client, treasury } = e;
    await token.connect(operator).approve(await e.vault.getAddress(), 100n * U); await e.vault.connect(operator).depositStake(100n * U);
    await market.connect(operator).registerOperator();
    await post(e); const job = await market.getJob(1); const terms = job.canonicalTermsHash;
    const sig = await signedApplication(market, operator, 1n, terms, BigInt(job.applyBy));
    await market.connect(client).awardJob(1, { jobId: 1, operator: await operator.getAddress(), termsHash: terms, validAfter: 0, validBefore: BigInt(job.applyBy), nonceEpoch: 0, operatorNonce: 0 }, sig);
    const v = (await market.getJob(1)).stateVersion;
    await market.connect(operator).submitDelivery(1, h("encrypted blob"), v);
    const submitted = await market.getJob(1); await market.connect(client).approve(1, submitted.stateVersion);
    expect(await market.credits(operator)).to.equal(9_500_000n); expect(await market.credits(treasury)).to.equal(500_000n);
    const before = await token.balanceOf(await operator.getAddress()); await market.connect(operator).withdrawCredit();
    expect(await token.balanceOf(await operator.getAddress())).to.equal(before + 9_500_000n);
    expect(await market.escrowed()).to.equal(0n); expect(await market.liabilities()).to.equal(500_000n);
  });

  it("rejects wrong domain/signature, preserves applications, and enforces rounded collateral", async function () {
    const e = await deploy(); const { market, operator, client, token } = e;
    expect(await market.requiredStake(10_000_001n)).to.equal(5_000_000n);
    await token.connect(operator).approve(await e.vault.getAddress(), 10n * U); await e.vault.connect(operator).depositStake(10n * U);
    await market.connect(operator).registerOperator();
    await post(e); const j = await market.getJob(1); const terms = j.canonicalTermsHash;
    const bad = await signedApplication(market, operator, 1n, h("other terms"), BigInt(j.applyBy));
    await expect(market.connect(client).awardJob(1, { jobId:1, operator:await operator.getAddress(), termsHash:terms, validAfter:0, validBefore:BigInt(j.applyBy), nonceEpoch:0, operatorNonce:0 }, bad)).to.be.reverted;
    const good = await signedApplication(market, operator, 1n, terms, BigInt(j.applyBy));
    await market.connect(client).awardJob(1, { jobId:1, operator:await operator.getAddress(), termsHash:terms, validAfter:0, validBefore:BigInt(j.applyBy), nonceEpoch:0, operatorNonce:0 }, good);
    expect((await market.getJob(1)).operator).to.equal(await operator.getAddress());
  });

  it("settles delivery timeout to a pull-payment refund and returns reserved stake", async function () {
    const e = await deploy(); const { market, operator, client, token } = e;
    const other = (await ethers.getSigners())[5];
    await token.connect(operator).approve(await e.vault.getAddress(), 10n * U); await e.vault.connect(operator).depositStake(10n * U);
    await market.connect(operator).registerOperator();
    await post(e); const j=await market.getJob(1); const terms=j.canonicalTermsHash; const vb=BigInt(j.applyBy);
    await market.connect(client).awardJob(1,{jobId:1,operator:await operator.getAddress(),termsHash:terms,validAfter:0,validBefore:vb,nonceEpoch:0,operatorNonce:0},await signedApplication(market,operator,1n,terms,vb));
    await jump(2*86400+1); await market.connect(other).claimDeliveryTimeout(1,(await market.getJob(1)).stateVersion);
    expect(await market.credits(client)).to.equal(10n*U); expect(await market.activeJobs(operator)).to.equal(0n);
  });

  it("runs dispute settlement with independent arbiter and no client/operator conflict", async function () {
    const e=await deploy(); const {market,operator,client,arbiter,token,owner}=e;
    await token.connect(operator).approve(await e.vault.getAddress(),10n*U); await e.vault.connect(operator).depositStake(10n*U); await market.connect(operator).registerOperator(); await market.connect(owner).setResolverForClient(await client.getAddress(), await arbiter.getAddress()); await post(e);
    const j=await market.getJob(1), t=j.canonicalTermsHash, vb=BigInt(j.applyBy);
    await market.connect(client).awardJob(1,{jobId:1,operator:await operator.getAddress(),termsHash:t,validAfter:0,validBefore:vb,nonceEpoch:0,operatorNonce:0},await signedApplication(market,operator,1n,t,vb));
    const v=(await market.getJob(1)).stateVersion; await market.connect(operator).submitDelivery(1,h("blob"),v);
    await market.connect(client).openDispute(1,(await market.getJob(1)).stateVersion);
    await market.connect(arbiter).resolveDispute(1,4n*U,false,h("reason"),h("evidence"),(await market.getJob(1)).stateVersion);
    expect(await market.credits(client)).to.equal(6n*U); expect(await market.credits(operator)).to.equal(3_800_000n);
  });
});
