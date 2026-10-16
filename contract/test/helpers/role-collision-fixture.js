const { ethers } = require("hardhat");
const { deployV2Pair } = require("./deploy-v2-pair");
const { wrapMarket } = require("./v2-read-model");

const U = 1_000_000n;
const DAY = 86400;
const H = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
const ROLE_NAMES = ["client", "operator", "resolver", "house", "testClient", "owner", "treasury"];
const PATHS = ["post", "award", "dispute", "resolve", "recovery", "fault-review", "mutual", "timeout"];

async function deployRoleCollisionFixture(equalRoles) {
  const signers = await ethers.getSigners();
  const [owner, client, operator, resolver, house, testClient, treasury, outsider] = signers;
  const byRole = { client, operator, resolver, house, testClient, owner, treasury };
  const roles = { ...byRole };
  for (const role of equalRoles) roles[role] = byRole[equalRoles[0]];

  const Token = await ethers.getContractFactory("MockUSDC", owner);
  const token = await Token.deploy(); await token.waitForDeployment();
  const pair = await deployV2Pair({ token, owner, treasury: roles.treasury });
  const market = wrapMarket(pair.market); const vault = pair.vault;
  const all = [owner, client, operator, resolver, house, testClient, treasury, outsider];
  for (const s of all) { await (await token.mint(s.address, 50_000n * U)).wait(); }

  // The policy is explicit for every fixture; the default owner resolver is never relied on.
  const policyResolver = roles.resolver.address;
  await (await market.connect(owner).setResolverForClient(roles.client.address, policyResolver)).wait();
  await (await market.connect(owner).setTestClient(roles.testClient.address, true)).wait();
  if (roles.operator.address === roles.house.address) {
    await (await market.connect(owner).setHouse(roles.operator.address, true)).wait();
  }
  const op = roles.operator;
  await (await token.connect(op).approve(await vault.getAddress(), 1_000n * U)).wait();
  await (await vault.connect(op).depositStake(1_000n * U)).wait();
  await (await market.connect(op).registerOperator()).wait();
  return { owner, client, operator, resolver, house, testClient, treasury, outsider, roles, equalRoles, token, market, vault };
}

async function latest() { return (await ethers.provider.getBlock("latest")).timestamp; }
async function post(e, opts = {}) {
  const now = await latest();
  const reward = opts.reward ?? 10n * U;
  await (await e.token.connect(e.roles.client).approve(await e.market.getAddress(), reward)).wait();
  const tx = await e.market.connect(e.roles.client).postJob(
    reward, BigInt(opts.applyBy ?? now + 2 * DAY), BigInt(opts.delivery ?? 2 * DAY),
    BigInt(opts.review ?? 2 * DAY), BigInt(opts.revision ?? 12 * 3600), 2, false,
    H(`role-collision-criteria-${now}`), H(`role-collision-description-${now}`), false,
    opts.gasLimit ? { gasLimit: opts.gasLimit } : {},
  );
  const receipt = await tx.wait();
  const id = Number(await e.market.nextJobId()) - 1;
  return { id, receipt, job: await e.market.getJob(id) };
}
async function application(e, id) {
  const j = await e.market.getJob(id); const op = e.roles.operator; const net = await ethers.provider.getNetwork();
  const value = { jobId: BigInt(id), operator: op.address, termsHash: j.canonicalTermsHash, validAfter: 0, validBefore: j.applyBy, nonceEpoch: 0, operatorNonce: 0 };
  const types = { Application: [
    { name: "jobId", type: "uint256" }, { name: "operator", type: "address" }, { name: "termsHash", type: "bytes32" },
    { name: "validAfter", type: "uint64" }, { name: "validBefore", type: "uint64" }, { name: "nonceEpoch", type: "uint256" }, { name: "operatorNonce", type: "uint256" },
  ] };
  return { value, sig: await op.signTypedData({ name: "AlphaBoard Agent Marketplace V2", version: "1", chainId: net.chainId, verifyingContract: await e.market.getAddress() }, types, value) };
}
async function award(e, id, overrides = {}) { const a = await application(e, id); return (await e.market.connect(e.roles.client).awardJob(id, a.value, a.sig, overrides)).wait(); }
async function submit(e, id) { const j = await e.market.getJob(id); return (await e.market.connect(e.roles.operator).submitDelivery(id, H(`delivery-${id}`), j.stateVersion)).wait(); }
async function accounting(e) {
  const addresses = [...new Set(Object.values(e.roles).map((s) => s.address.toLowerCase()))];
  let free = 0n; let reserved = 0n; let credits = 0n;
  for (const a of addresses) { free += await e.vault.freeStake(a); reserved += await e.vault.reservedStake(a); credits += await e.market.credits(a); }
  if (free + reserved !== await e.vault.stakeLiability()) throw new Error("free+reserved liability mismatch");
  if (credits !== await e.market.creditsLiability()) throw new Error("credit liability mismatch");
  let escrow = 0n;
  for (let id = 1; id < Number(await e.market.nextJobId()); id++) { const j = await e.market.getJob(id); if (Number(j.status) <= 5) escrow += j.reward; }
  if (escrow !== await e.market.escrowed()) throw new Error("escrow liability mismatch");
  return { free, reserved, credits, escrow, vaultBalance: await e.token.balanceOf(await e.vault.getAddress()), marketBalance: await e.token.balanceOf(await e.market.getAddress()) };
}
async function advance(seconds) { await ethers.provider.send("evm_increaseTime", [seconds]); await ethers.provider.send("evm_mine"); }
module.exports = { U, DAY, H, ROLE_NAMES, PATHS, deployRoleCollisionFixture, post, application, award, submit, accounting, advance };
