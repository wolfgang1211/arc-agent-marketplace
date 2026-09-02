import assert from "node:assert/strict";
import test from "node:test";

import { GAS_RESERVE_WEI } from "../src/eligibility.mjs";
import { runCycle } from "../src/runtime.mjs";

const description = JSON.stringify({ schemaVersion: 1, task: "url_summary", sourceUrl: "https://example.com/article", language: "en", maxWords: 400 });
const agentAddress = "0x1111111111111111111111111111111111111111";
const clientAddress = "0x2222222222222222222222222222222222222222";
const openJob = (id = 4n) => ({ id, client: clientAddress, agent: "0x0000000000000000000000000000000000000000", description, category: "url-summary-v1", deliverableURI: "", reward: 5_000000n, status: 0, deliveryDeadline: 0n });

function memoryState(initial = {}) {
  let value = structuredClone(initial);
  return { load: async () => structuredClone(value), save: async (next) => { value = structuredClone(next); }, inspect: () => value };
}

function mockChain({ jobs = [openJob()], balance = GAS_RESERVE_WEI, usdcBalance = 100_000000n, registered = true, now = 1_000n, submitError = null } = {}) {
  const calls = [];
  let agent = { registered, stake: registered ? 10_000000n : 0n, activeJobs: 0n };
  const chain = {
    address: agentAddress,
    calls,
    assertChain: async () => 5_042_002,
    listJobs: async () => jobs,
    getJob: async (id) => jobs.find((job) => job.id === BigInt(id)),
    getAgent: async () => agent,
    getNativeBalance: async () => balance,
    getUsdcBalance: async () => usdcBalance,
    getChainTimestamp: async () => now,
    acceptJob: async (id, options = {}) => {
      calls.push(["accept", String(id)]);
      const hash = "0x" + "a".repeat(64);
      if (options.onBroadcast) await options.onBroadcast(hash);
      const job = jobs.find((item) => item.id === BigInt(id));
      job.status = 1; job.agent = agentAddress; job.deliveryDeadline = now + 86_400n; agent.activeJobs = 1n;
      return { hash };
    },
    submitDeliverable: async (id, uri, options = {}) => {
      calls.push(["submit", String(id), uri]);
      const hash = "0x" + "b".repeat(64);
      if (options.onBroadcast) await options.onBroadcast(hash);
      if (submitError) throw submitError;
      const job = jobs.find((item) => item.id === BigInt(id));
      job.status = 2; job.deliverableURI = uri;
      return { hash };
    },
    claimTimeout: async (id, options = {}) => {
      calls.push(["timeout", String(id)]);
      const hash = "0x" + "c".repeat(64);
      if (options.onBroadcast) await options.onBroadcast(hash);
      const job = jobs.find((item) => item.id === BigInt(id));
      job.status = 6; agent = { ...agent, registered: false, stake: 0n, activeJobs: 0n };
      return { hash };
    },
  };
  return chain;
}

const prepareJob = async (job) => ({
  deliveryUri: `https://gateway.example/ipfs/bafy${job.id}/index.html`,
  resultUri: `https://gateway.example/ipfs/bafy${job.id}/result.json`,
  cid: `bafy${job.id}`,
});

test("prepares, rechecks, accepts, and submits one eligible job without intervention", async () => {
  const chain = mockChain({ jobs: [openJob(3n), openJob(4n)] });
  const state = memoryState();
  const result = await runCycle({ chain, state, prepareJob });
  assert.equal(result.action, "submitted");
  assert.deepEqual(chain.calls.map((call) => call[0]), ["accept", "submit"]);
  assert.match(result.deliveryUri, /\/ipfs\/bafy3\/index\.html$/);
  assert.match(result.acceptTxHash, /^0xa{64}$/);
  assert.match(result.submitTxHash, /^0xb{64}$/);
  assert.equal(state.inspect().jobs["3"].phase, "submitted");
});

test("gas guard stops new acceptance before source work", async () => {
  let prepared = false;
  const chain = mockChain({ balance: GAS_RESERVE_WEI - 1n });
  const result = await runCycle({ chain, state: memoryState(), prepareJob: async () => { prepared = true; } });
  assert.equal(result.action, "gas_guard");
  assert.equal(prepared, false);
  assert.deepEqual(chain.calls, []);
});

test("wrong chain and self-authored jobs are rejected before preparation or writes", async () => {
  const wrongChain = mockChain();
  wrongChain.assertChain = async () => { throw new Error("wrong_chain_id_1"); };
  await assert.rejects(() => runCycle({ chain: wrongChain, state: memoryState(), prepareJob }), /wrong_chain_id_1/);
  assert.deepEqual(wrongChain.calls, []);

  let prepared = false;
  const selfJob = openJob(8n);
  selfJob.client = agentAddress;
  const selfChain = mockChain({ jobs: [selfJob] });
  const result = await runCycle({ chain: selfChain, state: memoryState(), prepareJob: async () => { prepared = true; } });
  assert.equal(result.action, "no_eligible_jobs");
  assert.equal(prepared, false);
  assert.deepEqual(selfChain.calls, []);
});

test("invalid prepared delivery URI never reaches acceptJob", async () => {
  const chain = mockChain();
  const state = memoryState();
  const result = await runCycle({
    chain,
    state,
    prepareJob: async () => ({ cid: "bafyok", deliveryUri: "https://evil.example/result", resultUri: "https://evil.example/result.json" }),
  });
  assert.equal(result.action, "no_eligible_jobs");
  assert.deepEqual(chain.calls, []);
  assert.equal(state.inspect().jobs["4"].reason, "invalid_prepared_artifact");
});

test("broadcast hash is durable before receipt and ambiguous accept is never resent blindly", async () => {
  const chain = mockChain();
  chain.acceptJob = async (id, options = {}) => {
    chain.calls.push(["accept", String(id)]);
    if (options.onBroadcast) await options.onBroadcast("0x" + "d".repeat(64));
    throw new Error("receipt_timeout");
  };
  const state = memoryState();
  await assert.rejects(() => runCycle({ chain, state, prepareJob }), /receipt_timeout/);
  assert.equal(state.inspect().jobs["4"].phase, "accepting");
  assert.match(state.inspect().jobs["4"].acceptTxHash, /^0xd{64}$/);
  const result = await runCycle({ chain, state, prepareJob });
  assert.equal(result.action, "broadcast_reconciliation_wait");
  assert.equal(chain.calls.filter((call) => call[0] === "accept").length, 1);
});

test("restart resumes an owned in-progress job and never accepts it again", async () => {
  const job = openJob(9n);
  job.status = 1; job.agent = agentAddress; job.deliveryDeadline = 90_000n;
  const chain = mockChain({ jobs: [job] });
  const state = memoryState({ version: 1, wasRegistered: true, halted: false, jobs: { "9": { phase: "accepted", deliveryUri: "https://gateway.example/ipfs/bafy9/index.html", acceptTxHash: "0x" + "a".repeat(64) } } });
  const result = await runCycle({ chain, state, prepareJob });
  assert.equal(result.action, "submitted");
  assert.deepEqual(chain.calls.map((call) => call[0]), ["submit"]);
});

test("restart recovers a state-known accepted job outside the discovery page", async () => {
  const job = openJob(9n);
  job.status = 1; job.agent = agentAddress; job.deliveryDeadline = 90_000n;
  const chain = mockChain({ jobs: [job] });
  const getJob = chain.getJob;
  chain.listJobs = async () => [];
  chain.getJob = getJob;
  const state = memoryState({ version: 1, wasRegistered: true, halted: false, jobs: { "9": { phase: "accepted", deliveryUri: "https://gateway.example/ipfs/bafy9/index.html", acceptTxHash: "0x" + "a".repeat(64) } } });
  const result = await runCycle({ chain, state, prepareJob });
  assert.equal(result.action, "submitted");
  assert.deepEqual(chain.calls.map((call) => call[0]), ["submit"]);
});

test("never submits at or after the inclusive delivery deadline", async () => {
  const job = openJob(15n);
  job.status = 1;
  job.agent = agentAddress;
  job.deliveryDeadline = 2_000n;
  const chain = mockChain({ jobs: [job], now: 2_000n });
  const state = memoryState({ version: 1, wasRegistered: true, halted: false, jobs: { "15": {
    phase: "accepted",
    cid: "bafy15",
    deliveryUri: "https://gateway.example/ipfs/bafy15/index.html",
    resultUri: "https://gateway.example/ipfs/bafy15/result.json",
  } } });
  const first = await runCycle({ chain, state, prepareJob });
  assert.equal(first.action, "terminal_failure_wait");
  assert.equal(state.inspect().jobs["15"].reason, "delivery_deadline_reached");
  assert.deepEqual(chain.calls, []);
  const second = await runCycle({ chain, state, prepareJob });
  assert.equal(second.action, "halted_after_slash");
  assert.deepEqual(chain.calls.map((call) => call[0]), ["timeout"]);
});

test("permanent post-accept failure waits for deadline, claims timeout, verifies slash, and halts", async () => {
  const failure = new Error("submit failed");
  failure.permanent = true;
  const job = openJob(8n);
  const chain = mockChain({ jobs: [job], now: 1_000n, submitError: failure });
  const state = memoryState();
  const first = await runCycle({ chain, state, prepareJob });
  assert.equal(first.action, "terminal_failure_wait");
  assert.equal(state.inspect().jobs["8"].phase, "terminal_failure");
  assert.deepEqual(chain.calls.map((call) => call[0]), ["accept", "submit"]);

  chain.getChainTimestamp = async () => 87_400n;
  chain.submitDeliverable = async () => { throw new Error("must not retry permanent failure"); };
  const second = await runCycle({ chain, state, prepareJob });
  assert.equal(second.action, "halted_after_slash");
  assert.match(second.timeoutTxHash, /^0xc{64}$/);
  assert.equal(state.inspect().halted, true);
  assert.deepEqual(chain.calls.map((call) => call[0]), ["accept", "submit", "timeout"]);
});

test("observes customer approval settlement and records chain balances before and after", async () => {
  const job = openJob(12n);
  job.status = 4;
  job.agent = agentAddress;
  job.deliverableURI = "https://gateway.example/ipfs/bafy12/index.html";
  const chain = mockChain({ jobs: [job], balance: GAS_RESERVE_WEI + 5_000_000_000_000_000n, usdcBalance: 105_000000n });
  const state = memoryState({ version: 1, wasRegistered: true, halted: false, jobs: { "12": {
    phase: "submitted",
    deliveryUri: job.deliverableURI,
    acceptTxHash: "0x" + "a".repeat(64),
    submitTxHash: "0x" + "b".repeat(64),
    balanceBeforeAccept: { native: String(GAS_RESERVE_WEI), usdc: "100000000" },
  } } });
  const result = await runCycle({ chain, state, prepareJob });
  assert.equal(result.action, "settlement_observed");
  assert.deepEqual(result.balanceBeforeAccept, { native: String(GAS_RESERVE_WEI), usdc: "100000000" });
  assert.deepEqual(result.balanceAfterSettlement, { native: String(GAS_RESERVE_WEI + 5_000_000_000_000_000n), usdc: "105000000" });
  assert.equal(state.inspect().jobs["12"].phase, "completed");
});

test("a previously registered wallet never auto-registers after registration is lost", async () => {
  const chain = mockChain({ registered: false });
  const state = memoryState({ version: 1, wasRegistered: true, halted: false, jobs: {} });
  const result = await runCycle({ chain, state, prepareJob });
  assert.equal(result.action, "registration_lost_halt");
  assert.equal(state.inspect().halted, true);
  assert.deepEqual(chain.calls, []);
});
