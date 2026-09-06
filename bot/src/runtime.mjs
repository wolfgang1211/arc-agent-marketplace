import { hasGasReserve, parseEligibleJob } from "./eligibility.mjs";

const STATE_VERSION = 1;
// Reserve five minutes for bounded RPC retries and receipt confirmation; do not start a new submit inside this window.
export const MIN_SUBMIT_ATTEMPT_WINDOW_SECONDS = 300n;

export async function runCycle({ chain, state, prepareJob }) {
  await chain.assertChain();
  let snapshot = normalizeState(await state.load());
  if (snapshot.halted) return { action: "halted", reason: snapshot.haltReason || "halted" };

  const agent = await chain.getAgent();
  if (!agent.registered) {
    if (snapshot.wasRegistered) {
      snapshot.halted = true;
      snapshot.haltReason = "registration_lost";
      await state.save(snapshot);
      return { action: "registration_lost_halt" };
    }
    return { action: "not_registered" };
  }
  if (!snapshot.wasRegistered) {
    snapshot.wasRegistered = true;
    await state.save(snapshot);
  }

  let jobs = await chain.listJobs();
  const knownIds = Object.entries(snapshot.jobs)
    .filter(([, record]) => ["prepared", "accepting", "accepted", "submitting", "submitted", "terminal_failure", "timing_out"].includes(record?.phase))
    .map(([jobId]) => jobId);
  if (knownIds.length > 0) {
    const recovered = await Promise.all(knownIds.map((jobId) => chain.getJob(jobId)));
    const byJobId = new Map(jobs.map((job) => [String(job.id), job]));
    for (const job of recovered) if (job) byJobId.set(String(job.id), job);
    jobs = [...byJobId.values()];
  }
  const completed = jobs.find((job) => Number(job.status) === 4 && sameAddress(job.agent, chain.address) && snapshot.jobs[String(job.id)]);
  if (completed) {
    const jobId = String(completed.id);
    const record = snapshot.jobs[jobId];
    if (record.phase !== "completed") {
      const [native, usdc] = await Promise.all([chain.getNativeBalance(), chain.getUsdcBalance()]);
      record.phase = "completed";
      record.balanceAfterSettlement = { native: String(native), usdc: String(usdc) };
      record.completedAt = new Date().toISOString();
      await state.save(snapshot);
    }
    return {
      action: "settlement_observed",
      jobId,
      deliveryUri: record.deliveryUri,
      acceptTxHash: record.acceptTxHash,
      submitTxHash: record.submitTxHash,
      balanceBeforeAccept: record.balanceBeforeAccept,
      balanceAfterSettlement: record.balanceAfterSettlement,
    };
  }

  const ambiguousBroadcast = jobs.find((job) => {
    const phase = snapshot.jobs[String(job.id)]?.phase;
    return (phase === "accepting" && Number(job.status) === 0)
      || (phase === "submitting" && Number(job.status) === 1)
      || (phase === "timing_out" && Number(job.status) === 1);
  });
  if (ambiguousBroadcast) {
    const record = snapshot.jobs[String(ambiguousBroadcast.id)];
    if (record.phase === "submitting") {
      return reconcileAmbiguousSubmit({ chain, state, snapshot, job: ambiguousBroadcast, record });
    }
    return { action: "broadcast_reconciliation_wait", jobId: String(ambiguousBroadcast.id), phase: record.phase, txHash: record.acceptTxHash || record.submitTxHash || record.timeoutTxHash };
  }

  const ownedActive = jobs
    .filter((job) => Number(job.status) === 1 && sameAddress(job.agent, chain.address))
    .sort(byId)[0];
  if (ownedActive) return handleOwnedInProgress({ chain, state, snapshot, job: ownedActive, prepareJob });

  const ownedSubmitted = jobs.find((job) => Number(job.status) === 2 && sameAddress(job.agent, chain.address));
  if (ownedSubmitted) return { action: "awaiting_customer_approval", jobId: String(ownedSubmitted.id), deliveryUri: ownedSubmitted.deliverableURI };

  const balance = await chain.getNativeBalance();
  if (!hasGasReserve(balance)) return { action: "gas_guard", balance: String(balance) };

  const openJobs = jobs.filter((job) => Number(job.status) === 0).sort(byId);
  for (const job of openJobs) {
    const jobId = String(job.id);
    if (sameAddress(job.client, chain.address)) {
      snapshot.jobs[jobId] = { phase: "rejected", reason: "self_authored_job", permanent: true };
      await state.save(snapshot);
      continue;
    }
    const eligibility = parseEligibleJob(job);
    if (!eligibility.ok) {
      snapshot.jobs[jobId] = { phase: "rejected", reason: eligibility.reason, permanent: true };
      await state.save(snapshot);
      continue;
    }
    if (snapshot.jobs[jobId]?.phase === "rejected" && snapshot.jobs[jobId]?.permanent) continue;

    let prepared;
    try {
      prepared = await prepareJob(job, eligibility.request);
      assertPreparedArtifact(prepared);
    } catch (error) {
      const permanent = error?.permanent === true;
      snapshot.jobs[jobId] = {
        phase: "rejected",
        reason: safeReason(error),
        permanent,
        attempts: Number(snapshot.jobs[jobId]?.attempts || 0) + 1,
      };
      await state.save(snapshot);
      if (!permanent) return { action: "prepare_retry_later", jobId, reason: safeReason(error) };
      continue;
    }

    snapshot.jobs[jobId] = {
      phase: "prepared",
      request: eligibility.request,
      cid: prepared.cid,
      deliveryUri: prepared.deliveryUri,
      resultUri: prepared.resultUri,
      preparedAt: new Date().toISOString(),
      submitAttempts: 0,
    };
    await state.save(snapshot);

    const freshJob = await chain.getJob(job.id);
    if (!freshJob || Number(freshJob.status) !== 0) {
      snapshot.jobs[jobId].phase = "accept_race_lost";
      await state.save(snapshot);
      return { action: "accept_race_lost", jobId };
    }
    const freshBalance = await chain.getNativeBalance();
    if (!hasGasReserve(freshBalance)) return { action: "gas_guard", balance: String(freshBalance), preparedJobId: jobId };
    const freshUsdcBalance = await chain.getUsdcBalance();
    snapshot.jobs[jobId].balanceBeforeAccept = { native: String(freshBalance), usdc: String(freshUsdcBalance) };
    await state.save(snapshot);

    const accepted = await chain.acceptJob(job.id, {
      onBroadcast: async (hash) => {
        snapshot.jobs[jobId].phase = "accepting";
        snapshot.jobs[jobId].acceptTxHash = hash;
        snapshot.jobs[jobId].acceptBroadcastAt = new Date().toISOString();
        await state.save(snapshot);
      },
    });
    snapshot.jobs[jobId].phase = "accepted";
    snapshot.jobs[jobId].acceptTxHash = accepted.hash;
    await state.save(snapshot);

    const acceptedJob = await chain.getJob(job.id);
    if (!acceptedJob || Number(acceptedJob.status) !== 1 || !sameAddress(acceptedJob.agent, chain.address)) {
      throw new Error("accept_receipt_state_mismatch");
    }
    return submitPrepared({ chain, state, snapshot, job: acceptedJob });
  }

  return { action: "no_eligible_jobs" };
}

async function handleOwnedInProgress({ chain, state, snapshot, job, prepareJob }) {
  const jobId = String(job.id);
  let record = snapshot.jobs[jobId];
  if (record?.phase === "terminal_failure") {
    const chainTimestamp = await chain.getChainTimestamp();
    if (chainTimestamp < BigInt(job.deliveryDeadline)) {
      return { action: "terminal_failure_wait", jobId, deadline: String(job.deliveryDeadline), reason: record.reason };
    }
    const settled = await chain.claimTimeout(job.id, {
      onBroadcast: async (hash) => {
        record.phase = "timing_out";
        record.timeoutTxHash = hash;
        record.timeoutBroadcastAt = new Date().toISOString();
        await state.save(snapshot);
      },
    });
    const [settledJob, settledAgent] = await Promise.all([chain.getJob(job.id), chain.getAgent()]);
    if (Number(settledJob?.status) !== 6 || settledAgent.registered || settledAgent.stake !== 0n) {
      throw new Error("timeout_settlement_state_mismatch");
    }
    record.phase = "slashed";
    record.timeoutTxHash = settled.hash;
    snapshot.halted = true;
    snapshot.haltReason = "agent_slashed";
    await state.save(snapshot);
    return { action: "halted_after_slash", jobId, timeoutTxHash: settled.hash };
  }

  if (!record?.deliveryUri) {
    const eligibility = parseEligibleJob(job);
    if (!eligibility.ok) return markTerminalFailure({ state, snapshot, job, reason: `accepted_job_${eligibility.reason}` });
    try {
      const prepared = await prepareJob(job, eligibility.request);
      assertPreparedArtifact(prepared);
      record = {
        ...(record || {}),
        phase: "accepted",
        request: eligibility.request,
        cid: prepared.cid,
        deliveryUri: prepared.deliveryUri,
        resultUri: prepared.resultUri,
        submitAttempts: Number(record?.submitAttempts || 0),
      };
      snapshot.jobs[jobId] = record;
      await state.save(snapshot);
    } catch (error) {
      return handlePostAcceptError({ chain, state, snapshot, job, error });
    }
  }
  return submitPrepared({ chain, state, snapshot, job });
}

async function submitPrepared({ chain, state, snapshot, job }) {
  const jobId = String(job.id);
  const chainTimestamp = await chain.getChainTimestamp();
  if (chainTimestamp >= BigInt(job.deliveryDeadline)) {
    return markTerminalFailure({ state, snapshot, job, reason: "delivery_deadline_reached" });
  }
  if (BigInt(job.deliveryDeadline) - chainTimestamp <= MIN_SUBMIT_ATTEMPT_WINDOW_SECONDS) {
    return markTerminalFailure({ state, snapshot, job, reason: "delivery_deadline_imminent" });
  }
  try {
    const submitted = await chain.submitDeliverable(job.id, snapshot.jobs[jobId].deliveryUri, {
      onBroadcast: async (hash) => {
        snapshot.jobs[jobId].phase = "submitting";
        snapshot.jobs[jobId].submitTxHash = hash;
        snapshot.jobs[jobId].submitBroadcastAt = new Date().toISOString();
        await state.save(snapshot);
      },
    });
    const fresh = await chain.getJob(job.id);
    if (Number(fresh?.status) !== 2 || fresh.deliverableURI !== snapshot.jobs[jobId].deliveryUri) {
      throw new Error("submit_receipt_state_mismatch");
    }
    snapshot.jobs[jobId].phase = "submitted";
    snapshot.jobs[jobId].submitTxHash = submitted.hash;
    await state.save(snapshot);
    return {
      action: "submitted",
      jobId,
      cid: snapshot.jobs[jobId].cid,
      deliveryUri: snapshot.jobs[jobId].deliveryUri,
      resultUri: snapshot.jobs[jobId].resultUri,
      acceptTxHash: snapshot.jobs[jobId].acceptTxHash,
      submitTxHash: submitted.hash,
    };
  } catch (error) {
    return handlePostAcceptError({ chain, state, snapshot, job, error });
  }
}

async function handlePostAcceptError({ chain, state, snapshot, job, error }) {
  const jobId = String(job.id);
  const record = snapshot.jobs[jobId] || { phase: "accepted", submitAttempts: 0 };
  record.submitAttempts = Number(record.submitAttempts || 0) + 1;
  record.reason = safeReason(error);
  snapshot.jobs[jobId] = record;
  if (error?.permanent === true) {
    return markTerminalFailure({ state, snapshot, job, reason: record.reason });
  }
  const chainTimestamp = await chain.getChainTimestamp();
  if (BigInt(job.deliveryDeadline) - chainTimestamp <= MIN_SUBMIT_ATTEMPT_WINDOW_SECONDS) {
    return markTerminalFailure({ state, snapshot, job, reason: "delivery_deadline_imminent" });
  }
  await state.save(snapshot);
  return { action: "post_accept_retry_later", jobId, attempt: record.submitAttempts, reason: record.reason };
}

async function reconcileAmbiguousSubmit({ chain, state, snapshot, job, record }) {
  const jobId = String(job.id);
  const txHash = record.submitTxHash;
  if (!txHash) return { action: "broadcast_reconciliation_wait", jobId, phase: record.phase };
  const transactionStatus = await chain.getTransactionStatus(txHash);
  if (transactionStatus === "reverted") {
    const chainTimestamp = await chain.getChainTimestamp();
    if (BigInt(job.deliveryDeadline) - chainTimestamp <= MIN_SUBMIT_ATTEMPT_WINDOW_SECONDS) {
      return markTerminalFailure({ state, snapshot, job, reason: "delivery_deadline_imminent" });
    }
    record.phase = "accepted";
    record.reason = "submit_transaction_reverted";
    await state.save(snapshot);
    return { action: "submit_reverted_retry_later", jobId, txHash };
  }
  const chainTimestamp = await chain.getChainTimestamp();
  if (chainTimestamp >= BigInt(job.deliveryDeadline)) {
    return markTerminalFailure({ state, snapshot, job, reason: "delivery_deadline_reached" });
  }
  return { action: "broadcast_reconciliation_wait", jobId, phase: record.phase, txHash };
}

async function markTerminalFailure({ state, snapshot, job, reason }) {
  const jobId = String(job.id);
  snapshot.jobs[jobId] = {
    ...(snapshot.jobs[jobId] || {}),
    phase: "terminal_failure",
    reason,
    failedAt: new Date().toISOString(),
  };
  await state.save(snapshot);
  return { action: "terminal_failure_wait", jobId, deadline: String(job.deliveryDeadline), reason };
}

function assertPreparedArtifact(prepared) {
  try {
    if (!prepared || typeof prepared.cid !== "string" || !/^[A-Za-z0-9]+$/.test(prepared.cid)) throw new Error();
    const delivery = new URL(prepared.deliveryUri);
    const result = new URL(prepared.resultUri);
    if (delivery.protocol !== "https:" || delivery.username || delivery.password || delivery.search || delivery.hash) throw new Error();
    if (result.protocol !== "https:" || result.username || result.password || result.search || result.hash) throw new Error();
    const suffix = `/ipfs/${prepared.cid}/index.html`;
    if (!delivery.pathname.endsWith(suffix)) throw new Error();
    if (result.origin !== delivery.origin || result.pathname !== `${delivery.pathname.slice(0, -"index.html".length)}result.json`) throw new Error();
  } catch {
    const error = new Error("invalid_prepared_artifact");
    error.code = "invalid_prepared_artifact";
    error.permanent = true;
    throw error;
  }
}

function normalizeState(value) {
  if (!value || value.version !== STATE_VERSION) return { version: STATE_VERSION, wasRegistered: false, halted: false, jobs: {} };
  return { version: STATE_VERSION, wasRegistered: Boolean(value.wasRegistered), halted: Boolean(value.halted), haltReason: value.haltReason || "", jobs: value.jobs || {} };
}

function sameAddress(left, right) {
  return String(left || "").toLowerCase() === String(right || "").toLowerCase();
}

function byId(left, right) {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function safeReason(error) {
  return String(error?.code || error?.message || "unknown_failure").replace(/https?:\/\/\S+/g, "[URL_REDACTED]").slice(0, 200);
}
