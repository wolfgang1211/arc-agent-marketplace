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

async function deploy(withWallet = false) {
  const [owner, client, op1, op2, treasury] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("MockUSDC");
  const token = await Token.deploy();
  const pair = await deployV2Pair({ token, owner, treasury });
  const market = wrapMarket(pair.market); const vault = pair.vault;
  let wallet;
  if (withWallet) {
    const Wallet = await ethers.getContractFactory("V2SignatureWallet");
    wallet = await Wallet.deploy(owner.address);
  }
  for (const s of [owner, client, op1, op2, treasury]) await token.mint(s.address, 1_000n * U);
  if (wallet) await token.mint(await wallet.getAddress(), 1_000n * U);
  const env = { owner, client, op1, op2, treasury, token, market, vault, wallet, markets: [market] };
  fixtures.push(env);
  return env;
}
async function post(e, options = {}) {
  const reward = options.reward ?? 10n * U;
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  const applyBy = options.applyBy ?? now + 2 * 86400;
  await e.token.connect(e.client).approve(e.market, reward);
  await e.market.connect(e.client).postJob(reward, applyBy, options.delivery ?? 2 * 86400, 24 * 3600, 12 * 3600, 2, false, options.criteria ?? H("criteria"), options.description ?? H("description"), false);
  return e.market.getJob(Number(await e.market.nextJobId()) - 1);
}
async function signApplication(e, signer, job, overrides = {}, market = e.market) {
  const net = await ethers.provider.getNetwork();
  const value = {
    jobId: overrides.jobId ?? 1n, operator: overrides.operator ?? signer.address,
    termsHash: overrides.termsHash ?? job.canonicalTermsHash, validAfter: overrides.validAfter ?? 0,
    validBefore: overrides.validBefore ?? BigInt(job.applyBy), nonceEpoch: overrides.nonceEpoch ?? await market.nonceEpoch(signer.address),
    operatorNonce: overrides.operatorNonce ?? await market.applicationNonce(overrides.jobId ?? 1n, signer.address),
  };
  const sig = await signer.signTypedData({ ...DOMAIN, chainId: net.chainId, verifyingContract: await market.getAddress() }, TYPES, value);
  return { value, sig };
}
async function registerAndStake(e, signer, amount = 100n * U) {
  await e.token.connect(signer).approve(e.vault, amount);
  await e.vault.connect(signer).depositStake(amount);
  await e.market.connect(signer).registerOperator();
}
async function walletCall(e, target, fragment, args = []) {
  const iface = target.interface;
  const data = iface.encodeFunctionData(fragment, args);
  return e.wallet.execute(await target.getAddress(), 0, data);
}
async function walletStakeAndRegister(e, amount = 100n * U) {
  await walletCall(e, e.token, "approve", [await e.vault.getAddress(), amount]);
  await walletCall(e, e.vault, "depositStake", [amount]);
  await walletCall(e, e.market, "registerOperator");
}
async function award(e, id, t, sig, market = e.market) { return market.connect(e.client).awardJob(id, t, sig, { gasLimit: 2_000_000 }); }
async function setTime(ts) {
  await ethers.provider.send("evm_setNextBlockTimestamp", [Number(ts)]);
}
async function assertConservation(e) {
  for (const market of e.markets) {
    let free = 0n, reserved = 0n, credits = 0n, escrow = 0n;
    const accounts = [e.owner, e.client, e.op1, e.op2, e.treasury];
    if (e.wallet) accounts.push({ address: await e.wallet.getAddress() });
    for (const s of accounts) { free += await market.freeStake(s.address); reserved += await market.reservedStake(s.address); credits += await market.credits(s.address); }
    for (let id = 1; id < Number(await market.nextJobId()); id++) {
      const j = await market.getJob(id); if (Number(j.status) <= 5) escrow += j.reward;
    }
    expect(free + reserved, "stake liability").to.equal(await market.stakeLiability());
    expect(credits, "credits liability").to.equal(await market.creditsLiability());
    expect(escrow, "escrowed").to.equal(await market.escrowed());
    expect(await e.token.balanceOf(market), "token conservation").to.equal(escrow + await market.liabilities() + await market.surplus());
  }
}

describe("AgentMarketplaceV2 Stage A signatures, smart wallets, replay, deadlines", function () {
  afterEach(async function () { for (const e of fixtures.splice(0)) await assertConservation(e); });

  it("registers and deposits stake through a smart-wallet execute adapter, then awards via valid ERC1271", async function () {
    const e = await deploy(true); await walletStakeAndRegister(e); const job = await post(e);
    const t = { jobId: 1n, operator: await e.wallet.getAddress(), termsHash: job.canonicalTermsHash, validAfter: 0, validBefore: BigInt(job.applyBy), nonceEpoch: 0, operatorNonce: 0 };
    await award(e, 1, t, "0x1234");
    expect((await e.market.getJob(1)).operator).to.equal(await e.wallet.getAddress());
    expect(await e.market.registered(await e.wallet.getAddress())).to.equal(true);
  });

  it("rejects ERC1271 wrong magic, revert, and short-return responses", async function () {
    const e = await deploy(true); await walletStakeAndRegister(e);
    for (const [mode, label] of [[1, "wrong magic"], [2, "revert"], [3, "short return"]]) {
      const job = await post(e, { criteria: H(label), description: H(label) });
      await e.wallet.setMode(mode);
      const t = { jobId: BigInt(Number(await e.market.nextJobId()) - 1), operator: await e.wallet.getAddress(), termsHash: job.canonicalTermsHash, validAfter: 0, validBefore: BigInt(job.applyBy), nonceEpoch: 0, operatorNonce: 0 };
      await expect(award(e, Number(t.jobId), t, "0x1234"), label).to.be.reverted;
      expect((await e.market.getJob(Number(t.jobId))).status).to.equal(0);
    }
  });

  it("blocks a malicious ERC1271 callback from state-writing/reentrant awarding under staticcall", async function () {
    const e = await deploy(true); await walletStakeAndRegister(e); const job = await post(e);
    const t = { jobId: 1n, operator: await e.wallet.getAddress(), termsHash: job.canonicalTermsHash, validAfter: 0, validBefore: BigInt(job.applyBy), nonceEpoch: 0, operatorNonce: 0 };
    const callback = e.market.interface.encodeFunctionData("awardJob", [1, t, "0x1234"]);
    await e.wallet.setCallback(await e.market.getAddress(), callback);
    await award(e, 1, t, "0x1234");
    expect((await e.market.getJob(1)).status).to.equal(1);
    expect(await e.market.nonceEpoch(await e.wallet.getAddress())).to.equal(0);
  });

  it("does not accept an ERC-6492-wrapped signature even when the operator is registered", async function () {
    const e = await deploy(); await registerAndStake(e, e.op1); const job = await post(e);
    const signed = await signApplication(e, e.op1, job);
    const wrapped = signed.sig + "64926492" + "00".repeat(32);
    await expect(award(e, 1, signed.value, wrapped)).to.be.reverted;
  });

  it("rejects cross-contract replay for identical job shape", async function () {
    const e = await deploy();
    const pair2 = await deployV2Pair({ token: e.token, owner: e.owner, treasury: e.treasury });
    const market2 = wrapMarket(pair2.market); const vault2 = pair2.vault; e.markets.push(market2);
    await registerAndStake(e, e.op1); await e.token.connect(e.op1).approve(vault2, 100n * U); await vault2.connect(e.op1).depositStake(100n * U); await market2.connect(e.op1).registerOperator();
    const j1 = await post(e); await e.token.connect(e.client).approve(market2, 10n * U); const now = (await ethers.provider.getBlock("latest")).timestamp;
    await market2.connect(e.client).postJob(10n * U, now + 2 * 86400, 2 * 86400, 24 * 3600, 12 * 3600, 2, false, H("criteria"), H("description"), false);
    const signed = await signApplication(e, e.op1, j1);
    const j2 = await market2.getJob(1); const t2 = { ...signed.value, termsHash: j2.canonicalTermsHash };
    await expect(market2.connect(e.client).awardJob(1, t2, signed.sig)).to.be.reverted;
  });

  it("rejects cross-job replay with same fields but distinct job id", async function () {
    const e = await deploy(); await registerAndStake(e, e.op1); const j1 = await post(e); const j2 = await post(e, { criteria: H("two"), description: H("two") });
    const signed = await signApplication(e, e.op1, j1);
    const t2 = { ...signed.value, jobId: 2n, termsHash: j2.canonicalTermsHash, validBefore: BigInt(j2.applyBy) };
    await expect(award(e, 2, t2, signed.sig)).to.be.reverted;
  });

  it("rejects wrong typed name, version, chain, and verifying contract", async function () {
    const e = await deploy(); await registerAndStake(e, e.op1); const job = await post(e); const good = await signApplication(e, e.op1, job); const net = await ethers.provider.getNetwork();
    const domains = [
      { name: "Wrong", version: "1" }, { ...DOMAIN, version: "2" },
      { ...DOMAIN, chainId: net.chainId + 1n }, { ...DOMAIN, verifyingContract: e.op2.address },
    ];
    for (const d of domains) {
      const sig = await e.op1.signTypedData({ ...d, chainId: d.chainId ?? net.chainId, verifyingContract: d.verifyingContract ?? await e.market.getAddress() }, TYPES, good.value);
      await expect(award(e, 1, good.value, sig)).to.be.reverted;
    }
  });

  it("revokes an old application and accepts only the newly signed application nonce", async function () {
    const e = await deploy(); await registerAndStake(e, e.op1); const job = await post(e); const old = await signApplication(e, e.op1, job);
    await e.market.connect(e.op1).revokeApplication(1);
    await expect(award(e, 1, old.value, old.sig)).to.be.reverted;
    const fresh = await signApplication(e, e.op1, job, { operatorNonce: 1n });
    await award(e, 1, fresh.value, fresh.sig);
  });

  it("invalidateAll kills all own posted applications but not another operator", async function () {
    const e = await deploy(); await registerAndStake(e, e.op1); await registerAndStake(e, e.op2); const j1 = await post(e); const j2 = await post(e, { criteria: H("two"), description: H("two") });
    const a1 = await signApplication(e, e.op1, j1); const a2 = await signApplication(e, e.op1, j2, { jobId: 2n }); const other = await signApplication(e, e.op2, j1);
    await e.market.connect(e.op1).invalidateAllApplications();
    await expect(award(e, 1, a1.value, a1.sig)).to.be.reverted; await expect(award(e, 2, a2.value, a2.sig)).to.be.reverted;
    await award(e, 1, other.value, other.sig);
  });

  it("does not let assigning job A invalidate the same operator's job B application", async function () {
    const e = await deploy(); await registerAndStake(e, e.op1); const j1 = await post(e); const j2 = await post(e, { criteria: H("B"), description: H("B") });
    const a1 = await signApplication(e, e.op1, j1); const a2 = await signApplication(e, e.op1, j2, { jobId: 2n });
    await award(e, 1, a1.value, a1.sig); await award(e, 2, a2.value, a2.sig);
    expect(await e.market.activeJobs(e.op1.address)).to.equal(2n);
  });

  it("rejects award replay and leaves balances, reservations, and escrow unchanged", async function () {
    const e = await deploy(); await registerAndStake(e, e.op1); const job = await post(e); const signed = await signApplication(e, e.op1, job); await award(e, 1, signed.value, signed.sig);
    const before = await Promise.all([e.token.balanceOf(e.market), e.market.escrowed(), e.market.stakeLiability(), e.market.creditsLiability(), e.market.freeStake(e.op1.address), e.market.reservedStake(e.op1.address)]);
    await expect(award(e, 1, signed.value, signed.sig)).to.be.reverted;
    const after = await Promise.all([e.token.balanceOf(e.market), e.market.escrowed(), e.market.stakeLiability(), e.market.creditsLiability(), e.market.freeStake(e.op1.address), e.market.reservedStake(e.op1.address)]);
    expect(after).to.deep.equal(before);
  });

  it("sets delivery deadline to exact award block timestamp plus original duration", async function () {
    const e = await deploy(); await registerAndStake(e, e.op1); const job = await post(e, { delivery: 3 * 86400 }); const signed = await signApplication(e, e.op1, job);
    const tx = await award(e, 1, signed.value, signed.sig); const receipt = await tx.wait(); const block = await ethers.provider.getBlock(receipt.blockNumber);
    expect((await e.market.getJob(1)).deliveryDeadline).to.equal(BigInt(block.timestamp + 3 * 86400));
  });

  it("covers applyBy D-1 success, D exact rejection, and D+1 rejection", async function () {
    for (const [label, offset, valid] of [["D-1", -1, true], ["D", 0, false], ["D+1", 1, false]]) {
      const e = await deploy(); await registerAndStake(e, e.op1); const now = (await ethers.provider.getBlock("latest")).timestamp; const job = await post(e, { applyBy: now + 86400 });
      const target = BigInt(job.applyBy) + BigInt(offset); await setTime(target); const signed = await signApplication(e, e.op1, job, { validBefore: BigInt(job.applyBy) });
      if (valid) await expect(award(e, 1, signed.value, signed.sig), label).to.not.be.reverted; else await expect(award(e, 1, signed.value, signed.sig), label).to.be.reverted;
    }
  });

  it("covers validAfter D-1 success, D exact success, and D+1 rejection", async function () {
    for (const [label, delta, valid] of [["D-1", -1, false], ["D", 0, true], ["D+1", 1, true]]) {
      const e = await deploy(); await registerAndStake(e, e.op1); const job = await post(e);
      const d = BigInt((await ethers.provider.getBlock("latest")).timestamp + 10);
      const target = d + BigInt(delta); await setTime(target);
      const signed = await signApplication(e, e.op1, job, { validAfter: d, validBefore: BigInt(job.applyBy) });
      let block;
      if (valid) {
        const receipt = await (await award(e, 1, signed.value, signed.sig)).wait();
        block = await ethers.provider.getBlock(receipt.blockNumber);
      } else {
        await expect(award(e, 1, signed.value, signed.sig)).to.be.revertedWithCustomError(e.market, "InvalidSignature");
        block = await ethers.provider.getBlock("latest");
      }
      expect(block.timestamp, `${label} mined timestamp`).to.equal(Number(target));
      if (valid) expect((await e.market.getJob(1)).status).to.equal(1n);
    }
  });

  it("rejects validBefore after applyBy with InvalidSignature and no state or balance change", async function () {
    const e = await deploy(); await registerAndStake(e, e.op1); const job = await post(e);
    const before = await Promise.all([
      e.token.balanceOf(e.market), e.market.escrowed(), e.market.stakeLiability(), e.market.creditsLiability(),
      e.market.freeStake(e.op1.address), e.market.reservedStake(e.op1.address), e.market.activeJobs(e.op1.address),
      e.market.getJob(1),
    ]);
    const signed = await signApplication(e, e.op1, job, { validBefore: BigInt(job.applyBy) + 1n });
    await expect(award(e, 1, signed.value, signed.sig)).to.be.revertedWithCustomError(e.market, "InvalidSignature");
    const after = await Promise.all([
      e.token.balanceOf(e.market), e.market.escrowed(), e.market.stakeLiability(), e.market.creditsLiability(),
      e.market.freeStake(e.op1.address), e.market.reservedStake(e.op1.address), e.market.activeJobs(e.op1.address),
      e.market.getJob(1),
    ]);
    expect(after).to.deep.equal(before);
  });

  it("covers validBefore D-1 success, D exact rejection, and D+1 rejection", async function () {
    for (const [label, delta, valid] of [["D-1", -1, true], ["D", 0, false], ["D+1", 1, false]]) {
      const e = await deploy(); await registerAndStake(e, e.op1); const job = await post(e); const validBefore = BigInt((await ethers.provider.getBlock("latest")).timestamp + 10);
      await setTime(validBefore + BigInt(delta)); const signed = await signApplication(e, e.op1, job, { validAfter: 0, validBefore });
      if (valid) await expect(award(e, 1, signed.value, signed.sig), label).to.not.be.reverted; else await expect(award(e, 1, signed.value, signed.sig), label).to.be.reverted;
    }
  });
});
