const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { decodeJob } = require("./v2-read-model");

// Test-only, receipt-driven conservation audit.  It deliberately never changes
// contract state and never replaces a production getter.
const pairs = new Map();
const pending = new Map();
const auditedHashes = new Set();
let installed = false;
let internal = false;
let sequence = 0;
const root = path.resolve(__dirname, "../..");
const evidenceDir = path.join(root, "docs");
// Every test process gets an empty evidence document.  Never read or append to
// the stable historical artifact: two Mocha processes must not share a file.
const runId = `${new Date().toISOString().replace(/[-:.TZ]/g, "")}-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
const evidencePath = path.join(evidenceDir, `v2-receipt-accounting-evidence-${runId}.json`);
const sourceFiles = ["contracts/AgentMarketplaceV2.sol", "contracts/OperatorCollateralVaultV2.sol", "test/helpers/deploy-v2-pair.js"];
const FLUSH_BATCH_SIZE = 50;
let dirty = true;

function jsonValue(value) { return typeof value === "bigint" ? value.toString() : value; }
function stable(value) { return JSON.stringify(value, (_, v) => jsonValue(v)); }
function atomicWrite(file, content) {
  const temp = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(temp, content, { encoding: "utf8", flag: "wx" });
  fs.renameSync(temp, file);
}
const evidence = { schema: 2, scope: "test-only actual receipt/revert auditing", runId, sessions: [], receiptChecks: [], expectedRevertChecks: [], pairLedgerChecks: [] };
const session = { id: runId, startedAt: new Date().toISOString(), profile: process.env.V2_ARTIFACTS || "default", testTitle: "runtime Mocha test (captured at receipt)" };
evidence.sessions.push(session);
function persist() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  evidence.summary = {
    actualReceiptCount: evidence.receiptChecks.length,
    successfulReceiptCount: evidence.receiptChecks.filter((x) => x.status === 1).length,
    failedReceiptCount: evidence.receiptChecks.filter((x) => x.status === 0).length,
    expectedRevertAuditCount: evidence.expectedRevertChecks.length,
    expectedGasEstimateRejectionCount: evidence.expectedRevertChecks.filter((x) => x.method === "eth_estimateGas").length,
    separateLedgerCheckCount: evidence.pairLedgerChecks.filter((x) => x.ledger?.separate).length,
    jointLedgerCheckCount: evidence.pairLedgerChecks.filter((x) => x.ledger?.joint).length,
  };
  atomicWrite(evidencePath, JSON.stringify(evidence, (_, v) => jsonValue(v), 2) + "\n");
  dirty = false;
}
function markDirty() { dirty = true; }
async function flushEvidence() { if (dirty) persist(); }
function emergencyFlush() { try { if (dirty) persist(); } catch (_) { /* preserve the original process error */ } }
process.on("uncaughtException", emergencyFlush);
process.on("unhandledRejection", emergencyFlush);
process.on("beforeExit", emergencyFlush);
process.on("exit", emergencyFlush);
persist();

function sourceIdentity() {
  return sourceFiles.map((rel) => {
    const p = path.join(root, rel);
    return { path: rel, sha256: crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex") };
  });
}
async function registerPair({ token, market, vault, deploymentTxHashes = [] }) {
  const tokenAddress = typeof token === "string" ? token : token.target || token.address;
  const marketAddress = typeof market === "string" ? market : market.target || market.address;
  const vaultAddress = typeof vault === "string" ? vault : vault.target || vault.address;
  if (!tokenAddress || !marketAddress || !vaultAddress) throw new Error("v2 receipt auditor: incomplete pair registration");
  const key = `${tokenAddress}:${marketAddress}:${vaultAddress}`.toLowerCase();
  const entry = { key, token: ethers.getAddress(tokenAddress), market: ethers.getAddress(marketAddress), vault: ethers.getAddress(vaultAddress), deploymentTxHashes, registeredAt: Date.now() };
  pairs.set(key, entry);
  for (const hash of deploymentTxHashes) {
    const receipt = await ethers.provider.getTransactionReceipt(hash);
    if (receipt) await auditReceipt(hash, receipt);
  }
  return () => pairs.delete(key);
}
async function registerVault({ token, vault, deploymentTxHashes = [] }) {
  const tokenAddress = typeof token === "string" ? token : token.target || token.address;
  const vaultAddress = typeof vault === "string" ? vault : vault.target || vault.address;
  const key = `vault:${tokenAddress}:${vaultAddress}`.toLowerCase();
  const entry = { key, token: ethers.getAddress(tokenAddress), vault: ethers.getAddress(vaultAddress), deploymentTxHashes, vaultOnly: true, registeredAt: Date.now() };
  pairs.set(key, entry);
  for (const hash of deploymentTxHashes) {
    const receipt = await ethers.provider.getTransactionReceipt(hash);
    if (receipt) await auditReceipt(hash, receipt);
  }
  return () => pairs.delete(key);
}
function asBlockTag(tag) { return tag == null ? "latest" : tag; }
function c(address, abi) { return new ethers.Contract(address, abi, ethers.provider); }
const erc20Abi = ["function balanceOf(address) view returns (uint256)"];
const marketAbi = [
  "function nextJobId() view returns (uint256)", "function escrowed() view returns (uint256)", "function creditsLiability() view returns (uint256)",
  "function credits(address) view returns (uint256)", "function usdc() view returns (address)", "function collateralVault() view returns (address)",
];
const vaultAbi = ["function freeStake(address) view returns (uint256)", "function reservedStake(address) view returns (uint256)", "function stakeLiability() view returns (uint256)"];
const transferAbi = ["event Transfer(address indexed from,address indexed to,uint256 value)"];
const marketEvents = [
  "event JobPosted(uint256 indexed jobId,address indexed client,uint256 reward,uint64 applyBy,bytes32 criteriaHash,bytes32 descriptionHash,bool testJob,bool house)",
  "event JobAwarded(uint256 indexed jobId,address indexed operator,uint256 stake,bytes32 termsHash)",
  "event Settled(uint256 indexed jobId,uint256 grossPayout,uint256 refund,uint256 fee,address indexed operator)",
  "event CreditWithdrawn(address indexed account,uint256 amount)",
  "event StakeDeposited(address indexed operator,uint256 amount)",
  "event StakeWithdrawn(address indexed operator,uint256 amount)",
];
const marketEventIface = new ethers.Interface(marketEvents);
const transferIface = new ethers.Interface(transferAbi);

async function live(entry) {
  const checks = entry.vaultOnly ? [entry.token, entry.vault] : [entry.token, entry.market, entry.vault];
  for (const address of checks) if ((await ethers.provider.getCode(address)) === "0x") return false;
  return true;
}
async function actors(entry, blockTag) {
  const out = new Set((await ethers.getSigners()).map((s) => s.address.toLowerCase()));
  const fromBlock = 0;
  const addLogs = async (address, iface, topics) => {
    try {
      const logs = await ethers.provider.getLogs({ address, fromBlock, toBlock: blockTag, topics });
      for (const log of logs) {
        try { const parsed = iface.parseLog(log); for (const v of parsed.args) if (typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v)) out.add(v.toLowerCase()); } catch (_) {}
      }
    } catch (_) {}
  };
  if (!entry.vaultOnly) await addLogs(entry.market, marketEventIface, []);
  await addLogs(entry.token, transferIface, []);
  return [...out];
}
async function auditVault(entry, blockTag) {
  const token = c(entry.token, erc20Abi), vault = c(entry.vault, vaultAbi);
  const tag = asBlockTag(blockTag);
  const signers = await actors(entry, tag);
  let free = 0n, reserved = 0n;
  for (const a of signers) { free += await vault.freeStake(a, { blockTag: tag }); reserved += await vault.reservedStake(a, { blockTag: tag }); }
  const liability = await vault.stakeLiability({ blockTag: tag });
  const balance = await token.balanceOf(entry.vault, { blockTag: tag });
  if (free + reserved !== liability) throw new Error(`V2 receipt audit ${entry.key}: free+reserved != stakeLiability at block ${tag}`);
  if (balance < liability) throw new Error(`V2 receipt audit ${entry.key}: vault insolvent at block ${tag}`);
  return { free, reserved, stakeLiability: liability, vaultBalance: balance, vaultSurplus: balance - liability, separate: true };
}
async function auditPair(entry, blockTag) {
  const tag = asBlockTag(blockTag);
  const vaultLedger = await auditVault(entry, tag);
  const token = c(entry.token, erc20Abi), market = c(entry.market, marketAbi), vault = c(entry.vault, vaultAbi);
  const signers = await actors(entry, tag);
  let credits = 0n;
  for (const a of signers) credits += await market.credits(a, { blockTag: tag });
  const next = await market.nextJobId({ blockTag: tag });
  let escrow = 0n;
  const marketLike = { runner: ethers.provider, getAddress: async () => entry.market };
  for (let id = 1n; id < next; id++) {
    const j = await decodeJob(marketLike, id, tag);
    if (Number(j.status) <= 5) escrow += j.reward;
  }
  const balance = await token.balanceOf(entry.market, { blockTag: tag });
  const creditsLiability = await market.creditsLiability({ blockTag: tag });
  const escrowed = await market.escrowed({ blockTag: tag });
  if (credits !== creditsLiability) throw new Error(`V2 receipt audit ${entry.key}: actor credits != creditsLiability at block ${tag}`);
  if (escrow !== escrowed) throw new Error(`V2 receipt audit ${entry.key}: job escrow != escrowed at block ${tag}`);
  if (balance < escrow + creditsLiability) throw new Error(`V2 receipt audit ${entry.key}: market insolvent at block ${tag}`);
  const marketSurplus = balance - escrow - creditsLiability;
  const combinedLeft = balance + vaultLedger.vaultBalance;
  const combinedRight = escrow + creditsLiability + vaultLedger.stakeLiability + marketSurplus + vaultLedger.vaultSurplus;
  if (combinedLeft !== combinedRight) throw new Error(`V2 receipt audit ${entry.key}: combined conservation mismatch at block ${tag}`);
  return { ...vaultLedger, credits, creditsLiability, escrow, escrowed, marketBalance: balance, marketSurplus, combinedBalance: combinedLeft, combinedLiability: combinedRight, separate: true, joint: true };
}
async function relevantEntries(tx) {
  const to = (tx?.to || "").toLowerCase();
  const token = (tx?.token || "").toLowerCase();
  const out = [];
  for (const e of pairs.values()) if (await live(e) && (e.token.toLowerCase() === token || e.token.toLowerCase() === to || e.market?.toLowerCase() === to || e.vault.toLowerCase() === to)) out.push(e);
  return out;
}
async function auditReceipt(hash, receipt) {
  if (!receipt || receipt.blockNumber == null) return;
  if (auditedHashes.has(hash)) return;
  auditedHashes.add(hash);
  const tx = await ethers.provider.getTransaction(hash);
  const entries = await relevantEntries({ to: tx?.to || receipt.to, token: tx?.to || receipt.to });
  const results = [];
  for (const entry of entries) {
    const marketExists = entry.vaultOnly ? false : (await ethers.provider.getCode(entry.market, receipt.blockNumber)) !== "0x";
    const ledger = entry.vaultOnly || !marketExists ? await auditVault(entry, receipt.blockNumber) : await auditPair(entry, receipt.blockNumber);
    const code = async (address) => crypto.createHash("sha256").update(await ethers.provider.getCode(address, receipt.blockNumber)).digest("hex");
    const check = { id: ++sequence, session: session.id, hash, blockNumber: receipt.blockNumber, status: Number(receipt.status), pair: entry.key, profile: session.profile, codePair: { market: entry.market ? await code(entry.market) : null, vault: await code(entry.vault) }, sourceIdentity: sourceIdentity(), ledger, sameBlockStateLimitation: "block-tag reads are end-of-block state; intermediate transaction prefixes are not claimed" };
    evidence.pairLedgerChecks.push(check); results.push(check);
  }
  evidence.receiptChecks.push({ id: ++sequence, session: session.id, hash, blockNumber: receipt.blockNumber, status: Number(receipt.status), pairs: results.map((x) => x.pair), testTitle: session.testTitle });
  markDirty();
  if ((evidence.receiptChecks.length + evidence.expectedRevertChecks.length) % FLUSH_BATCH_SIZE === 0) persist();
}
const auditedMethods = new Set(["eth_estimateGas", "eth_sendTransaction", "eth_sendRawTransaction"]);
function requestTx(method, params) {
  if (method === "eth_sendRawTransaction") return ethers.Transaction.from(params?.[0] || "");
  const tx = params?.[0] || {};
  return { ...tx, to: tx.to || null };
}
async function snapshot(entry, blockTag = "latest") {
  const ledger = entry.vaultOnly ? await auditVault(entry, blockTag) : await auditPair(entry, blockTag);
  const jobs = [];
  if (!entry.vaultOnly) {
    const market = c(entry.market, marketAbi);
    const next = await market.nextJobId({ blockTag: asBlockTag(blockTag) });
    const marketLike = { runner: ethers.provider, getAddress: async () => entry.market };
    for (let id = 1n; id < next; id++) {
      const j = await decodeJob(marketLike, id, asBlockTag(blockTag));
      jobs.push({ id, reward: j.reward, status: j.status, stateVersion: j.stateVersion, stakeReserved: j.stakeReserved, faultReviewPending: j.faultReviewPending, faultReviewDeadline: j.faultReviewDeadline });
    }
  }
  return { block: blockTag, ledger, jobs, stateHash: crypto.createHash("sha256").update(stable({ ledger, jobs })).digest("hex") };
}
async function failedHash(error) {
  return error?.transactionHash || error?.data?.txHash || error?.data?.transactionHash || error?.error?.transactionHash || error?.error?.data?.txHash || null;
}
async function auditFailedRequest(method, params, error, before, entries) {
  if (!entries.length) return;
  const hash = await failedHash(error);
  let receipt = null;
  if (hash) receipt = await originalProviderRequest({ method: "eth_getTransactionReceipt", params: [hash] });
  if (receipt) await auditReceipt(hash, receipt);
  const afterBlock = receipt?.blockNumber ?? "latest";
  const checks = [];
  for (const row of before) {
    const post = await snapshot(row.entry, afterBlock);
    if (row.snapshot.stateHash !== post.stateHash) throw new Error(`V2 expected-revert audit changed ledger for ${row.entry.key}`);
    checks.push({ pair: row.entry.key, beforeBlock: row.snapshot.block, postBlock: afterBlock, preStateHash: row.snapshot.stateHash, postStateHash: post.stateHash, unchanged: true, minedFailedReceipt: !!receipt });
  }
  evidence.expectedRevertChecks.push({ id: ++sequence, session: session.id, method, target: requestTx(method, params).to || null, errorCode: error?.code || null, txHash: hash, checks, pairs: entries.map((x) => x.key), testTitle: session.testTitle });
  markDirty();
  if ((evidence.receiptChecks.length + evidence.expectedRevertChecks.length) % FLUSH_BATCH_SIZE === 0) persist();
}
let originalProviderRequest;
function install() {
  if (installed) return; installed = true;
  const provider = network.provider;
  const original = provider.request.bind(provider);
  originalProviderRequest = original;
  provider.request = async (args) => {
    const method = args.method;
    if (internal) return original(args);
    if (method === "hardhat_reset" || method === "evm_revert") {
      const result = await original(args); pairs.clear(); pending.clear(); auditedHashes.clear(); return result;
    }
    const shouldAuditFailure = auditedMethods.has(method);
    let before = [];
    let entries = [];
    if (shouldAuditFailure) {
      const tx = requestTx(method, args.params);
      entries = await relevantEntries(tx);
      if (entries.length) {
        internal = true;
        try { before = await Promise.all(entries.map(async (entry) => ({ entry, snapshot: await snapshot(entry, await ethers.provider.getBlockNumber()) }))); }
        finally { internal = false; }
      }
    }
    let result;
    try { result = await original(args); }
    catch (error) {
      if (shouldAuditFailure && entries.length) {
        internal = true;
        try { await auditFailedRequest(method, args.params, error, before, entries); }
        finally { internal = false; }
      }
      throw error;
    }
    try {
      if (method === "eth_sendTransaction" || method === "eth_sendRawTransaction") {
        const hash = result; pending.set(hash, true);
        const receipt = await original({ method: "eth_getTransactionReceipt", params: [hash] });
        if (receipt) { pending.delete(hash); await auditReceipt(hash, receipt); }
      } else if (method === "eth_getTransactionReceipt" && result) {
        const hash = args.params[0]; if (pending.has(hash)) { pending.delete(hash); await auditReceipt(hash, result); }
      } else if (method === "evm_mine") {
        for (const hash of [...pending.keys()]) {
          const receipt = await original({ method: "eth_getTransactionReceipt", params: [hash] });
          if (receipt) { pending.delete(hash); await auditReceipt(hash, receipt); }
        }
      }
      return result;
    } catch (error) { throw error; }
  };
  // Hardhat's ethers adapter may use either EIP-1193 request or its legacy
  // send facade. Route both through the same receipt hook.
  provider.send = (method, params) => provider.request({ method, params: params || [] });
}
install();
module.exports = { registerPair, registerVault, auditPair, auditVault, flushEvidence, evidencePath };
