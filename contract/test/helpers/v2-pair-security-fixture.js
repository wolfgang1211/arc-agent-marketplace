const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { deployV2Pair } = require("./deploy-v2-pair");
const { wrapMarket } = require("./v2-read-model");

const U = 1_000_000n;
const H = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
const NATIVE = ["contracts/AgentMarketplaceV2.sol", "contracts/OperatorCollateralVaultV2.sol"];

function sourceIdentity() {
  const root = path.resolve(__dirname, "../..");
  const files = [...NATIVE, "test/helpers/deploy-v2-pair.js"].map((rel) => {
    const p = path.join(root, rel);
    return [rel, crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex")];
  });
  const artifactRoot = process.env.V2_ARTIFACTS || "./artifacts-v2-runs50";
  const infoDir = path.resolve(root, artifactRoot, "build-info");
  const buildInfos = fs.readdirSync(infoDir).filter((f) => f.endsWith(".json")).map((f) => path.join(infoDir, f));
  const buildInfo = buildInfos.find((p) => {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    return !!j.output?.contracts?.[NATIVE[0]]?.AgentMarketplaceV2?.storageLayout;
  });
  const vaultBuildInfo = buildInfos.find((p) => !!JSON.parse(fs.readFileSync(p, "utf8")).output?.contracts?.[NATIVE[1]]?.OperatorCollateralVaultV2?.abi);
  if (!buildInfo || !vaultBuildInfo) throw new Error(`no current paired build-info in ${infoDir}`);
  return { files, buildInfo: [path.relative(root, buildInfo), path.relative(root, vaultBuildInfo)], artifactRoot };
}

async function deploySecurityFixture(TokenName = "V2AccountingToken") {
  const [owner, client, operator, otherOperator, treasury, alternateTreasury, outsider] = await ethers.getSigners();
  const Token = await ethers.getContractFactory(TokenName);
  const token = await Token.deploy();
  await token.waitForDeployment();
  const pair = await deployV2Pair({ token, owner, treasury });
  const market = wrapMarket(pair.market);
  const vault = pair.vault;
  for (const s of [owner, client, operator, otherOperator, treasury, alternateTreasury, outsider]) await (await token.mint(s.address, 2_000n * U)).wait();
  return { owner, client, operator, otherOperator, treasury, alternateTreasury, outsider, token, market, vault };
}

async function receipt(txPromise) {
  const tx = await txPromise;
  return tx.wait();
}
async function expectRevert(promise) {
  let reverted = false;
  try { await promise; } catch (_) { reverted = true; }
  if (!reverted) throw new Error("expected transaction revert");
}

async function pairLedger(e) {
  let free = 0n; let reserved = 0n; let credits = 0n;
  for (const s of [e.owner, e.client, e.operator, e.otherOperator, e.treasury, e.alternateTreasury, e.outsider]) {
    free += await e.vault.freeStake(s.address); reserved += await e.vault.reservedStake(s.address); credits += await e.market.credits(s.address);
  }
  let liveEscrow = 0n;
  for (let id = 1n; id < await e.market.nextJobId(); id++) {
    const j = await e.market.getJob(id);
    if (Number(j.status) <= 5) liveEscrow += j.reward;
  }
  const marketBalance = await e.token.balanceOf(await e.market.getAddress());
  const vaultBalance = await e.token.balanceOf(await e.vault.getAddress());
  const stakeLiability = await e.vault.stakeLiability();
  const creditsLiability = await e.market.creditsLiability();
  if (free + reserved !== stakeLiability) throw new Error("vault free+reserved != stakeLiability");
  if (credits !== creditsLiability) throw new Error("credit sum != creditsLiability");
  if (liveEscrow !== await e.market.escrowed()) throw new Error("job escrow != escrowed");
  if (marketBalance !== liveEscrow + creditsLiability + (marketBalance - liveEscrow - creditsLiability)) throw new Error("market conservation read failed");
  if (vaultBalance < stakeLiability) throw new Error("vault insolvent");
  return { free, reserved, credits, liveEscrow, marketBalance, vaultBalance, stakeLiability, creditsLiability, marketSurplus: marketBalance - liveEscrow - creditsLiability, vaultSurplus: vaultBalance - stakeLiability };
}

async function checked(e, action) {
  const before = await pairLedger(e);
  let receiptValue;
  try { receiptValue = await receipt(action()); } catch (err) { await pairLedger(e); throw err; }
  const after = await pairLedger(e);
  return { receipt: receiptValue, before, after };
}

async function checkedRevert(e, action) {
  const before = await pairLedger(e);
  await expectRevert(action());
  const after = await pairLedger(e);
  if (JSON.stringify(before, (_, v) => typeof v === "bigint" ? v.toString() : v) !== JSON.stringify(after, (_, v) => typeof v === "bigint" ? v.toString() : v)) throw new Error("revert changed pair ledger");
  return { before, after };
}

async function post(e, reward = U, tag = "security") {
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  await receipt(e.token.connect(e.client).approve(await e.market.getAddress(), reward));
  await checked(e, () => e.market.connect(e.client).postJob(reward, now + 2 * 86400, 3600, 24 * 3600, 12 * 3600, 2, false, H(`${tag}-criteria`), H(`${tag}-description`), false));
  return e.market.getJob(await e.market.nextJobId() - 1n);
}

async function stakeAndRegister(e, amount = 100n * U) {
  await receipt(e.token.connect(e.operator).approve(await e.vault.getAddress(), amount));
  await checked(e, () => e.vault.connect(e.operator).depositStake(amount));
  await checked(e, () => e.market.connect(e.operator).registerOperator());
}

async function award(e, id, job) {
  const net = await ethers.provider.getNetwork();
  const value = { jobId: id, operator: e.operator.address, termsHash: job.canonicalTermsHash, validAfter: 0, validBefore: job.applyBy, nonceEpoch: await e.market.nonceEpoch(e.operator), operatorNonce: await e.market.applicationNonce(id, e.operator.address) };
  const types = { Application: [{ name: "jobId", type: "uint256" }, { name: "operator", type: "address" }, { name: "termsHash", type: "bytes32" }, { name: "validAfter", type: "uint64" }, { name: "validBefore", type: "uint64" }, { name: "nonceEpoch", type: "uint256" }, { name: "operatorNonce", type: "uint256" }] };
  const sig = await e.operator.signTypedData({ name: "AlphaBoard Agent Marketplace V2", version: "1", chainId: net.chainId, verifyingContract: await e.market.getAddress() }, types, value);
  await checked(e, () => e.market.connect(e.client).awardJob(id, value, sig));
}

module.exports = { U, sourceIdentity, deploySecurityFixture, pairLedger, checked, checkedRevert, expectRevert, post, stakeAndRegister, award, receipt, H };
