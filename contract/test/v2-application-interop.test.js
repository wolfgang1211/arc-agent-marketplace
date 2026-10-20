const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployV2Pair } = require("./helpers/deploy-v2-pair");
const { wrapMarket } = require("./helpers/v2-read-model");

const TYPES = { Application: [
  { name: "jobId", type: "uint256" }, { name: "operator", type: "address" },
  { name: "termsHash", type: "bytes32" }, { name: "validAfter", type: "uint64" },
  { name: "validBefore", type: "uint64" }, { name: "nonceEpoch", type: "uint256" },
  { name: "operatorNonce", type: "uint256" },
] };
const DOMAIN_NAME = "AlphaBoard Agent Marketplace V2";
const DOMAIN_VERSION = "1";
const U = 1_000_000n;
const hash = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));

async function fixture(withWallet = false) {
  const [owner, client, operator, treasury] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("MockUSDC");
  const token = await Token.deploy();
  const pair = await deployV2Pair({ token, owner, treasury });
  const market = wrapMarket(pair.market);
  for (const signer of [owner, client, operator, treasury]) await token.mint(signer.address, 1_000n * U);
  let wallet;
  if (withWallet) {
    const Wallet = await ethers.getContractFactory("V2SignatureWallet");
    wallet = await Wallet.deploy(owner.address);
    await token.mint(await wallet.getAddress(), 1_000n * U);
  }
  return { owner, client, operator, treasury, token, market, vault: pair.vault, wallet };
}
async function post(e) {
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  await e.token.connect(e.client).approve(e.market, 10n * U);
  await e.market.connect(e.client).postJob(10n * U, now + 2 * 86400, 2 * 86400, 86400, 43200, 2, false, hash("criteria"), hash("description"), false);
  return e.market.getJob(1);
}
async function register(e, signer) {
  await e.token.connect(signer).approve(e.vault, 100n * U);
  await e.vault.connect(signer).depositStake(100n * U);
  await e.market.connect(signer).registerOperator();
}
async function application(e, job, operator) {
  const net = await ethers.provider.getNetwork();
  const value = { jobId: 1n, operator, termsHash: job.canonicalTermsHash, validAfter: 0, validBefore: BigInt(job.applyBy), nonceEpoch: 0, operatorNonce: 0 };
  const domain = { name: DOMAIN_NAME, version: DOMAIN_VERSION, chainId: net.chainId, verifyingContract: await e.market.getAddress() };
  return { value, domain, signature: await e.operator.signTypedData(domain, TYPES, value) };
}

describe("V2 application EIP-712 interoperability", function () {
  it("matches ethers and viem digests and awardJob accepts the genuine EOA signature", async function () {
    const e = await fixture(); await register(e, e.operator); const job = await post(e); const signed = await application(e, job, e.operator.address);
    const ethersDigest = ethers.TypedDataEncoder.hash(signed.domain, TYPES, signed.value);
    const { hashTypedData } = await import("../../web/node_modules/viem/_esm/utils/signature/hashTypedData.js");
    const viemDigest = hashTypedData({ domain: signed.domain, types: TYPES, primaryType: "Application", message: signed.value });
    expect(viemDigest).to.equal(ethersDigest);
    expect(await e.market.connect(e.client).awardJob(1, signed.value, signed.signature)).to.be.ok;
    expect((await e.market.getJob(1)).operator).to.equal(e.operator.address);
  });

  it("accepts ERC1271 magic and rejects wrong magic and revoked EOA applications", async function () {
    const e = await fixture(true); const walletAddress = await e.wallet.getAddress();
    await e.wallet.execute(await e.token.getAddress(), 0, e.token.interface.encodeFunctionData("approve", [await e.vault.getAddress(), 100n * U]));
    await e.wallet.execute(await e.vault.getAddress(), 0, e.vault.interface.encodeFunctionData("depositStake", [100n * U]));
    await e.wallet.execute(await e.market.getAddress(), 0, e.market.interface.encodeFunctionData("registerOperator"));
    const job = await post(e);
    const t = { jobId: 1n, operator: walletAddress, termsHash: job.canonicalTermsHash, validAfter: 0, validBefore: BigInt(job.applyBy), nonceEpoch: 0, operatorNonce: 0 };
    expect(await e.market.connect(e.client).awardJob(1, t, "0x1234")).to.be.ok;
    const e2 = await fixture(true); const w2 = await e2.wallet.getAddress();
    await e2.wallet.execute(await e2.token.getAddress(), 0, e2.token.interface.encodeFunctionData("approve", [await e2.vault.getAddress(), 100n * U]));
    await e2.wallet.execute(await e2.vault.getAddress(), 0, e2.vault.interface.encodeFunctionData("depositStake", [100n * U]));
    await e2.wallet.execute(await e2.market.getAddress(), 0, e2.market.interface.encodeFunctionData("registerOperator"));
    const j2 = await post(e2); const bad = { ...t, operator: w2, termsHash: j2.canonicalTermsHash };
    await e2.wallet.setMode(1);
    await expect(e2.market.connect(e2.client).awardJob(1, bad, "0x1234")).to.be.reverted;
    const e3 = await fixture(); await register(e3, e3.operator); const j3 = await post(e3); const old = await application(e3, j3, e3.operator.address);
    await e3.market.connect(e3.operator).revokeApplication(1);
    await expect(e3.market.connect(e3.client).awardJob(1, old.value, old.signature)).to.be.reverted;
  });
});
