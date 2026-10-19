/* Local-only V2 testnet rehearsal. Never run against a non-Hardhat provider. */
const hre = require("hardhat");
const { ethers } = hre;
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { wrapMarket } = require("../test/helpers/v2-read-model");

const U = 1_000_000n;
const DAY = 86400;
const H = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
const EVIDENCE = path.resolve(__dirname, "../docs/v2-testnet-local-evidence.json");
const ROLE_NAMES = ["deployer", "owner", "treasury", "resolver", "testOperator", "testClient2", "house", "testClient"];
const APP_TYPES = { Application: [
  { name: "jobId", type: "uint256" }, { name: "operator", type: "address" },
  { name: "termsHash", type: "bytes32" }, { name: "validAfter", type: "uint64" },
  { name: "validBefore", type: "uint64" }, { name: "nonceEpoch", type: "uint256" },
  { name: "operatorNonce", type: "uint256" },
] };

function localOnlyGuard(provider) {
  if (hre.network.name !== "hardhat") throw new Error("FAIL_CLOSED: local runner requires Hardhat network");
  if (provider !== undefined && provider !== ethers.provider) throw new Error("FAIL_CLOSED: provider is not Hardhat provider");
  return provider;
}
async function assertHardhatChain() {
  localOnlyGuard(ethers.provider);
  const n = await ethers.provider.getNetwork();
  if (n.chainId !== 31337n) throw new Error(`FAIL_CLOSED: unexpected local chainId ${n.chainId}`);
  const net = hre.config.networks?.hardhat;
  if (net?.forking) throw new Error("FAIL_CLOSED: forked Hardhat network is not permitted");
}

const evidence = {
  status: "running", mode: "LOCAL_HARDHAT_ONLY", chainId: "31337", source: "in-process Hardhat; no Arc RPC",
  command: "npx hardhat run --no-compile --config hardhat.v2.config.js --network hardhat scripts/e2e-v2-testnet-local.js",
  scenarios: [], receipts: [], expectedReverts: [], accounting: [], gasByRole: {}, checks: [],
};
function save() { fs.mkdirSync(path.dirname(EVIDENCE), { recursive: true }); fs.writeFileSync(EVIDENCE, `${JSON.stringify(evidence, (_, v) => typeof v === "bigint" ? v.toString() : v, 2)}\n`); }
function oneLine(e) { return String(e?.shortMessage || e?.reason || e?.message || e).split("\n")[0]; }
function addresses(c) { return Object.fromEntries(ROLE_NAMES.map((r) => [r, c[r].address])); }
async function blockTime() { return BigInt((await ethers.provider.getBlock("latest")).timestamp); }
async function advance(seconds) { await ethers.provider.send("evm_increaseTime", [Number(seconds)]); await ethers.provider.send("evm_mine"); }
async function job(c, id) { return c.market.getJob(id); }
async function jobView(c, id) { const j = await job(c, id); return { status: Number(j.status), stateVersion: j.stateVersion.toString(), operator: j.operator, client: j.client, reward: j.reward.toString(), reserved: j.stakeReserved.toString(), active: (await c.market.activeJobs(j.operator)).toString() }; }

async function audit(c, label) {
  let free = 0n, reserved = 0n, credits = 0n, active = 0n, jobsReserved = 0n, escrowJobs = 0n;
  for (const r of ROLE_NAMES) { free += await c.vault.freeStake(c[r].address); reserved += await c.vault.reservedStake(c[r].address); credits += await c.market.credits(c[r].address); active += await c.market.activeJobs(c[r].address); }
  const next = await c.market.nextJobId();
  for (let id = 1n; id < next; id++) { const j = await job(c, id); jobsReserved += j.stakeReserved; if (Number(j.status) < 6) escrowJobs += j.reward; }
  const mb = await c.token.balanceOf(c.market), vb = await c.token.balanceOf(c.vault);
  const escrow = await c.market.escrowed(), cl = await c.market.creditsLiability(), sl = await c.vault.stakeLiability();
  const ms = mb - escrow - cl, vs = vb - sl;
  assert.equal(free + reserved, sl, `${label}: stake liability`);
  assert.equal(jobsReserved, reserved, `${label}: job reserve`);
  assert.equal(credits, cl, `${label}: credits liability`);
  assert.equal(escrowJobs, escrow, `${label}: escrow liability`);
  assert.equal(ms, 0n, `${label}: unexpected market surplus`);
  assert.equal(vs, 0n, `${label}: unexpected vault surplus`);
  assert.equal(mb, escrow + cl, `${label}: market conservation`);
  assert.equal(vb, sl, `${label}: vault conservation`);
  const row = { label, marketBalance: mb, vaultBalance: vb, escrowed: escrow, creditsLiability: cl, freeStake: free, reservedStake: reserved, stakeLiability: sl, marketSurplus: ms, vaultSurplus: vs, activeJobs: active };
  evidence.accounting.push(row); save(); return row;
}
async function receipt(c, sent, label, scenario, ids = []) {
  const tx = await sent; const r = await tx.wait(); const rr = await ethers.provider.getTransactionReceipt(r.hash);
  assert(rr && Number(rr.status) === 1 && rr.hash === r.hash, `${label}: receipt readback`);
  const gas = rr.gasUsed;
  evidence.receipts.push({ scenario, label, hash: rr.hash, status: Number(rr.status), block: rr.blockNumber, gasUsed: gas.toString(), from: tx.from, jobs: Object.fromEntries(await Promise.all(ids.map(async (id) => [String(id), await jobView(c, id)]))) });
  const from = tx.from.toLowerCase(); const role = ROLE_NAMES.find((r) => c[r].address.toLowerCase() === from) || "unknown";
  evidence.gasByRole[role] = (BigInt(evidence.gasByRole[role] || 0) + gas).toString();
  await audit(c, `${scenario}:${label}`); save(); return r;
}
async function expectedRevert(c, fn, label, scenario, ids = []) {
  const before = await audit(c, `${scenario}:${label}:before`); const jBefore = Object.fromEntries(await Promise.all(ids.map(async (id) => [String(id), await jobView(c, id)])));
  let message = ""; try { await fn(); throw new Error("expected revert did not occur"); } catch (e) { message = oneLine(e); if (message === "expected revert did not occur") throw e; const data = e?.data || e?.error?.data || e?.info?.error?.data; if (typeof data !== "string" || !/^0x[0-9a-fA-F]{8,}$/.test(data)) throw new Error(`${label}: unexpected non-ABI revert`); }
  const after = await audit(c, `${scenario}:${label}:after`); const jAfter = Object.fromEntries(await Promise.all(ids.map(async (id) => [String(id), await jobView(c, id)])));
  assert.deepEqual(jAfter, jBefore, `${label}: job state changed on revert`); assert.deepEqual({ ...after, label: before.label }, before, `${label}: accounting changed on revert`);
  evidence.expectedReverts.push({ scenario, label, error: message, jobsBefore: jBefore, jobsAfter: jAfter }); save();
}
async function signed(c, id) {
  const j = await job(c, id), n = await ethers.provider.getNetwork();
  const value = { jobId: BigInt(id), operator: c.testOperator.address, termsHash: j.canonicalTermsHash, validAfter: 0, validBefore: BigInt(j.applyBy), nonceEpoch: await c.market.nonceEpoch(c.testOperator.address), operatorNonce: await c.market.applicationNonce(id, c.testOperator.address) };
  assert.equal(n.chainId, 31337n, "local signer chain");
  const domain = { name: "AlphaBoard Agent Marketplace V2", version: "1", chainId: 31337, verifyingContract: await c.market.getAddress() };
  const payload = JSON.stringify({ role: "testOperator", chainId: 31337, expectedAddress: c.testOperator.address, domain, value }, (_, x) => typeof x === "bigint" ? x.toString() : x);
  const signature = await new Promise((resolve, reject) => {
    const p = spawn("python", [path.resolve(__dirname, "keystore/sign-v2-local-application.py")], { stdio: ["pipe", "pipe", "pipe"] });
    let out = ""; p.stdout.on("data", (d) => { out += d; }); p.on("error", reject); p.on("close", (code) => { if (code !== 0) return reject(new Error("LOCAL_SIGN_FAILED")); const s = out.trim(); if (!/^0x[0-9a-fA-F]{130}$/.test(s)) return reject(new Error("LOCAL_SIGN_INVALID")); resolve(s); }); p.stdin.end(payload);
  });
  const recovered = ethers.verifyTypedData(domain, APP_TYPES, value, signature);
  assert.equal(recovered.toLowerCase(), c.testOperator.address.toLowerCase(), "keystore ECDSA recovery");
  return { value, signature };
}
async function post(c, scenario, client = c.testClient2, reward = 1n * U, delivery = 2 * DAY, testJob = false, operator = c.testOperator) {
  await receipt(c, c.token.connect(client).approve(c.market, reward), "approve-job", scenario);
  const now = await blockTime(); const id = await c.market.nextJobId();
  await receipt(c, c.market.connect(client).postJob(reward, now + 2n * BigInt(DAY), delivery, 2 * DAY, 12 * 3600, 2, false, H(`${scenario}:criteria`), H(`${scenario}:description`), testJob), "post-job", scenario, [id]);
  const j = await job(c, id); assert.equal(j.client, client.address); assert.equal(j.operator, ethers.ZeroAddress); return { id, client, operator };
}
async function award(c, x, scenario, operator = c.testOperator) {
  const j = await job(c, x.id), n = await ethers.provider.getNetwork();
  const v = { jobId: BigInt(x.id), operator: operator.address, termsHash: j.canonicalTermsHash, validAfter: 0, validBefore: BigInt(j.applyBy), nonceEpoch: await c.market.nonceEpoch(operator.address), operatorNonce: await c.market.applicationNonce(x.id, operator.address) };
  const sig = operator.address.toLowerCase() === c.house.address.toLowerCase() ? "0x" : (await signed(c, x.id)).signature; // house remains an explicitly-labelled local ERC-1271 simulation
  await receipt(c, c.market.connect(x.client).awardJob(x.id, v, sig), "award-job", scenario, [x.id]);
}

function buildInfo(contractSource, name) {
  const dir = path.resolve(__dirname, "..", hre.config.paths.artifacts, "build-info");
  const artifactPath = path.resolve(__dirname, "..", hre.config.paths.artifacts, contractSource, `${name}.json`); const desiredLength = JSON.parse(fs.readFileSync(artifactPath, "utf8")).deployedBytecode.length;
  const file = fs.readdirSync(dir).map((f) => path.join(dir, f)).find((f) => { try { const j = JSON.parse(fs.readFileSync(f)); const m = j.output?.contracts?.[contractSource]?.[name]; return !!m && `0x${m.evm.deployedBytecode.object}`.length === desiredLength; } catch { return false; } });
  if (!file) throw new Error(`missing build-info for ${name}`);
  const j = JSON.parse(fs.readFileSync(file)); const meta = j.output.contracts[contractSource][name]; return { ...meta, ast: Object.values(j.output.sources).map((x) => x.ast) };
}
function refs(meta) { return Object.entries(meta.evm.deployedBytecode.immutableReferences || {}).flatMap(([id, xs]) => xs.map((x) => ({ id, ...x })) ).sort((a, b) => a.start - b.start); }
function astImmutables(ast) { const out = new Map(); (function visit(x) { if (Array.isArray(x)) return x.forEach(visit); if (!x || typeof x !== "object") return; if (x.nodeType === "VariableDeclaration" && x.mutability === "immutable") out.set(String(x.id), { name: x.name, type: x.typeDescriptions.typeString }); Object.values(x).forEach(visit); })(ast); return out; }
function normalize(code, rs) { const b = Buffer.from(code.slice(2), "hex"); for (const { start, length } of rs) b.fill(0, start, start + length); return `0x${b.toString("hex")}`; }
function patch(code, rs, values) { const b = Buffer.from(code.slice(2), "hex"); for (const { id, start, length } of rs) { const v = Buffer.from(values.get(id).slice(2), "hex"); assert.equal(v.length, length); v.copy(b, start); } return `0x${b.toString("hex")}`; }
function encode(type, value, length) { if (type === "ShortString") { const text = ethers.toUtf8Bytes(value); return ethers.concat([ethers.zeroPadBytes(ethers.hexlify(text), length - 1), ethers.toBeHex(text.length, 1)]); } const abiType = /^contract /.test(type) ? "address" : type; const raw = ethers.AbiCoder.defaultAbiCoder().encode([abiType], [value]); return ethers.zeroPadValue(ethers.toBeHex(BigInt(raw)), length); }
async function attestPair(c) {
  const tokenAddress = await c.token.getAddress(); const marketAddress = await c.market.getAddress(); const vaultAddress = await c.vault.getAddress();
  const specs = [
    { source: "contracts/OperatorCollateralVaultV2.sol", name: "OperatorCollateralVaultV2", address: vaultAddress, expected: { token: tokenAddress, marketplace: marketAddress, treasury: c.treasury.address }, getter: c.vault },
    { source: "contracts/AgentMarketplaceV2.sol", name: "AgentMarketplaceV2", address: marketAddress, expected: { usdc: tokenAddress, collateralVault: vaultAddress, _cachedDomainSeparator: ethers.TypedDataEncoder.hashDomain({ name: "AlphaBoard Agent Marketplace V2", version: "1", chainId: 31337n, verifyingContract: marketAddress }), _cachedChainId: 31337n, _cachedThis: marketAddress, _hashedName: H("AlphaBoard Agent Marketplace V2"), _hashedVersion: H("1"), _name: "AlphaBoard Agent Marketplace V2", _version: "1" }, getter: c.market },
  ];
  for (const s of specs) {
    const meta = buildInfo(s.source, s.name), rs = refs(meta), vars = astImmutables(meta.ast); assert.equal(new Set(rs.map((r) => r.id)).size, Object.keys(meta.evm.deployedBytecode.immutableReferences || {}).length);
    const values = new Map(); const named = {};
    for (const r of rs) { const v = vars.get(r.id); assert(v, `${s.name}: immutable AST mapping missing`); assert(s.expected[v.name] !== undefined, `${s.name}: no manifest value for ${v.name}`); const expected = s.expected[v.name]; if (v.name === "usdc" || v.name === "collateralVault" || v.name === "token" || v.name === "marketplace" || v.name === "treasury") { const got = await s.getter[v.name](); assert.equal(ethers.getAddress(got), ethers.getAddress(expected), `${s.name}: getter ${v.name}`); } else if (v.name === "_name" || v.name === "_version") { assert.equal(typeof expected, "string"); } values.set(r.id, encode(v.type, expected, r.length)); named[v.name] = expected; }
    const observed = await ethers.provider.getCode(s.address), template = `0x${meta.evm.deployedBytecode.object}`;
    assert.equal(normalize(observed, rs), normalize(template, rs), `${s.name}: normalized runtime mismatch`);
    const expectedCode = patch(template, rs, values); if (observed.toLowerCase() !== expectedCode.toLowerCase()) { for (const r of rs) { const v = vars.get(r.id); const a = observed.slice(2 + r.start * 2, 2 + (r.start + r.length) * 2); const e = expectedCode.slice(2 + r.start * 2, 2 + (r.start + r.length) * 2); if (a !== e) console.error("immutable mismatch", s.name, v.name, v.type, r.start, a, e); } } assert.equal(observed.toLowerCase(), expectedCode.toLowerCase(), `${s.name}: patched runtime mismatch`);
    evidence.checks.push({ type: "immutable-runtime", contract: s.name, address: s.address, bytes: (observed.length - 2) / 2, templateHash: ethers.keccak256(template), normalizedHash: ethers.keccak256(normalize(observed, rs)), deployedHash: ethers.keccak256(observed), immutableValues: named });
  }
  assert.equal(await c.vault.marketplace(), marketAddress); assert.equal(await c.market.collateralVault(), vaultAddress); assert.equal(await c.vault.token(), tokenAddress); assert.equal(await c.vault.treasury(), c.treasury.address);
  evidence.checks.push({ type: "pair-readback", token: tokenAddress, market: marketAddress, vault: vaultAddress, treasury: c.treasury.address }); save();
}

async function setup() {
  await assertHardhatChain();
  const manifestPath = "C:/Users/wolfgang/AppData/Local/hermes/keys/alphaboard-testnet/roles-manifest.json";
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const publicAddresses = { ...Object.fromEntries(Object.entries(manifest.roles).map(([r, v]) => [r, ethers.getAddress(v.address)])), house: ethers.getAddress("0x843dD6a6153D73d17dAA5D7fB0e8E3e250A76505") };
  assert.equal(Object.keys(publicAddresses).length, 8); assert.equal(new Set(Object.values(publicAddresses).map((x) => x.toLowerCase())).size, 8, "role addresses must be unique");
  const c = {}; for (const r of ROLE_NAMES) { await ethers.provider.send("hardhat_setBalance", [publicAddresses[r], "0x3635C9ADC5DEA0000000000000000"]); await ethers.provider.send("hardhat_impersonateAccount", [publicAddresses[r]]); c[r] = await ethers.getSigner(publicAddresses[r]); }
  c.arbiter = c.resolver;
  const ss = await ethers.getSigners();
  const Funder = await ethers.getContractFactory("MockUSDC", ss[8] || ss[0]); const token = await Funder.deploy(); await token.waitForDeployment();
  const Wallet = await ethers.getContractFactory("V2SignatureWallet", ss[0]); const wallet = await Wallet.deploy(ss[0].address); await wallet.waitForDeployment(); const walletCode = await ethers.provider.getCode(await wallet.getAddress());
  await ethers.provider.send("hardhat_setCode", [c.house.address, walletCode]);
  const startNonce = await ethers.provider.getTransactionCount(c.deployer.address); assert.equal(startNonce, 0, "deployer nonce must be zero before pair deployment");
  const Vault = await ethers.getContractFactory("OperatorCollateralVaultV2", c.deployer); const Market = await ethers.getContractFactory("AgentMarketplaceV2", c.deployer);
  const expectedMarket = ethers.getCreateAddress({ from: c.deployer.address, nonce: 1 });
  const vault = await Vault.deploy(await token.getAddress(), expectedMarket, c.treasury.address); await vault.waitForDeployment();
  assert.equal(await ethers.provider.getTransactionCount(c.deployer.address), 1);
  const market = await Market.deploy(await token.getAddress(), c.deployer.address, c.treasury.address, await vault.getAddress()); await market.waitForDeployment();
  assert.equal(await vault.marketplace(), await market.getAddress()); assert.equal(await market.collateralVault(), await vault.getAddress());
  const pair = { market, vault }; c.token = token; c.market = wrapMarket(pair.market); c.vault = pair.vault;
  assert.equal(await ethers.provider.getTransactionCount(c.deployer.address), 2, "pair must be deployer nonce 0/1");
  for (const [label, sent] of [["deploy-vault", pair.vault.deploymentTransaction()], ["deploy-market", pair.market.deploymentTransaction()]]) { const r = await sent.wait(); const gas = (await ethers.provider.getTransactionReceipt(r.hash)).gasUsed; evidence.receipts.push({ scenario: "setup", label, hash: r.hash, status: Number(r.status), block: r.blockNumber, gasUsed: gas.toString(), from: c.deployer.address }); evidence.gasByRole.deployer = (BigInt(evidence.gasByRole.deployer || 0) + gas).toString(); }
  for (const [label, build] of [["set-resolver-client2", () => c.market.connect(c.deployer).setResolverForClient(c.testClient2.address, c.resolver.address)], ["set-resolver-client", () => c.market.connect(c.deployer).setResolverForClient(c.testClient.address, c.resolver.address)], ["set-house", () => c.market.connect(c.deployer).setHouse(c.house.address, true)], ["set-test-client", () => c.market.connect(c.deployer).setTestClient(c.testClient.address, true)], ["transfer-ownership", () => c.market.connect(c.deployer).transferOwnership(c.owner.address)]]) await receipt(c, build(), label, "setup");
  await receipt(c, c.market.connect(c.owner).acceptOwnership(), "accept-ownership", "setup");
  await receipt(c, c.market.connect(c.owner).setPolicy(1n * U, 500), "set-policy", "setup");
  assert.equal(await c.market.minReward(), 1n * U); assert.equal(await c.market.feeBps(), 500n); assert.equal(Number(await c.token.decimals()), 6);
  assert.equal(await c.market.owner(), c.owner.address); await assert.rejects(() => c.market.connect(c.deployer).setPolicy(U, 500), /Ownable/);
  const funding = { testOperator: 15n * U, testClient2: 5n * U, house: 5n * U, testClient: 1n * U };
  for (const [r, amount] of Object.entries(funding)) { const mint = await token.mint(c[r].address, amount); await mint.wait(); }
  for (const [r, amount] of [["testOperator", 15n * U], ["house", 5n * U]]) { await receipt(c, token.connect(c[r]).approve(c.vault, amount), `${r}-approve-stake`, "setup"); await receipt(c, c.vault.connect(c[r]).depositStake(amount), `${r}-deposit-stake`, "setup"); await receipt(c, c.market.connect(c[r]).registerOperator(), `${r}-register-operator`, "setup"); }
  evidence.checks.push({ type: "local-erc1271-simulation", addresses: [c.house.address], note: "House signature is local-only ERC-1271 simulation; testnet requires Yusuf-provided EOA signature" });
  evidence.checks.push({ type: "testOperator-signature", mode: "ECDSA-keystore-bound-31337", role: "testOperator", verifyingContract: "per-deployed-local-market", note: "signature bytes are kept out of evidence" });
  await attestPair(c); await audit(c, "setup"); return c;
}

async function scenario(c, name, fn) { const row = { name, status: "running" }; evidence.scenarios.push(row); save(); try { await fn(); row.status = "passed"; } catch (e) { row.status = "failed"; row.error = oneLine(e); save(); throw e; } save(); }
async function main() {
  await assertHardhatChain(); const c = await setup();
  await scenario(c, "normal-delivery-approve-withdraw", async () => { const x = await post(c, "normal"); await award(c, x, "normal"); let j = await job(c, x.id); await receipt(c, c.market.connect(c.testOperator).submitDelivery(x.id, H("normal-delivery"), j.stateVersion), "submit-delivery", "normal", [x.id]); j = await job(c, x.id); await receipt(c, c.market.connect(c.testClient2).approve(x.id, j.stateVersion), "approve", "normal", [x.id]); await receipt(c, c.market.connect(c.testOperator).withdrawCredit(), "operator-withdraw", "normal"); await receipt(c, c.market.connect(c.treasury).withdrawCredit(), "treasury-withdraw", "normal"); });
  await scenario(c, "revision-corrected-submit-approve", async () => { const x = await post(c, "revision"); await award(c, x, "revision"); let j = await job(c, x.id); await receipt(c, c.market.connect(c.testOperator).submitDelivery(x.id, H("bad"), j.stateVersion), "submit-bad", "revision", [x.id]); j = await job(c, x.id); await receipt(c, c.market.connect(c.testClient2).requestRevision(x.id, H("criterion"), H("reference"), j.stateVersion), "request-revision", "revision", [x.id]); j = await job(c, x.id); await receipt(c, c.market.connect(c.testOperator).submitRevision(x.id, H("corrected"), j.stateVersion), "submit-correction", "revision", [x.id]); j = await job(c, x.id); await receipt(c, c.market.connect(c.testClient2).approve(x.id, j.stateVersion), "approve", "revision", [x.id]); await receipt(c, c.market.connect(c.testOperator).withdrawCredit(), "operator-withdraw", "revision"); await receipt(c, c.market.connect(c.treasury).withdrawCredit(), "treasury-withdraw", "revision"); });
  await scenario(c, "delivery-timeout-refund-fault-review-slash", async () => { const x = await post(c, "timeout"); await award(c, x, "timeout"); let j = await job(c, x.id); await advance(2 * DAY + 1); await receipt(c, c.market.connect(c.arbiter).claimDeliveryTimeout(x.id, j.stateVersion), "claim-timeout", "timeout", [x.id]); j = await job(c, x.id); const slash = j.stakeReserved; assert.equal(slash, 5n * U); await receipt(c, c.market.connect(c.resolver).resolveFaultReview(x.id, slash, H("timeout-fault"), H("evidence"), j.stateVersion), "resolve-fault-review-full-slash", "timeout", [x.id]); const after = await job(c, x.id); assert.equal(after.stakeReserved, 0n); assert.equal(await c.vault.reservedStake(c.testOperator.address), 0n); assert.equal(await c.market.activeJobs(c.testOperator.address), 0n); assert.equal(await c.market.credits(c.testClient2.address), 6n * U); await expectedRevert(c, () => c.market.connect(c.resolver).resolveFaultReview(x.id, slash, H("again"), H("evidence"), after.stateVersion), "double-slash-revert", "timeout", [x.id]); await receipt(c, c.market.connect(c.testClient2).withdrawCredit(), "client-withdraw", "timeout"); });
  await scenario(c, "operator-fault-dispute-slash", async () => { const x = await post(c, "fault"); await award(c, x, "fault"); let j = await job(c, x.id); await receipt(c, c.market.connect(c.testOperator).openDispute(x.id, j.stateVersion), "operator-open-dispute", "fault", [x.id]); j = await job(c, x.id); await receipt(c, c.market.connect(c.resolver).resolveDispute(x.id, 500000n, true, H("fault"), H("evidence"), j.stateVersion), "resolve-operator-fault", "fault", [x.id]); assert.equal(await c.market.credits(c.testClient2.address), 5500000n); await receipt(c, c.market.connect(c.testClient2).withdrawCredit(), "client-withdraw", "fault"); await receipt(c, c.market.connect(c.treasury).withdrawCredit(), "treasury-withdraw", "fault"); await receipt(c, c.market.connect(c.testOperator).withdrawCredit(), "operator-withdraw", "fault"); });
  await scenario(c, "mutual-refund-no-fee-no-slash", async () => { const x = await post(c, "mutual"); await award(c, x, "mutual"); let j = await job(c, x.id); const expiry = (await blockTime()) + 2n * BigInt(DAY); await receipt(c, c.market.connect(c.testClient2).proposeMutual(x.id, 1n * U, 0, expiry, j.stateVersion), "propose-mutual", "mutual", [x.id]); j = await job(c, x.id); await receipt(c, c.market.connect(c.testOperator).acceptMutual(x.id, j.stateVersion, 1n), "accept-mutual", "mutual", [x.id]); await receipt(c, c.market.connect(c.testClient2).withdrawCredit(), "client-withdraw", "mutual"); });
  await scenario(c, "house-testjob-resolver-rejects", async () => { const x = await post(c, "house", c.testClient, 1n * U, 2 * DAY, true, c.house); const j0 = await job(c, x.id); const v = { jobId: BigInt(x.id), operator: c.house.address, termsHash: j0.canonicalTermsHash, validAfter: 0, validBefore: BigInt(j0.applyBy), nonceEpoch: await c.market.nonceEpoch(c.house.address), operatorNonce: 0n }; const sig = "0x"; await receipt(c, c.market.connect(x.client).awardJob(x.id, v, sig), "award-house", "house", [x.id]); let j = await job(c, x.id); await receipt(c, c.market.connect(c.testClient).openDispute(x.id, j.stateVersion), "open-dispute", "house", [x.id]); j = await job(c, x.id); await expectedRevert(c, () => c.market.connect(c.resolver).resolveDispute(x.id, 0, false, H("reject"), H("evidence"), j.stateVersion), "house-resolver-rejected-by-policy", "house", [x.id]); await advance(7 * DAY + 1); j = await job(c, x.id); await receipt(c, c.market.connect(c.arbiter).claimDisputeTimeout(x.id, j.stateVersion), "claim-dispute-timeout", "house", [x.id]); await receipt(c, c.market.connect(c.testClient).withdrawCredit(), "client-withdraw", "house"); });
  const final = await audit(c, "final"); const failed = evidence.scenarios.filter((x) => x.status !== "passed"); evidence.final = { status: failed.length ? "failed" : "passed", scenarioCount: evidence.scenarios.length, receiptCount: evidence.receipts.length, expectedRevertCount: evidence.expectedReverts.length, final, failedScenarios: failed }; evidence.status = evidence.final.status; save(); console.log(JSON.stringify(evidence.final, (_, v) => typeof v === "bigint" ? v.toString() : v, 2)); if (failed.length) process.exitCode = 1;
}
if (require.main === module) main().catch((e) => { evidence.status = "failed"; evidence.failure = e.stack || oneLine(e); save(); console.error(e.stack || e); process.exitCode = 1; });
module.exports = { runLocal: async (provider = ethers.provider) => { localOnlyGuard(provider); await assertHardhatChain(); return main(); }, localOnlyGuard };
