import assert from "node:assert/strict";
import test from "node:test";

import { createChainAdapter } from "../src/chain.mjs";

const contractAddress = "0xFc7dE289e02FCFB4268AE8f0e49991D2Eafe5C87";
const usdcAddress = "0x3600000000000000000000000000000000000000";
const account = { address: "0x1111111111111111111111111111111111111111" };
const sampleJob = (id) => ({ id, status: 0, category: "url-summary-v1" });

function clients({ receiptStatus = "success", eventNames = ["JobAccepted", "DeliverableSubmitted", "AgentRegistered", "AgentSlashed", "JobExpiredRefunded"] } = {}) {
  const reads = [];
  const writes = [];
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
    simulateContract: async (request) => ({ request }),
    waitForTransactionReceipt: async () => ({ status: receiptStatus, eventNames }),
  };
  const walletClient = { writeContract: async (request) => { writes.push(request); return "0x" + "a".repeat(64); } };
  return { publicClient, walletClient, reads, writes };
}

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
  const liveChain = createChainAdapter({ ...enabled, account, contractAddress, usdcAddress, writeEnabled: true });
  const result = await liveChain.submitDeliverable(7n, "https://gateway.example/ipfs/cid/index.html");
  assert.match(result.hash, /^0xa{64}$/);
  assert.equal(enabled.writes.length, 1);

  let broadcastHash = null;
  await liveChain.acceptJob(7n, { onBroadcast: async (hash) => { broadcastHash = hash; } });
  assert.match(broadcastHash, /^0xa{64}$/);

  const failed = clients({ receiptStatus: "reverted" });
  const failedChain = createChainAdapter({ ...failed, account, contractAddress, usdcAddress, writeEnabled: true });
  await assert.rejects(() => failedChain.claimTimeout(7n), /claimTimeout_receipt_failed/);

  const missingEvent = clients({ eventNames: [] });
  const missingEventChain = createChainAdapter({ ...missingEvent, account, contractAddress, usdcAddress, writeEnabled: true });
  await assert.rejects(() => missingEventChain.acceptJob(7n), /acceptJob_missing_JobAccepted_event/);
});
