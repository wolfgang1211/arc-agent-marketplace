import assert from "node:assert/strict";
import test from "node:test";

import { createChainAdapter } from "../src/chain.mjs";

const contractAddress = "0xFc7dE289e02FCFB4268AE8f0e49991D2Eafe5C87";
const usdcAddress = "0x3600000000000000000000000000000000000000";
const account = { address: "0x1111111111111111111111111111111111111111" };
const sampleJob = (id) => ({ id, status: 0, category: "url-summary-v1", createdAt: 1_000n });

function clients({ receiptStatus = "success", eventNames = ["JobAccepted", "DeliverableSubmitted", "AgentRegistered", "AgentSlashed", "JobExpiredRefunded"] } = {}) {
  const reads = [];
  const writes = [];
  const simulations = [];
  const publicClient = {
    readContract: async ({ functionName, args }) => {
      reads.push([functionName, args]);
      if (functionName === "jobCount") return 101n;
      if (functionName === "getJobsPaged") {
        if (args[1] === 100n) return [[sampleJob(2n), sampleJob(101n)], 101n];
        return [[sampleJob(args[0] + 1n)], 101n];
      }
      if (functionName === "getAgent") return { registered: true, stake: 10_000000n };
      return 10_000000n;
    },
    getBalance: async () => 20_000_000_000_000_000n,
    getChainId: async () => 5_042_002,
    getBlock: async () => ({ timestamp: 1234n }),
    getContractEvents: async () => [],
    simulateContract: async (request) => { simulations.push(request); return { request }; },
    getTransactionReceipt: async () => ({ status: receiptStatus }),
    waitForTransactionReceipt: async () => ({ status: receiptStatus, eventNames }),
  };
  const walletClient = { writeContract: async (request) => { writes.push(request); return "0x" + "a".repeat(64); } };
  return { publicClient, walletClient, reads, writes, simulations };
}

const pilot7 = { pilotJobId: 7n, pilotScopeValid: true, pilotScopeReason: null };

test("reads only the latest bounded 100-job page and exact one-job resume pages", async () => {
  const fake = clients();
  const chain = createChainAdapter({ ...fake, account, contractAddress, usdcAddress, writeEnabled: false });
  const jobs = await chain.listJobs();
  assert.deepEqual(jobs.map((job) => job.id), [2n, 101n]);
  assert.deepEqual(fake.reads.slice(0, 2), [["jobCount", []], ["getJobsPaged", [1n, 100n]]]);
  assert.equal((await chain.getJob(7n)).id, 7n);
  assert.deepEqual(fake.reads[2], ["getJobsPaged", [6n, 1n]]);
});

test("live transaction writes are fail-closed and receipts are verified", async () => {
  const disabled = clients();
  const readOnlyChain = createChainAdapter({ ...disabled, account, contractAddress, usdcAddress, writeEnabled: false });
  await assert.rejects(() => readOnlyChain.acceptJob(7n), /live_writes_disabled/);
  assert.equal(disabled.writes.length, 0);

  const enabled = clients();
  const liveChain = createChainAdapter({ ...enabled, account, contractAddress, usdcAddress, writeEnabled: true, ...pilot7 });
  const result = await liveChain.submitDeliverable(7n, "https://gateway.example/ipfs/cid/index.html");
  assert.match(result.hash, /^0xa{64}$/);
  assert.equal(enabled.writes.length, 1);
  assert.equal(await liveChain.getTransactionStatus(result.hash), "success");

  let broadcastHash = null;
  await liveChain.acceptJob(7n, { onBroadcast: async (hash) => { broadcastHash = hash; } });
  assert.match(broadcastHash, /^0xa{64}$/);

  const failed = clients({ receiptStatus: "reverted" });
  const failedChain = createChainAdapter({ ...failed, account, contractAddress, usdcAddress, writeEnabled: true, ...pilot7 });
  await assert.rejects(() => failedChain.claimTimeout(7n), (error) => {
    assert.match(error.message, /claimTimeout_receipt_failed/);
    assert.equal(error.transactionStage, "receipt");
    assert.match(error.transactionHash, /^0xa{64}$/);
    return true;
  });
  assert.equal(await failedChain.getTransactionStatus("0x" + "a".repeat(64)), "reverted");

  const simulationFailure = clients();
  simulationFailure.publicClient.simulateContract = async () => { throw new Error("simulation reverted"); };
  const simulationFailureChain = createChainAdapter({ ...simulationFailure, account, contractAddress, usdcAddress, writeEnabled: true, ...pilot7 });
  await assert.rejects(() => simulationFailureChain.claimApprovalTimeout(7n), (error) => {
    assert.equal(error.transactionStage, "simulation");
    assert.equal(simulationFailure.writes.length, 0);
    return true;
  });

  const missingEvent = clients({ eventNames: [] });
  const missingEventChain = createChainAdapter({ ...missingEvent, account, contractAddress, usdcAddress, writeEnabled: true, ...pilot7 });
  await assert.rejects(() => missingEventChain.acceptJob(7n), /acceptJob_missing_JobAccepted_event/);

  const payout = clients({ eventNames: ["JobExpiredPaid"] });
  const payoutChain = createChainAdapter({ ...payout, account, contractAddress, usdcAddress, writeEnabled: true, ...pilot7 });
  const payoutResult = await payoutChain.claimApprovalTimeout(7n);
  assert.match(payoutResult.hash, /^0xa{64}$/);
  assert.equal(payout.writes[0].functionName, "claimTimeout");

  const missingPayoutEvent = clients({ eventNames: [] });
  const missingPayoutEventChain = createChainAdapter({ ...missingPayoutEvent, account, contractAddress, usdcAddress, writeEnabled: true, ...pilot7 });
  await assert.rejects(() => missingPayoutEventChain.claimApprovalTimeout(7n), /claimTimeout_missing_JobExpiredPaid_event/);
});

test("pilot scope blocks every job write path before simulation or broadcast", async () => {
  const fake = clients();
  const chain = createChainAdapter({ ...fake, account, contractAddress, usdcAddress, writeEnabled: true, ...pilot7 });
  for (const invoke of [
    () => chain.acceptJob(8n),
    () => chain.submitDeliverable(8n, "https://gateway.example/ipfs/cid/index.html"),
    () => chain.claimTimeout(8n),
    () => chain.claimApprovalTimeout(8n),
  ]) {
    await assert.rejects(invoke, /pilot_scope_violation/);
  }
  assert.equal(fake.simulations.length, 0);
  assert.equal(fake.writes.length, 0);
  await assert.rejects(() => chain.registerAgent("name", "skill", 5_000000n), /pilot_scope_non_job_write/);
  await assert.rejects(() => chain.approveStake(10_000000n), /pilot_scope_non_job_write/);
  assert.equal(fake.simulations.length, 0);
  assert.equal(fake.writes.length, 0);
});

test("missing or invalid pilot scope blocks all writes before simulation", async () => {
  for (const scope of [
    { pilotJobId: null, pilotScopeValid: false, pilotScopeReason: "pilot_job_id_missing" },
    { pilotJobId: null, pilotScopeValid: false, pilotScopeReason: "pilot_job_id_invalid" },
  ]) {
    const fake = clients();
    const chain = createChainAdapter({ ...fake, account, contractAddress, usdcAddress, writeEnabled: true, ...scope });
    await assert.rejects(() => chain.acceptJob(7n), /pilot_scope_invalid/);
    await assert.rejects(() => chain.registerAgent("name", "skill", 5_000000n), /pilot_scope_invalid/);
    assert.equal(fake.simulations.length, 0);
    assert.equal(fake.writes.length, 0);
  }
});

test("transaction status treats only receipt-not-found as pending", async () => {
  const pending = clients();
  pending.publicClient.getTransactionReceipt = async () => {
    const error = new Error("not found");
    error.name = "TransactionReceiptNotFoundError";
    throw error;
  };
  const pendingChain = createChainAdapter({ ...pending, account, contractAddress, usdcAddress, writeEnabled: false });
  assert.equal(await pendingChain.getTransactionStatus("0x" + "a".repeat(64)), "pending");

  const unavailable = clients();
  unavailable.publicClient.getTransactionReceipt = async () => { throw new Error("rpc unavailable"); };
  const unavailableChain = createChainAdapter({ ...unavailable, account, contractAddress, usdcAddress, writeEnabled: false });
  await assert.rejects(() => unavailableChain.getTransactionStatus("0x" + "a".repeat(64)), /rpc unavailable/);
});

test("reads job opening time from createdAt and falls back to the JobPosted block", async () => {
  const withStructTimestamp = clients();
  let eventReads = 0;
  withStructTimestamp.publicClient.getContractEvents = async () => { eventReads += 1; return []; };
  const structChain = createChainAdapter({ ...withStructTimestamp, account, contractAddress, usdcAddress, writeEnabled: false });
  assert.deepEqual(await structChain.getJobOpeningTime({ id: 7n, createdAt: 1_111n }), { timestamp: 1_111n, source: "createdAt" });
  assert.equal(eventReads, 0);

  const fromEvent = clients();
  fromEvent.publicClient.getContractEvents = async ({ eventName, args }) => {
    assert.equal(eventName, "JobPosted");
    assert.deepEqual(args, { jobId: 7n });
    return [{ blockNumber: 77n }];
  };
  fromEvent.publicClient.getBlock = async ({ blockNumber }) => {
    assert.equal(blockNumber, 77n);
    return { timestamp: 2_222n };
  };
  const eventChain = createChainAdapter({ ...fromEvent, account, contractAddress, usdcAddress, writeEnabled: false });
  assert.deepEqual(await eventChain.getJobOpeningTime({ id: 7n }), { timestamp: 2_222n, source: "JobPosted" });
});
