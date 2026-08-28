const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
require("dotenv").config();
const { normalizePrivateKey } = require("../lib/deploy-preflight");

const ROOT = path.join(__dirname, "..");
const STATE_PATH = path.join(ROOT, "deployment-runs", "arc-testnet-verification.json");
const SECRET_DIR = path.join(ROOT, ".deployment-secrets");
const SECRET_PATH = path.join(SECRET_DIR, "arc-verification-agent.json");
const MARKET_ARTIFACT = require("../artifacts/contracts/AgentMarketplace.sol/AgentMarketplace.json");
const USDC_ADDRESS = "0x3600000000000000000000000000000000000000";
const EXPECTED_CHAIN_ID = 5042002n;
const STAKE = 100_000000n;
const REWARD = 5_000000n;
const GIFT = 5_000000n;
const PROBE_FUND = 500000n;
const PROBE_RETURN = 10000n;
const AGENT_TOPUP = 100_500000n;
const SCALE = 10n ** 12n;
const MARKET_ADDRESS = "0x3b03D4Aa1bf568bE7fAC6fF9Dad2aEE9c9C057a4";
const USDC_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

function loadState() {
  return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
}
function saveState(state) {
  const temp = `${STATE_PATH}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(temp, STATE_PATH);
}
function ensureArrays(state) {
  state.scenarios.transactions ??= [];
  state.scenarios.expectedFailures ??= [];
  state.scenarios.completedSteps ??= [];
  state.scenarios.findings ??= [];
  state.scenarios.jobs ??= {};
}
function complete(state, step) {
  if (!state.scenarios.completedSteps.includes(step)) state.scenarios.completedSteps.push(step);
  saveState(state);
}
function finding(state, name, data) {
  const existing = state.scenarios.findings.find((x) => x.name === name);
  if (existing) Object.assign(existing, data);
  else state.scenarios.findings.push({ name, ...data });
  saveState(state);
}
function txRecord(state, label) {
  return state.scenarios.transactions.find((x) => x.label === label);
}
async function executeTx(state, label, estimate, send, provider) {
  let record = txRecord(state, label);
  if (record?.receiptStatus === 1) return record;
  if (record?.hash) {
    const receipt = await provider.waitForTransaction(record.hash);
    record.receiptStatus = receipt.status;
    record.actualGas = receipt.gasUsed.toString();
    record.effectiveGasPriceWei = receipt.gasPrice.toString();
    record.actualFeeWei = (receipt.gasUsed * receipt.gasPrice).toString();
    record.blockNumber = receipt.blockNumber;
    saveState(state);
    if (receipt.status !== 1) throw new Error(`${label} resumed with receipt.status=${receipt.status}`);
    return record;
  }
  const estimatedGas = await estimate();
  const tx = await send();
  record = { label, hash: tx.hash, estimatedGas: estimatedGas.toString(), receiptStatus: "PENDING" };
  state.scenarios.transactions.push(record);
  saveState(state);
  const receipt = await tx.wait();
  record.receiptStatus = receipt.status;
  record.actualGas = receipt.gasUsed.toString();
  record.gasDeviation = (receipt.gasUsed - estimatedGas).toString();
  record.effectiveGasPriceWei = receipt.gasPrice.toString();
  record.actualFeeWei = (receipt.gasUsed * receipt.gasPrice).toString();
  record.blockNumber = receipt.blockNumber;
  saveState(state);
  console.log(`${label}: ${tx.hash} status=${receipt.status} gas=${estimatedGas}/${receipt.gasUsed}`);
  if (receipt.status !== 1) throw new Error(`${label} failed with receipt.status=${receipt.status}`);
  return record;
}
async function balances(provider, token, address) {
  const [native, erc20] = await Promise.all([provider.getBalance(address), token.balanceOf(address)]);
  return { nativeRaw: native, erc20Raw: erc20 };
}
function loadOrCreateAgent(state) {
  fs.mkdirSync(SECRET_DIR, { recursive: true });
  if (fs.existsSync(SECRET_PATH)) {
    const secret = JSON.parse(fs.readFileSync(SECRET_PATH, "utf8"));
    const wallet = new ethers.Wallet(secret.privateKey);
    if (state.scenarios.agentAddress && wallet.address.toLowerCase() !== state.scenarios.agentAddress.toLowerCase()) {
      throw new Error("Stored agent secret does not match persisted agentAddress");
    }
    return wallet;
  }
  if (state.scenarios.agentAddress) throw new Error("Agent address exists but ignored secret file is missing");
  const wallet = ethers.Wallet.createRandom();
  fs.writeFileSync(SECRET_PATH, `${JSON.stringify({ privateKey: wallet.privateKey })}\n`, { mode: 0o600 });
  state.scenarios.agentAddress = wallet.address;
  saveState(state);
  return wallet;
}
async function postJob(state, key, description, clientMarket, provider) {
  if (state.scenarios.jobs[key]?.id) return BigInt(state.scenarios.jobs[key].id);
  const id = (await clientMarket.jobCount()) + 1n;
  await executeTx(
    state,
    `postJob:${key}`,
    () => clientMarket["postJob(string,uint256,string)"].estimateGas(description, REWARD, "verification"),
    () => clientMarket["postJob(string,uint256,string)"](description, REWARD, "verification"),
    provider,
  );
  const job = await clientMarket.jobs(id);
  if (job.id !== id || job.reward !== REWARD || job.status !== 0n) throw new Error(`postJob ${key} on-chain mismatch`);
  state.scenarios.jobs[key] = { id: id.toString(), expectedStatus: "Open" };
  saveState(state);
  return id;
}
async function expectTimeoutRevert(state, label, market, jobId, provider, expectedText) {
  if (state.scenarios.expectedFailures.some((x) => x.label === label)) return;
  const block = await provider.getBlock("latest");
  try {
    await market.claimTimeout.staticCall(jobId);
    throw new Error(`${label} unexpectedly succeeded`);
  } catch (error) {
    const text = error.shortMessage || error.reason || error.message;
    if (!String(text).includes(expectedText)) throw error;
    state.scenarios.expectedFailures.push({
      label,
      kind: "eth_call",
      blockNumber: block.number,
      blockTimestamp: block.timestamp,
      expectedRevert: expectedText,
      observed: text,
    });
    saveState(state);
    console.log(`${label}: expected revert observed: ${expectedText}`);
  }
}
async function waitUntil(provider, timestamp, label) {
  while (true) {
    const block = await provider.getBlock("latest");
    if (BigInt(block.timestamp) >= timestamp) return block;
    const remaining = Number(timestamp - BigInt(block.timestamp));
    console.log(`${label}: waiting ${remaining}s (chain timestamp ${block.timestamp})`);
    await new Promise((resolve) => setTimeout(resolve, Math.min(30, Math.max(5, remaining)) * 1000));
  }
}
async function main() {
  const state = loadState();
  ensureArrays(state);
  if (state.deployment.address.toLowerCase() !== MARKET_ADDRESS.toLowerCase() || state.attestation.accepted !== true) {
    throw new Error("Persisted deployment is not the accepted verification contract");
  }
  const rpc = process.env.ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.network";
  const provider = new ethers.JsonRpcProvider(rpc);
  const deployer = new ethers.Wallet(normalizePrivateKey(process.env.PRIVATE_KEY), provider);
  const network = await provider.getNetwork();
  if (network.chainId !== EXPECTED_CHAIN_ID) throw new Error(`Wrong chain ${network.chainId}`);
  const agent = loadOrCreateAgent(state).connect(provider);
  const tokenClient = new ethers.Contract(USDC_ADDRESS, USDC_ABI, deployer);
  const tokenAgent = new ethers.Contract(USDC_ADDRESS, USDC_ABI, agent);
  const marketClient = new ethers.Contract(MARKET_ADDRESS, MARKET_ARTIFACT.abi, deployer);
  const marketAgent = new ethers.Contract(MARKET_ADDRESS, MARKET_ARTIFACT.abi, agent);
  const initial = await balances(provider, tokenClient, deployer.address);
  finding(state, "funding-preflight", {
    blockNumber: await provider.getBlockNumber(),
    deployer: deployer.address,
    nativeRaw: initial.nativeRaw.toString(),
    erc20Raw: initial.erc20Raw.toString(),
    nativeUsdc: ethers.formatUnits(initial.nativeRaw, 18),
    erc20Usdc: ethers.formatUnits(initial.erc20Raw, 6),
  });
  if (initial.erc20Raw < 128_000000n && !state.scenarios.completedSteps.includes("funding-preflight")) {
    throw new Error(`Need 128 USDC before run; have ${ethers.formatUnits(initial.erc20Raw, 6)}`);
  }
  complete(state, "funding-preflight");

  // Arc native/ERC20 equivalence gate. No stake may be sent before this completes.
  if (!state.scenarios.completedSteps.includes("arc-asset-gate")) {
    await executeTx(state, "assetGate:fundAgent0.5", () => tokenClient.transfer.estimateGas(agent.address, PROBE_FUND), () => tokenClient.transfer(agent.address, PROBE_FUND), provider);
    const funded = await balances(provider, tokenClient, agent.address);
    if (funded.nativeRaw / SCALE !== funded.erc20Raw) {
      throw new Error(`Arc asset scale mismatch before stake: native/1e12=${funded.nativeRaw / SCALE}, erc20=${funded.erc20Raw}`);
    }
    const beforeReturn = funded;
    const returned = await executeTx(state, "assetGate:return0.01", () => tokenAgent.transfer.estimateGas(deployer.address, PROBE_RETURN), () => tokenAgent.transfer(deployer.address, PROBE_RETURN), provider);
    const afterReturn = await balances(provider, tokenClient, agent.address);
    const fee = BigInt(returned.actualFeeWei);
    if (beforeReturn.nativeRaw - afterReturn.nativeRaw !== PROBE_RETURN * SCALE + fee) {
      throw new Error("Second-wallet native balance did not reconcile transfer plus gas");
    }
    if (beforeReturn.erc20Raw - afterReturn.erc20Raw < PROBE_RETURN) {
      throw new Error("Second-wallet ERC20 balance did not debit the return transfer");
    }
    finding(state, "arc-native-erc20-equivalence", {
      accepted: true,
      agentAddress: agent.address,
      beforeSpend: { nativeRaw: beforeReturn.nativeRaw.toString(), erc20Raw: beforeReturn.erc20Raw.toString(), scaledEqual: true },
      probeTx: returned.hash,
      probeReceiptStatus: returned.receiptStatus,
      probeActualFeeWei: returned.actualFeeWei,
      afterSpend: { nativeRaw: afterReturn.nativeRaw.toString(), erc20Raw: afterReturn.erc20Raw.toString() },
    });
    state.scenarios.preStakeArcAssetGate.status = "ACCEPTED";
    complete(state, "arc-asset-gate");
  }

  // Reversible workflows first.
  if (!state.scenarios.completedSteps.includes("agent-funded")) {
    await executeTx(state, "fundAgent:100.5", () => tokenClient.transfer.estimateGas(agent.address, AGENT_TOPUP), () => tokenClient.transfer(agent.address, AGENT_TOPUP), provider);
    if ((await tokenAgent.balanceOf(agent.address)) < STAKE) throw new Error("Agent funding below stake");
    complete(state, "agent-funded");
  }
  if (!state.scenarios.completedSteps.includes("registered-first")) {
    await executeTx(state, "agentApproveStake:first", () => tokenAgent.approve.estimateGas(MARKET_ADDRESS, STAKE), () => tokenAgent.approve(MARKET_ADDRESS, STAKE), provider);
    await executeTx(state, "registerAgent:first", () => marketAgent.registerAgent.estimateGas("Arc verification agent", "verification", 0), () => marketAgent.registerAgent("Arc verification agent", "verification", 0), provider);
    const a = await marketClient.getAgent(agent.address);
    if (!a.registered || a.stake !== STAKE) throw new Error("First registration mismatch");
    complete(state, "registered-first");
  }
  if (!state.scenarios.completedSteps.includes("client-approved-rewards")) {
    await executeTx(state, "clientApproveRewards:25", () => tokenClient.approve.estimateGas(MARKET_ADDRESS, 25_000000n), () => tokenClient.approve(MARKET_ADDRESS, 25_000000n), provider);
    complete(state, "client-approved-rewards");
  }

  const happyId = await postJob(state, "happy", "Arc verification happy path", marketClient, provider);
  if (!state.scenarios.completedSteps.includes("happy-complete")) {
    await executeTx(state, "happy:accept", () => marketAgent.acceptJob.estimateGas(happyId), () => marketAgent.acceptJob(happyId), provider);
    await executeTx(state, "happy:submit", () => marketAgent.submitDeliverable.estimateGas(happyId, "ipfs://arc-verification-happy"), () => marketAgent.submitDeliverable(happyId, "ipfs://arc-verification-happy"), provider);
    const receiptRecord = await executeTx(state, "happy:approveAndPay", () => marketClient.approveAndPay.estimateGas(happyId), () => marketClient.approveAndPay(happyId), provider);
    const receipt = await provider.getTransactionReceipt(receiptRecord.hash);
    const parsed = receipt.logs.map((l) => { try { return marketClient.interface.parseLog(l); } catch { return null; } }).find((x) => x?.name === "JobApproved");
    if (!parsed || parsed.args[2] !== 4_500000n) throw new Error("Happy payout event is not exact 4.5 USDC");
    if ((await marketClient.jobs(happyId)).status !== 4n) throw new Error("Happy job not completed");
    complete(state, "happy-complete");
  }

  if (!state.scenarios.completedSteps.includes("donation-sent")) {
    state.scenarios.donationBaseline = {
      slashSink: (await marketClient.slashSinkBalance()).toString(),
      feeSink: (await marketClient.reputationFeeSinkBalance()).toString(),
      contractBalance: (await tokenClient.balanceOf(MARKET_ADDRESS)).toString(),
    };
    saveState(state);
    await executeTx(state, "donation:transfer5", () => tokenClient.transfer.estimateGas(MARKET_ADDRESS, GIFT), () => tokenClient.transfer(MARKET_ADDRESS, GIFT), provider);
    complete(state, "donation-sent");
  }
  const donationId = await postJob(state, "donation", "Arc verification donation accounting", marketClient, provider);
  if (!state.scenarios.completedSteps.includes("donation-complete")) {
    await executeTx(state, "donation:accept", () => marketAgent.acceptJob.estimateGas(donationId), () => marketAgent.acceptJob(donationId), provider);
    await executeTx(state, "donation:submit", () => marketAgent.submitDeliverable.estimateGas(donationId, "ipfs://arc-verification-donation"), () => marketAgent.submitDeliverable(donationId, "ipfs://arc-verification-donation"), provider);
    const approve = await executeTx(state, "donation:approveAndPay", () => marketClient.approveAndPay.estimateGas(donationId), () => marketClient.approveAndPay(donationId), provider);
    const receipt = await provider.getTransactionReceipt(approve.hash);
    const parsed = receipt.logs.map((l) => { try { return marketClient.interface.parseLog(l); } catch { return null; } }).find((x) => x?.name === "JobApproved");
    if (!parsed || parsed.args[2] !== REWARD) throw new Error("Repeat-client donation workflow payout not exact 5 USDC");
    if ((await marketClient.slashSinkBalance()).toString() !== state.scenarios.donationBaseline.slashSink) throw new Error("Donation changed slash sink");
    if ((await marketClient.reputationFeeSinkBalance()).toString() !== state.scenarios.donationBaseline.feeSink) throw new Error("Donation/repeat workflow changed fee sink");
    const rep = await marketClient.getAgentReputation(agent.address);
    if (rep[0] !== 1n) throw new Error("Donation workflow changed distinct-client reputation");
    complete(state, "donation-complete");
  }
  if (!state.scenarios.completedSteps.includes("withdraw-first-stake")) {
    await executeTx(state, "withdrawStake:first", () => marketAgent.withdrawStake.estimateGas(), () => marketAgent.withdrawStake(), provider);
    const a = await marketClient.getAgent(agent.address);
    if (a.registered || a.stake !== 0n) throw new Error("withdrawStake did not clear registration/stake");
    const expectedContractBalance = BigInt(state.scenarios.donationBaseline.contractBalance) + GIFT - STAKE;
    const observedContractBalance = await tokenClient.balanceOf(MARKET_ADDRESS);
    if (observedContractBalance !== expectedContractBalance) {
      throw new Error(`Donation did not remain locked after stake withdrawal: expected ${expectedContractBalance}, observed ${observedContractBalance}`);
    }
    finding(state, "donation-accounting", {
      accepted: true,
      giftRaw: GIFT.toString(),
      expectedContractBalanceAfterWithdraw: expectedContractBalance.toString(),
      observedContractBalanceAfterWithdraw: observedContractBalance.toString(),
      slashSinkUnchanged: true,
      reputationFeeSinkUnchangedDuringRepeatWorkflow: true,
      distinctClients: "1",
    });
    complete(state, "withdraw-first-stake");
  }
  if (!state.scenarios.completedSteps.includes("pagination-verified")) {
    const [page, total] = await marketClient.getJobsPaged(0, 10);
    if (total < 2n || page.length < 2 || page[0].id !== happyId || page[1].id !== donationId) throw new Error("getJobsPaged live data mismatch");
    finding(state, "getJobsPaged", { accepted: true, offset: 0, limit: 10, returned: page.length, total: total.toString() });
    complete(state, "pagination-verified");
  }

  // Irreversible section starts only after all reversible checks passed.
  if (!state.scenarios.completedSteps.includes("registered-for-timeouts")) {
    await executeTx(state, "agentApproveStake:timeouts", () => tokenAgent.approve.estimateGas(MARKET_ADDRESS, STAKE), () => tokenAgent.approve(MARKET_ADDRESS, STAKE), provider);
    await executeTx(state, "registerAgent:timeouts", () => marketAgent.registerAgent.estimateGas("Arc timeout agent", "verification", 0), () => marketAgent.registerAgent("Arc timeout agent", "verification", 0), provider);
    complete(state, "registered-for-timeouts");
  }
  const deliveryId = await postJob(state, "timeoutDelivery", "Arc timeout delivery", marketClient, provider);
  const approvalId = await postJob(state, "timeoutApproval", "Arc timeout approval", marketClient, provider);
  const disputeId = await postJob(state, "timeoutDispute", "Arc timeout dispute", marketClient, provider);
  if (!state.scenarios.completedSteps.includes("timeout-jobs-prepared")) {
    await executeTx(state, "timeoutDelivery:accept", () => marketAgent.acceptJob.estimateGas(deliveryId), () => marketAgent.acceptJob(deliveryId), provider);
    await executeTx(state, "timeoutApproval:accept", () => marketAgent.acceptJob.estimateGas(approvalId), () => marketAgent.acceptJob(approvalId), provider);
    await executeTx(state, "timeoutDispute:accept", () => marketAgent.acceptJob.estimateGas(disputeId), () => marketAgent.acceptJob(disputeId), provider);
    await executeTx(state, "timeoutApproval:submit", () => marketAgent.submitDeliverable.estimateGas(approvalId, "ipfs://arc-timeout-approval"), () => marketAgent.submitDeliverable(approvalId, "ipfs://arc-timeout-approval"), provider);
    await executeTx(state, "timeoutDispute:submit", () => marketAgent.submitDeliverable.estimateGas(disputeId, "ipfs://arc-timeout-dispute"), () => marketAgent.submitDeliverable(disputeId, "ipfs://arc-timeout-dispute"), provider);
    await executeTx(state, "timeoutDispute:dispute", () => marketClient.disputeJob.estimateGas(disputeId), () => marketClient.disputeJob(disputeId), provider);
    const [delivery, approval, dispute] = await Promise.all([marketClient.jobs(deliveryId), marketClient.jobs(approvalId), marketClient.jobs(disputeId)]);
    state.scenarios.jobs.timeoutDelivery.deadline = delivery.deliveryDeadline.toString();
    state.scenarios.jobs.timeoutApproval.deadline = approval.approvalDeadline.toString();
    state.scenarios.jobs.timeoutDispute.deadline = dispute.disputeDeadline.toString();
    saveState(state);
    complete(state, "timeout-jobs-prepared");
  }

  const deliveryDeadline = BigInt(state.scenarios.jobs.timeoutDelivery.deadline);
  const approvalDeadline = BigInt(state.scenarios.jobs.timeoutApproval.deadline);
  const disputeDeadline = BigInt(state.scenarios.jobs.timeoutDispute.deadline);
  await waitUntil(provider, deliveryDeadline, "delivery deadline");
  await expectTimeoutRevert(state, "approval-before-deadline", marketClient, approvalId, provider, "Approval deadline not reached");
  if (!state.scenarios.completedSteps.includes("delivery-timeout-settled")) {
    await executeTx(state, "timeoutDelivery:claim", () => marketClient.claimTimeout.estimateGas(deliveryId), () => marketClient.claimTimeout(deliveryId), provider);
    const [job, agentState, globalRep, categoryRep] = await Promise.all([
      marketClient.jobs(deliveryId), marketClient.getAgent(agent.address), marketClient.getAgentReputation(agent.address), marketClient.getReputationByCategory(agent.address, "verification"),
    ]);
    if (job.status !== 6n || agentState.registered || agentState.stake !== 0n || globalRep[0] !== 0n || categoryRep !== 0n) throw new Error("Delivery slash/epoch state mismatch");
    complete(state, "delivery-timeout-settled");
  }
  await waitUntil(provider, approvalDeadline, "approval deadline");
  await expectTimeoutRevert(state, "dispute-before-deadline", marketClient, disputeId, provider, "Dispute deadline not reached");
  if (!state.scenarios.completedSteps.includes("approval-timeout-settled")) {
    await executeTx(state, "timeoutApproval:claim", () => marketClient.claimTimeout.estimateGas(approvalId), () => marketClient.claimTimeout(approvalId), provider);
    if ((await marketClient.jobs(approvalId)).status !== 7n) throw new Error("Submitted timeout status mismatch");
    complete(state, "approval-timeout-settled");
  }
  await waitUntil(provider, disputeDeadline, "dispute deadline");
  if (!state.scenarios.completedSteps.includes("dispute-timeout-settled")) {
    const rec = await executeTx(state, "timeoutDispute:claim", () => marketClient.claimTimeout.estimateGas(disputeId), () => marketClient.claimTimeout(disputeId), provider);
    const receipt = await provider.getTransactionReceipt(rec.hash);
    const parsed = receipt.logs.map((l) => { try { return marketClient.interface.parseLog(l); } catch { return null; } }).find((x) => x?.name === "JobExpiredSplit");
    if (!parsed || parsed.args[3] !== 2_500000n || parsed.args[4] !== 2_500000n) throw new Error("Dispute split not exact 2.5/2.5 USDC");
    if ((await marketClient.jobs(disputeId)).status !== 8n) throw new Error("Dispute timeout status mismatch");
    complete(state, "dispute-timeout-settled");
  }

  state.scenarios.status = "COMPLETED";
  state.scenarios.blocklist = "NOT_VERIFIED";
  finding(state, "epoch-reregister-after-slash", { status: "LOCAL_ONLY", note: "Not exercised live; would require a second 100 USDC stake after irreversible slash." });
  saveState(state);
  console.log("ARC VERIFICATION SCENARIOS COMPLETED");
}

main().catch((error) => {
  try {
    const state = loadState();
    ensureArrays(state);
    state.scenarios.status = "STOPPED_ON_UNEXPECTED_FAILURE";
    state.scenarios.lastError = { at: new Date().toISOString(), message: error.message };
    saveState(state);
  } catch {}
  console.error(error);
  process.exitCode = 1;
});
