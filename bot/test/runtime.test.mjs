import assert from "node:assert/strict";
import test from "node:test";

import { GAS_RESERVE_WEI } from "../src/eligibility.mjs";
import { runCycle } from "../src/runtime.mjs";

const description = JSON.stringify({ schemaVersion: 1, task: "url_summary", sourceUrl: "https://example.com/article", language: "en", maxWords: 400 });
const agentAddress = "0x1111111111111111111111111111111111111111";
const clientAddress = "0x2222222222222222222222222222222222222222";
const openJob = (id = 4n) => ({ id, client: clientAddress, agent: "0x0000000000000000000000000000000000000000", description, category: "url-summary-v1", deliverableURI: "", reward: 5_000000n, status: 0, createdAt: 1n, deliveryDeadline: 0n, approvalDeadline: 0n });
const submittedJob = (id = 4n, approvalDeadline = 2_000n) => ({ ...openJob(id), agent: agentAddress, status: 2, deliveryDeadline: 1_500n, approvalDeadline, deliverableURI: `https://gateway.example/ipfs/bafy${id}/index.html` });

function memoryState(initial = {}) {
  let value = structuredClone(initial);
  let saveCount = 0;
  return { load: async () => structuredClone(value), save: async (next) => { saveCount += 1; value = structuredClone(next); }, inspect: () => value, saves: () => saveCount };
}

function mockChain({ jobs = [openJob()], balance = GAS_RESERVE_WEI, usdcBalance = 100_000000n, registered = true, agentActiveJobs = 0n, now = 1_000n, submitError = null, transactionStatus = "pending", writeEnabled = true, houseDelaySeconds = 0, openingEventTimestamp = null, openingTimeError = null, pilotJobId = jobs[0]?.id ?? 1n, pilotScopeValid = true, pilotScopeReason = null } = {}) {
  const calls = [];
  let agent = { registered, stake: registered ? 10_000000n : 0n, activeJobs: BigInt(agentActiveJobs) };
  const chain = {
    address: agentAddress,
    writeEnabled,
    houseDelaySeconds,
    pilotJobId: pilotJobId == null ? null : BigInt(pilotJobId),
    pilotScopeValid,
    pilotScopeReason,
    calls,
    assertChain: async () => 5_042_002,
    listJobs: async () => jobs,
    getJob: async (id) => jobs.find((job) => job.id === BigInt(id)),
    getAgent: async () => agent,
    getNativeBalance: async () => balance,
    getUsdcBalance: async () => usdcBalance,
    getChainTimestamp: async () => now,
    getJobOpeningTime: async (job) => {
      if (openingTimeError) throw openingTimeError;
      if (typeof job.createdAt === "bigint" && job.createdAt > 0n) return { timestamp: job.createdAt, source: "createdAt" };
      if (openingEventTimestamp != null) return { timestamp: BigInt(openingEventTimestamp), source: "JobPosted" };
      throw new Error("job_open_time_unavailable");
    },
    getTransactionStatus: async () => transactionStatus,
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
      job.status = 2; job.deliverableURI = uri; job.approvalDeadline = now + 86_400n;
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
    claimApprovalTimeout: async (id, options = {}) => {
      calls.push(["approval-timeout", String(id)]);
      const hash = "0x" + "f".repeat(64);
      if (options.onBroadcast) await options.onBroadcast(hash);
      const job = jobs.find((item) => item.id === BigInt(id));
      job.status = 7;
      agent = { ...agent, activeJobs: 0n };
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

test("live mode without a valid pilot ID fails closed and raises an operator alert", async () => {
  for (const scope of [
    { pilotJobId: null, pilotScopeValid: false, pilotScopeReason: "pilot_job_id_missing" },
    { pilotJobId: null, pilotScopeValid: false, pilotScopeReason: "pilot_job_id_invalid" },
  ]) {
    const chain = mockChain(scope);
    const state = memoryState();
    const result = await runCycle({ chain, state, prepareJob });
    assert.deepEqual(result, { action: "pilot_scope_invalid", reason: scope.pilotScopeReason, alert: true });
    assert.deepEqual(chain.calls, []);
    assert.equal(state.saves(), 0);
  }
});

test("read-only mode remains safe when pilot ID is absent", async () => {
  const chain = mockChain({ writeEnabled: false, pilotJobId: null, pilotScopeValid: false, pilotScopeReason: "pilot_job_id_missing" });
  const state = memoryState();
  const result = await runCycle({ chain, state, prepareJob });
  assert.equal(result.action, "read_only");
  assert.deepEqual(chain.calls, []);
  assert.equal(state.saves(), 0);
});

test("pilot scope skips non-pilot open jobs before preparation or acceptance", async () => {
  const outside = openJob(8n);
  const chain = mockChain({ jobs: [outside], pilotJobId: 9n });
  let prepared = false;
  const result = await runCycle({ chain, state: memoryState(), prepareJob: async () => { prepared = true; } });

  assert.equal(result.action, "no_eligible_jobs");
  assert.deepEqual(result.pilotScopeSkips, [{ jobId: "8", status: 0, reason: "pilot_scope_skip" }]);
  assert.equal(prepared, false);
  assert.deepEqual(chain.calls, []);
});

test("owned timeout and payout paths are restricted to the pilot job", async () => {
  const inProgress = { ...openJob(21n), agent: agentAddress, status: 1, deliveryDeadline: 900n };
  const submitted = submittedJob(22n, 900n);
  for (const job of [inProgress, submitted]) {
    const pilot = openJob(99n);
    const chain = mockChain({ jobs: [job, pilot], pilotJobId: 99n, now: 1_000n });
    const result = await runCycle({ chain, state: memoryState(), prepareJob });
    assert.equal(result.action, "pilot_scope_owned_job_wait");
    assert.equal(result.alert, true);
    assert.equal(result.jobId, String(job.id));
    assert.deepEqual(result.pilotScopeSkips, [{ jobId: String(job.id), status: Number(job.status), reason: "pilot_scope_skip" }]);
    assert.deepEqual(chain.calls, []);
  }
});

test("unresolved active work outside the visible pilot scope blocks all writes", async () => {
  const pilot = openJob(99n);
  const chain = mockChain({ jobs: [pilot], pilotJobId: 99n, agentActiveJobs: 1n });
  const result = await runCycle({ chain, state: memoryState(), prepareJob });
  assert.deepEqual(result, { action: "pilot_scope_owned_job_unresolved", reason: "active_job_outside_pilot_scope", alert: true });
  assert.deepEqual(chain.calls, []);
});

test("prepares, rechecks, accepts, and submits one eligible job without intervention", async () => {
  const chain = mockChain({ jobs: [openJob(3n), openJob(4n)], pilotJobId: 3n });
  const state = memoryState();
  const result = await runCycle({ chain, state, prepareJob });
  assert.equal(result.action, "submitted");
  assert.deepEqual(chain.calls.map((call) => call[0]), ["accept", "submit"]);
  assert.match(result.deliveryUri, /\/ipfs\/bafy3\/index\.html$/);
  assert.match(result.acceptTxHash, /^0xa{64}$/);
  assert.match(result.submitTxHash, /^0xb{64}$/);
  assert.equal(state.inspect().jobs["3"].phase, "submitted");
});

test("pilot scope skips a blocked head and submits only the selected eligible job", async () => {
  const blocked = openJob(5n);
  const next = openJob(6n);
  const chain = mockChain({ jobs: [blocked, next], now: 1_000n, pilotJobId: 6n });
  const state = memoryState();
  const preparedIds = [];
  const result = await runCycle({
    chain,
    state,
    prepareJob: async (job) => {
      preparedIds.push(String(job.id));
      return prepareJob(job);
    },
  });

  assert.equal(result.action, "submitted");
  assert.equal(result.jobId, "6");
  assert.deepEqual(preparedIds, ["6"]);
  assert.deepEqual(result.pilotScopeSkips, [{ jobId: "5", status: 0, reason: "pilot_scope_skip" }]);
  assert.deepEqual(chain.calls.map((call) => [call[0], call[1]]), [["accept", "6"], ["submit", "6"]]);
  assert.equal(state.inspect().jobs["5"], undefined);
});

test("temporary prepare cooldown survives restart and retries at the chain-time boundary", async () => {
  const job = openJob(5n);
  let now = 1_000n;
  const chain = mockChain({ jobs: [job], now });
  chain.getChainTimestamp = async () => now;
  const state = memoryState();
  let prepareCalls = 0;
  const transientThenSuccess = async (candidate) => {
    prepareCalls += 1;
    if (prepareCalls === 1) {
      const error = new Error("temporary DNS failure");
      error.code = "dns_error";
      error.permanent = false;
      throw error;
    }
    return prepareJob(candidate);
  };

  const first = await runCycle({ chain, state, prepareJob: transientThenSuccess });
  assert.equal(first.action, "no_eligible_jobs");
  assert.equal(state.inspect().jobs["5"].nextPrepareAttemptAt, "1300");
  assert.equal(prepareCalls, 1);

  now = 1_299n;
  const restartedBeforeBoundary = await runCycle({ chain, state, prepareJob: transientThenSuccess });
  assert.equal(restartedBeforeBoundary.action, "no_eligible_jobs");
  assert.equal(prepareCalls, 1);

  now = 1_300n;
  const restartedAtBoundary = await runCycle({ chain, state, prepareJob: transientThenSuccess });
  assert.equal(restartedAtBoundary.action, "submitted");
  assert.equal(restartedAtBoundary.jobId, "5");
  assert.equal(prepareCalls, 2);
});

test("restart recovers a prepare-retry job outside the bounded discovery page", async () => {
  const job = openJob(5n);
  const chain = mockChain({ jobs: [job], now: 1_300n });
  chain.listJobs = async () => [];
  const state = memoryState({
    version: 1,
    wasRegistered: true,
    halted: false,
    jobs: {
      "5": {
        phase: "prepare_retry",
        reason: "dns_error",
        permanent: false,
        attempts: 1,
        nextPrepareAttemptAt: "1300",
      },
    },
  });

  const result = await runCycle({ chain, state, prepareJob });

  assert.equal(result.action, "submitted");
  assert.equal(result.jobId, "5");
  assert.deepEqual(chain.calls.map((call) => [call[0], call[1]]), [["accept", "5"], ["submit", "5"]]);
});

test("fifth temporary prepare failure permanently rejects source_unavailable and alerts only once", async () => {
  const job = openJob(5n);
  let now = 1_000n;
  const chain = mockChain({ jobs: [job], now });
  chain.getChainTimestamp = async () => now;
  const state = memoryState();
  let prepareCalls = 0;
  const alwaysTransient = async () => {
    prepareCalls += 1;
    const error = new Error("temporary source failure");
    error.code = "dns_error";
    error.permanent = false;
    throw error;
  };

  const attemptTimes = [1_000n, 1_300n, 1_900n, 3_100n, 5_500n];
  let result;
  for (const attemptTime of attemptTimes) {
    now = attemptTime;
    result = await runCycle({ chain, state, prepareJob: alwaysTransient });
  }

  assert.equal(result.action, "no_eligible_jobs");
  assert.equal(result.alert, true);
  assert.deepEqual(state.inspect().jobs["5"], {
    phase: "rejected",
    reason: "source_unavailable",
    lastPrepareError: "dns_error",
    permanent: true,
    attempts: 5,
  });
  assert.equal(prepareCalls, 5);

  now = 50_000n;
  const afterRestart = await runCycle({ chain, state, prepareJob: alwaysTransient });
  assert.equal(afterRestart.action, "no_eligible_jobs");
  assert.equal(afterRestart.alert, undefined);
  assert.equal(prepareCalls, 5);
});

test("permanent prepare errors keep the existing immediate rejection behavior", async () => {
  const chain = mockChain({ jobs: [openJob(5n)] });
  const state = memoryState();
  const result = await runCycle({
    chain,
    state,
    prepareJob: async () => {
      const error = new Error("unsupported source");
      error.code = "unsupported_content_type";
      error.permanent = true;
      throw error;
    },
  });

  assert.equal(result.action, "no_eligible_jobs");
  assert.deepEqual(state.inspect().jobs["5"], {
    phase: "rejected",
    reason: "unsupported_content_type",
    permanent: true,
    attempts: 1,
  });
  assert.deepEqual(chain.calls, []);
});

test("house waits through 14399 seconds and accepts at 14400 after restart", async () => {
  const job = openJob(5n);
  job.createdAt = 1_000n;
  let now = 15_399n;
  const chain = mockChain({ jobs: [job], now, houseDelaySeconds: 14_400 });
  chain.getChainTimestamp = async () => now;
  let prepareCount = 0;
  const countingPrepare = async (candidate) => { prepareCount += 1; return prepareJob(candidate); };

  const before = await runCycle({ chain, state: memoryState(), prepareJob: countingPrepare });
  assert.equal(before.action, "no_eligible_jobs");
  assert.deepEqual(before.houseDelaySkips, [{ jobId: "5", reason: "house_delay_wait", openedAt: "1000", openingTimeSource: "createdAt", eligibleAt: "15400" }]);
  assert.equal(prepareCount, 0);
  assert.deepEqual(chain.calls, []);

  now = 15_400n;
  const restartedState = memoryState();
  const atBoundary = await runCycle({ chain, state: restartedState, prepareJob: countingPrepare });
  assert.equal(atBoundary.action, "submitted");
  assert.equal(atBoundary.jobOpeningTimeSource, "createdAt");
  assert.equal(atBoundary.jobOpenedAt, "1000");
  assert.equal(prepareCount, 1);
  assert.deepEqual(chain.calls.map((call) => call[0]), ["accept", "submit"]);
});

test("house uses the JobPosted block timestamp when createdAt is absent", async () => {
  const job = openJob(6n);
  delete job.createdAt;
  const chain = mockChain({ jobs: [job], now: 15_400n, houseDelaySeconds: 14_400, openingEventTimestamp: 1_000n });

  const result = await runCycle({ chain, state: memoryState(), prepareJob });

  assert.equal(result.action, "submitted");
  assert.equal(result.jobOpeningTimeSource, "JobPosted");
  assert.equal(result.jobOpenedAt, "1000");
});

test("house skips and reports an open job when opening time cannot be read", async () => {
  const job = openJob(7n);
  delete job.createdAt;
  const chain = mockChain({ jobs: [job], now: 20_000n, houseDelaySeconds: 14_400, openingTimeError: new Error("rpc unavailable") });
  let prepared = false;

  const result = await runCycle({ chain, state: memoryState(), prepareJob: async () => { prepared = true; } });

  assert.equal(result.action, "no_eligible_jobs");
  assert.deepEqual(result.houseDelaySkips, [{ jobId: "7", reason: "job_open_time_unavailable" }]);
  assert.equal(prepared, false);
  assert.deepEqual(chain.calls, []);
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

test("post-broadcast pending submit waits without blind retry and reaches timeout handling at the deadline", async () => {
  const job = openJob(21n);
  const chain = mockChain({ jobs: [job], now: 1_000n, submitError: new Error("receipt_timeout"), transactionStatus: "pending" });
  const state = memoryState();

  const first = await runCycle({ chain, state, prepareJob });
  assert.equal(first.action, "post_accept_retry_later");
  assert.equal(state.inspect().jobs["21"].phase, "submitting");
  assert.match(state.inspect().jobs["21"].submitTxHash, /^0xb{64}$/);

  const second = await runCycle({ chain, state, prepareJob });
  assert.equal(second.action, "broadcast_reconciliation_wait");
  assert.equal(chain.calls.filter((call) => call[0] === "submit").length, 1);

  chain.getChainTimestamp = async () => 87_400n;
  const third = await runCycle({ chain, state, prepareJob });
  assert.equal(third.action, "terminal_failure_wait");
  assert.equal(state.inspect().jobs["21"].phase, "terminal_failure");

  const fourth = await runCycle({ chain, state, prepareJob });
  assert.equal(fourth.action, "halted_after_slash");
  assert.deepEqual(chain.calls.map((call) => call[0]), ["accept", "submit", "timeout"]);
});

test("post-broadcast reverted submit is proven before retry is reopened", async () => {
  const job = openJob(22n);
  const chain = mockChain({ jobs: [job], now: 1_000n, submitError: new Error("submitDeliverable_receipt_failed"), transactionStatus: "reverted" });
  const state = memoryState();

  const first = await runCycle({ chain, state, prepareJob });
  assert.equal(first.action, "post_accept_retry_later");
  assert.equal(state.inspect().jobs["22"].phase, "submitting");

  const second = await runCycle({ chain, state, prepareJob });
  assert.equal(second.action, "submit_reverted_retry_later");
  assert.equal(state.inspect().jobs["22"].phase, "accepted");
  assert.equal(chain.calls.filter((call) => call[0] === "submit").length, 1);

  chain.submitDeliverable = async (id, uri, options = {}) => {
    chain.calls.push(["submit", String(id), uri]);
    const hash = "0x" + "e".repeat(64);
    if (options.onBroadcast) await options.onBroadcast(hash);
    job.status = 2;
    job.deliverableURI = uri;
    job.approvalDeadline = 87_400n;
    return { hash };
  };
  const third = await runCycle({ chain, state, prepareJob });
  assert.equal(third.action, "submitted");
  assert.equal(chain.calls.filter((call) => call[0] === "submit").length, 2);
});

test("post-broadcast successful receipt never reopens retry while job state catches up", async () => {
  const job = openJob(23n);
  const chain = mockChain({ jobs: [job], now: 1_000n, submitError: new Error("submit_receipt_state_mismatch"), transactionStatus: "success" });
  const state = memoryState();

  const first = await runCycle({ chain, state, prepareJob });
  assert.equal(first.action, "post_accept_retry_later");
  assert.equal(state.inspect().jobs["23"].phase, "submitting");

  const second = await runCycle({ chain, state, prepareJob });
  assert.equal(second.action, "broadcast_reconciliation_wait");
  assert.equal(chain.calls.filter((call) => call[0] === "submit").length, 1);

  job.status = 2;
  job.deliverableURI = state.inspect().jobs["23"].deliveryUri;
  job.approvalDeadline = 87_400n;
  const third = await runCycle({ chain, state, prepareJob });
  assert.equal(third.action, "awaiting_customer_approval");
  assert.equal(chain.calls.filter((call) => call[0] === "submit").length, 1);
});

test("successful submit receipt with stale InProgress state still reaches deadline handling", async () => {
  const job = openJob(24n);
  job.status = 1;
  job.agent = agentAddress;
  job.deliveryDeadline = 2_000n;
  const chain = mockChain({ jobs: [job], now: 2_000n, transactionStatus: "success" });
  const state = memoryState({ version: 1, wasRegistered: true, halted: false, jobs: { "24": {
    phase: "submitting",
    cid: "bafy24",
    deliveryUri: "https://gateway.example/ipfs/bafy24/index.html",
    resultUri: "https://gateway.example/ipfs/bafy24/result.json",
    submitTxHash: "0x" + "b".repeat(64),
    submitAttempts: 1,
  } } });

  const result = await runCycle({ chain, state, prepareJob });
  assert.equal(result.action, "terminal_failure_wait");
  assert.equal(state.inspect().jobs["24"].phase, "terminal_failure");
  assert.equal(state.inspect().jobs["24"].reason, "delivery_deadline_reached");
  assert.equal(chain.calls.filter((call) => call[0] === "submit").length, 0);
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

test("transient post-accept failures keep retrying beyond three attempts while far from deadline", async () => {
  const job = openJob(16n);
  const chain = mockChain({ jobs: [job], now: 1_000n });
  chain.submitDeliverable = async (id, uri) => {
    chain.calls.push(["submit", String(id), uri]);
    throw new Error("rpc_temporarily_unavailable");
  };
  const state = memoryState();

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const result = await runCycle({ chain, state, prepareJob });
    assert.equal(result.action, "post_accept_retry_later");
    assert.equal(result.attempt, attempt);
    assert.notEqual(state.inspect().jobs["16"].phase, "terminal_failure");
  }
  assert.equal(state.inspect().jobs["16"].submitAttempts, 4);
  assert.deepEqual(chain.calls.map((call) => call[0]), ["accept", "submit", "submit", "submit", "submit"]);
});

test("persisted submitAttempts remain diagnostic and do not consume the deadline retry budget after restart", async () => {
  const job = openJob(17n);
  job.status = 1;
  job.agent = agentAddress;
  job.deliveryDeadline = 87_400n;
  const chain = mockChain({ jobs: [job], now: 1_000n });
  chain.submitDeliverable = async (id, uri) => {
    chain.calls.push(["submit", String(id), uri]);
    throw new Error("rpc_temporarily_unavailable");
  };
  const state = memoryState({ version: 1, wasRegistered: true, halted: false, jobs: { "17": {
    phase: "accepted",
    cid: "bafy17",
    deliveryUri: "https://gateway.example/ipfs/bafy17/index.html",
    resultUri: "https://gateway.example/ipfs/bafy17/result.json",
    submitAttempts: 99,
  } } });

  const result = await runCycle({ chain, state, prepareJob });
  assert.equal(result.action, "post_accept_retry_later");
  assert.equal(result.attempt, 100);
  assert.equal(state.inspect().jobs["17"].submitAttempts, 100);
  assert.notEqual(state.inspect().jobs["17"].phase, "terminal_failure");
  assert.deepEqual(chain.calls.map((call) => call[0]), ["submit"]);
});

test("transient submission gets one more attempt with 301 seconds remaining", async () => {
  const job = openJob(19n);
  job.status = 1;
  job.agent = agentAddress;
  job.deliveryDeadline = 2_181n;
  const chain = mockChain({ jobs: [job], now: 1_880n });
  chain.submitDeliverable = async (id, uri) => {
    chain.calls.push(["submit", String(id), uri]);
    throw new Error("rpc_temporarily_unavailable");
  };
  const state = memoryState({ version: 1, wasRegistered: true, halted: false, jobs: { "19": {
    phase: "accepted",
    cid: "bafy19",
    deliveryUri: "https://gateway.example/ipfs/bafy19/index.html",
    resultUri: "https://gateway.example/ipfs/bafy19/result.json",
    submitAttempts: 7,
  } } });

  const result = await runCycle({ chain, state, prepareJob });
  assert.equal(result.action, "post_accept_retry_later");
  assert.equal(result.attempt, 8);
  assert.notEqual(state.inspect().jobs["19"].phase, "terminal_failure");
  assert.deepEqual(chain.calls.map((call) => call[0]), ["submit"]);
});

test("a transient attempt crossing into the final 300 seconds becomes terminal after the error", async () => {
  const job = openJob(20n);
  job.status = 1;
  job.agent = agentAddress;
  job.deliveryDeadline = 2_181n;
  const chain = mockChain({ jobs: [job], now: 1_880n });
  let timestampReads = 0;
  chain.getChainTimestamp = async () => (++timestampReads === 1 ? 1_880n : 1_881n);
  chain.submitDeliverable = async (id, uri) => {
    chain.calls.push(["submit", String(id), uri]);
    throw new Error("rpc_temporarily_unavailable");
  };
  const state = memoryState({ version: 1, wasRegistered: true, halted: false, jobs: { "20": {
    phase: "accepted",
    cid: "bafy20",
    deliveryUri: "https://gateway.example/ipfs/bafy20/index.html",
    resultUri: "https://gateway.example/ipfs/bafy20/result.json",
    submitAttempts: 2,
  } } });

  const result = await runCycle({ chain, state, prepareJob });
  assert.equal(result.action, "terminal_failure_wait");
  assert.equal(state.inspect().jobs["20"].phase, "terminal_failure");
  assert.equal(state.inspect().jobs["20"].reason, "delivery_deadline_imminent");
  assert.equal(state.inspect().jobs["20"].submitAttempts, 3);
  assert.equal(timestampReads, 2);
  assert.deepEqual(chain.calls.map((call) => call[0]), ["submit"]);
});

test("transient submission stops before starting a new attempt inside the final 300 seconds", async () => {
  const job = openJob(18n);
  job.status = 1;
  job.agent = agentAddress;
  job.deliveryDeadline = 2_180n;
  const chain = mockChain({ jobs: [job], now: 1_880n });
  const state = memoryState({ version: 1, wasRegistered: true, halted: false, jobs: { "18": {
    phase: "accepted",
    cid: "bafy18",
    deliveryUri: "https://gateway.example/ipfs/bafy18/index.html",
    resultUri: "https://gateway.example/ipfs/bafy18/result.json",
    submitAttempts: 7,
  } } });

  const result = await runCycle({ chain, state, prepareJob });
  assert.equal(result.action, "terminal_failure_wait");
  assert.equal(state.inspect().jobs["18"].phase, "terminal_failure");
  assert.equal(state.inspect().jobs["18"].reason, "delivery_deadline_imminent");
  assert.equal(state.inspect().jobs["18"].submitAttempts, 7);
  assert.deepEqual(chain.calls, []);
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

test("submitted work waits before the inclusive approval deadline and blocks new work", async () => {
  const submitted = submittedJob(30n, 2_000n);
  const chain = mockChain({ jobs: [submitted, openJob(31n)], now: 1_999n });
  const state = memoryState({ version: 1, wasRegistered: true, halted: false, jobs: { "30": { phase: "submitted", deliveryUri: submitted.deliverableURI } } });

  const result = await runCycle({ chain, state, prepareJob });

  assert.equal(result.action, "awaiting_customer_approval");
  assert.deepEqual(chain.calls, []);
});

test("submitted work claims payout at and after the inclusive approval deadline", async () => {
  for (const now of [2_000n, 2_001n]) {
    const submitted = submittedJob(now === 2_000n ? 32n : 33n, 2_000n);
    const chain = mockChain({ jobs: [submitted], now });
    const state = memoryState({ version: 1, wasRegistered: true, halted: false, jobs: { [String(submitted.id)]: { phase: "submitted", deliveryUri: submitted.deliverableURI } } });

    const result = await runCycle({ chain, state, prepareJob });

    assert.equal(result.action, "approval_timeout_claimed");
    assert.equal(state.inspect().jobs[String(submitted.id)].phase, "payout_claimed");
    assert.deepEqual(chain.calls, [["approval-timeout", String(submitted.id)]]);
  }
});

test("approval or dispute race before payout broadcast is classified without accepting new work", async () => {
  for (const racedStatus of [4, 3]) {
    const submitted = submittedJob(BigInt(34 + racedStatus), 2_000n);
    const open = openJob(40n + BigInt(racedStatus));
    const chain = mockChain({ jobs: [submitted, open], now: 2_000n });
    chain.claimApprovalTimeout = async () => {
      submitted.status = racedStatus;
      const error = new Error("execution reverted");
      error.name = "ContractFunctionExecutionError";
      throw error;
    };
    const state = memoryState({ version: 1, wasRegistered: true, halted: false, jobs: { [String(submitted.id)]: { phase: "submitted", deliveryUri: submitted.deliverableURI } } });

    const result = await runCycle({ chain, state, prepareJob });

    assert.equal(result.action, racedStatus === 4 ? "settlement_observed" : "awaiting_dispute_resolution");
    assert.equal(chain.calls.some((call) => call[0] === "accept"), false);
  }
});

test("receipt unavailability starts durable cooldown and never blindly resends after restart", async () => {
  const submitted = submittedJob(41n, 2_000n);
  let now = 2_000n;
  const chain = mockChain({ jobs: [submitted], now, transactionStatus: "pending" });
  chain.getChainTimestamp = async () => now;
  chain.claimApprovalTimeout = async (id, options = {}) => {
    chain.calls.push(["approval-timeout", String(id)]);
    await options.onBroadcast("0x" + "f".repeat(64));
    const error = new Error("receipt_timeout");
    error.transactionStage = "receipt";
    throw error;
  };
  const state = memoryState({ version: 1, wasRegistered: true, halted: false, jobs: { "41": { phase: "submitted", deliveryUri: submitted.deliverableURI } } });

  const first = await runCycle({ chain, state, prepareJob });
  assert.equal(first.action, "payout_cooldown_wait");
  assert.equal(state.inspect().jobs["41"].payoutAttempts, 1);
  assert.equal(state.inspect().jobs["41"].nextPayoutAttemptAt, "2060");

  now = 2_059n;
  const restartedBeforeBoundary = await runCycle({ chain, state, prepareJob });
  assert.equal(restartedBeforeBoundary.action, "payout_cooldown_wait");
  assert.equal(chain.calls.filter((call) => call[0] === "approval-timeout").length, 1);

  now = 2_060n;
  const atBoundary = await runCycle({ chain, state, prepareJob });
  assert.equal(atBoundary.action, "payout_broadcast_reconciliation_wait");
  assert.equal(chain.calls.filter((call) => call[0] === "approval-timeout").length, 1);
});

test("restart reconciles pending, successful, and reverted payout broadcasts", async () => {
  for (const transactionStatus of ["pending", "success", "reverted"]) {
    const submitted = submittedJob(transactionStatus === "pending" ? 42n : transactionStatus === "success" ? 43n : 44n, 2_000n);
    if (transactionStatus === "success") submitted.status = 7;
    const chain = mockChain({ jobs: [submitted], now: 2_060n, transactionStatus });
    const state = memoryState({ version: 1, wasRegistered: true, halted: false, jobs: { [String(submitted.id)]: {
      phase: "claiming_payout",
      deliveryUri: submitted.deliverableURI,
      payoutTxHash: "0x" + "f".repeat(64),
      payoutAttempts: 1,
      payoutAttemptCountedHash: "0x" + "f".repeat(64),
      nextPayoutAttemptAt: "2060",
    } } });

    const result = await runCycle({ chain, state, prepareJob });

    assert.equal(result.action, transactionStatus === "success" ? "approval_timeout_claimed" : transactionStatus === "reverted" ? "payout_reverted_retry_later" : "payout_broadcast_reconciliation_wait");
    assert.equal(chain.calls.some((call) => call[0] === "approval-timeout"), false);
    assert.equal(state.inspect().jobs[String(submitted.id)].phase, transactionStatus === "success" ? "payout_claimed" : transactionStatus === "reverted" ? "submitted" : "claiming_payout");
  }
});

test("payout cooldown survives restart and allows a new broadcast exactly at the chain-time boundary", async () => {
  const submitted = submittedJob(52n, 2_000n);
  let now = 2_119n;
  const chain = mockChain({ jobs: [submitted], now });
  chain.getChainTimestamp = async () => now;
  const state = memoryState({ version: 1, wasRegistered: true, halted: false, jobs: { "52": {
    phase: "submitted",
    deliveryUri: submitted.deliverableURI,
    payoutAttempts: 2,
    nextPayoutAttemptAt: "2120",
  } } });

  const before = await runCycle({ chain, state, prepareJob });
  assert.equal(before.action, "payout_cooldown_wait");
  assert.deepEqual(chain.calls, []);

  now = 2_120n;
  const boundary = await runCycle({ chain, state, prepareJob });
  assert.equal(boundary.action, "approval_timeout_claimed");
  assert.deepEqual(chain.calls, [["approval-timeout", "52"]]);
});

test("five failed broadcast attempts require attention and block all further automatic claims", async () => {
  const submitted = submittedJob(53n, 2_000n);
  let now = 2_000n;
  const chain = mockChain({ jobs: [submitted], now, transactionStatus: "reverted" });
  chain.getChainTimestamp = async () => now;
  chain.claimApprovalTimeout = async (id, options = {}) => {
    chain.calls.push(["approval-timeout", String(id)]);
    const hash = `0x${String(chain.calls.filter((call) => call[0] === "approval-timeout").length).padStart(64, "0")}`;
    await options.onBroadcast(hash);
    const error = new Error("claimTimeout_receipt_failed");
    error.transactionStage = "receipt";
    throw error;
  };
  const state = memoryState({ version: 1, wasRegistered: true, halted: false, jobs: { "53": { phase: "submitted", deliveryUri: submitted.deliverableURI } } });

  let result;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    result = await runCycle({ chain, state, prepareJob });
    assert.equal(result.action, "payout_cooldown_wait");
    assert.equal(state.inspect().jobs["53"].payoutAttempts, attempt);
    const expectedDelay = 60n * (2n ** BigInt(attempt - 1));
    assert.equal(state.inspect().jobs["53"].nextPayoutAttemptAt, String(now + expectedDelay));
    now += expectedDelay;
    result = await runCycle({ chain, state, prepareJob });
    assert.equal(result.action, attempt === 5 ? "payout_needs_attention" : "payout_reverted_retry_later");
    if (attempt < 5) result = await runCycle({ chain, state, prepareJob });
  }

  assert.equal(state.inspect().jobs["53"].phase, "payout_needs_attention");
  assert.equal(result.alert, true);
  const callCount = chain.calls.filter((call) => call[0] === "approval-timeout").length;
  const blocked = await runCycle({ chain, state, prepareJob });
  assert.equal(blocked.action, "payout_needs_attention_wait");
  assert.equal(chain.calls.filter((call) => call[0] === "approval-timeout").length, callCount);
});

test("simulation revert applies short cooldown without incrementing payout attempts", async () => {
  const submitted = submittedJob(54n, 2_000n);
  let now = 2_000n;
  const chain = mockChain({ jobs: [submitted], now });
  chain.getChainTimestamp = async () => now;
  chain.claimApprovalTimeout = async () => {
    const error = new Error("execution reverted");
    error.transactionStage = "simulation";
    throw error;
  };
  const state = memoryState({ version: 1, wasRegistered: true, halted: false, jobs: { "54": { phase: "submitted", deliveryUri: submitted.deliverableURI, payoutAttempts: 2 } } });

  const first = await runCycle({ chain, state, prepareJob });
  assert.equal(first.action, "payout_simulation_cooldown");
  assert.equal(state.inspect().jobs["54"].payoutAttempts, 2);
  assert.equal(state.inspect().jobs["54"].payoutSimulationFailures, 1);
  assert.equal(state.inspect().jobs["54"].nextPayoutAttemptAt, "2060");

  now = 2_059n;
  const second = await runCycle({ chain, state, prepareJob });
  assert.equal(second.action, "payout_cooldown_wait");
  assert.equal(state.inspect().jobs["54"].payoutAttempts, 2);
});

test("the tenth consecutive payout simulation failure alerts once and a broadcast resets the streak", async () => {
  const submitted = submittedJob(57n, 2_000n);
  let now = 2_000n;
  const chain = mockChain({ jobs: [submitted], now });
  const successfulClaim = chain.claimApprovalTimeout;
  chain.getChainTimestamp = async () => now;
  chain.claimApprovalTimeout = async () => {
    const error = new Error("execution reverted");
    error.transactionStage = "simulation";
    throw error;
  };
  const state = memoryState({ version: 1, wasRegistered: true, halted: false, jobs: { "57": { phase: "submitted", deliveryUri: submitted.deliverableURI, payoutAttempts: 2 } } });

  for (let failure = 1; failure <= 11; failure += 1) {
    const result = await runCycle({ chain, state, prepareJob });
    assert.equal(result.action, "payout_simulation_cooldown");
    assert.equal(result.alert, failure === 10 ? true : undefined);
    assert.equal(state.inspect().jobs["57"].payoutSimulationFailures, failure);
    assert.equal(state.inspect().jobs["57"].payoutAttempts, 2);
    now += 60n;
  }

  assert.equal(state.inspect().jobs["57"].payoutSimulationAlerted, true);
  chain.claimApprovalTimeout = successfulClaim;
  const claimed = await runCycle({ chain, state, prepareJob });
  assert.equal(claimed.action, "approval_timeout_claimed");
  assert.equal(state.inspect().jobs["57"].payoutSimulationFailures, 0);
  assert.equal(state.inspect().jobs["57"].payoutSimulationAlerted, undefined);
});

test("pending payout is tolerated through 30 chain-time minutes then requires attention once", async () => {
  const submitted = submittedJob(58n, 2_000n);
  let now = 3_800n;
  const txHash = "0x" + "e".repeat(64);
  const chain = mockChain({ jobs: [submitted], now, transactionStatus: "pending" });
  chain.getChainTimestamp = async () => now;
  const state = memoryState({ version: 1, wasRegistered: true, halted: false, jobs: { "58": {
    phase: "claiming_payout",
    deliveryUri: submitted.deliverableURI,
    payoutTxHash: txHash,
    payoutBroadcastAtChainTimestamp: "2000",
    payoutAttempts: 1,
    payoutAttemptCountedHash: txHash,
    nextPayoutAttemptAt: "9999",
  } } });

  const boundary = await runCycle({ chain, state, prepareJob });
  assert.equal(boundary.action, "payout_cooldown_wait");
  assert.equal(state.inspect().jobs["58"].phase, "claiming_payout");

  now = 3_801n;
  const expired = await runCycle({ chain, state, prepareJob });
  assert.equal(expired.action, "payout_needs_attention");
  assert.equal(expired.alert, true);
  assert.equal(expired.reason, "payout_transaction_pending_too_long");

  const repeated = await runCycle({ chain, state, prepareJob });
  assert.equal(repeated.action, "payout_needs_attention_wait");
  assert.equal(repeated.alert, undefined);
});

test("ambiguous broadcast failure without a transaction hash fails closed for operator attention", async () => {
  const submitted = submittedJob(56n, 2_000n);
  const chain = mockChain({ jobs: [submitted], now: 2_001n });
  chain.claimApprovalTimeout = async () => {
    chain.calls.push(["approval-timeout", "56"]);
    const error = new Error("wallet rpc response unavailable");
    error.transactionStage = "broadcast";
    throw error;
  };
  const state = memoryState({ version: 1, wasRegistered: true, halted: false, jobs: { "56": { phase: "submitted", deliveryUri: submitted.deliverableURI } } });

  const first = await runCycle({ chain, state, prepareJob });
  assert.equal(first.action, "payout_needs_attention");
  assert.equal(first.alert, true);
  assert.equal(first.reason, "payout_broadcast_state_unknown");
  assert.equal(state.inspect().jobs["56"].payoutAttempts, undefined);

  const second = await runCycle({ chain, state, prepareJob });
  assert.equal(second.action, "payout_needs_attention_wait");
  assert.equal(chain.calls.filter((call) => call[0] === "approval-timeout").length, 1);
});

test("read-only submitted payout path performs no writes and does not mutate durable state", async () => {
  const submitted = submittedJob(55n, 2_000n);
  const chain = mockChain({ jobs: [submitted], now: 2_001n, writeEnabled: false });
  const initial = { version: 1, wasRegistered: true, halted: false, jobs: { "55": { phase: "submitted", deliveryUri: submitted.deliverableURI } } };
  const state = memoryState(initial);

  const result = await runCycle({ chain, state, prepareJob });

  assert.equal(result.action, "awaiting_payout_claim_readonly");
  assert.equal(state.saves(), 0);
  assert.deepEqual(state.inspect(), initial);
  assert.deepEqual(chain.calls, []);
});

test("completed and expired-payout history does not block the next open job", async () => {
  const completed = { ...submittedJob(45n), status: 4 };
  const expired = { ...submittedJob(46n), status: 7 };
  const open = openJob(47n);
  const chain = mockChain({ jobs: [completed, expired, open], now: 1_000n, pilotJobId: 47n });
  const state = memoryState({ version: 1, wasRegistered: true, halted: false, jobs: {
    "45": { phase: "completed", deliveryUri: completed.deliverableURI },
    "46": { phase: "payout_claimed", deliveryUri: expired.deliverableURI },
  } });

  const result = await runCycle({ chain, state, prepareJob });

  assert.equal(result.action, "submitted");
  assert.deepEqual(chain.calls.map((call) => call[0]), ["accept", "submit"]);
});

test("owned disputed work blocks acceptance of another job", async () => {
  const disputed = { ...submittedJob(48n), status: 3 };
  const chain = mockChain({ jobs: [disputed, openJob(49n)], now: 2_001n });
  const state = memoryState({ version: 1, wasRegistered: true, halted: false, jobs: { "48": { phase: "submitted", deliveryUri: disputed.deliverableURI } } });

  const result = await runCycle({ chain, state, prepareJob });

  assert.equal(result.action, "awaiting_dispute_resolution");
  assert.deepEqual(chain.calls, []);
});

test("a non-pilot submitted job blocks payout even when the pilot payout is eligible", async () => {
  const firstJob = submittedJob(50n, 2_000n);
  const secondJob = submittedJob(51n, 2_000n);
  const chain = mockChain({ jobs: [secondJob, firstJob], now: 2_001n, pilotJobId: 50n });
  const state = memoryState({ version: 1, wasRegistered: true, halted: false, jobs: {
    "50": { phase: "submitted", deliveryUri: firstJob.deliverableURI },
    "51": { phase: "submitted", deliveryUri: secondJob.deliverableURI },
  } });

  const result = await runCycle({ chain, state, prepareJob });

  assert.equal(result.action, "pilot_scope_owned_job_wait");
  assert.equal(result.jobId, "51");
  assert.equal(result.alert, true);
  assert.deepEqual(result.pilotScopeSkips, [{ jobId: "51", status: 2, reason: "pilot_scope_skip" }]);
  assert.deepEqual(chain.calls, []);
  assert.equal(state.inspect().jobs["50"].phase, "submitted");
  assert.equal(state.inspect().jobs["51"].phase, "submitted");
});

test("a previously registered wallet never auto-registers after registration is lost", async () => {
  const chain = mockChain({ registered: false });
  const state = memoryState({ version: 1, wasRegistered: true, halted: false, jobs: {} });
  const result = await runCycle({ chain, state, prepareJob });
  assert.equal(result.action, "registration_lost_halt");
  assert.equal(state.inspect().halted, true);
  assert.deepEqual(chain.calls, []);
});
