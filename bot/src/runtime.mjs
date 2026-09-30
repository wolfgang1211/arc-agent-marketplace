import { hasGasReserve, parseEligibleJob } from "./eligibility.mjs";

const STATE_VERSION = 1;
// Reserve five minutes for bounded RPC retries and receipt confirmation; do not start a new submit inside this window.
export const MIN_SUBMIT_ATTEMPT_WINDOW_SECONDS = 300n;
export const PAYOUT_BASE_COOLDOWN_SECONDS = 60n;
export const PAYOUT_MAX_COOLDOWN_SECONDS = 3_600n;
export const MAX_PAYOUT_ATTEMPTS = 5;
export const PAYOUT_PENDING_ATTENTION_SECONDS = 1_800n;
export const PAYOUT_SIMULATION_ALERT_THRESHOLD = 10;
export const PREPARE_BASE_COOLDOWN_SECONDS = 300n;
export const PREPARE_MAX_COOLDOWN_SECONDS = 21_600n;
export const MAX_PREPARE_ATTEMPTS = 5;

export async function runCycle({ chain, state, prepareJob }) {
  await chain.assertChain();
  if (chain.writeEnabled === false) return runReadOnlyCycle(chain);
  if (chain.pilotScopeValid !== true || chain.pilotJobId == null) {
    return { action: "pilot_scope_invalid", reason: chain.pilotScopeReason || "pilot_job_id_invalid", alert: true };
  }
  const pilotScope = createPilotScopedChain(chain);
  const result = await runWriteCycle({ chain: pilotScope.chain, state, prepareJob, pilotScope });
  const pilotScopeSkips = pilotScope.skips();
  return {
    ...result,
    ...(pilotScopeSkips.length > 0 ? { pilotScopeSkips } : {}),
  };
}

async function runWriteCycle({ chain, state, prepareJob, pilotScope }) {
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
    .filter(([, record]) => ["prepared", "prepare_retry", "accepting", "accepted", "submitting", "submitted", "terminal_failure", "timing_out", "claiming_payout", "payout_needs_attention"].includes(record?.phase))
    .map(([jobId]) => jobId);
  if (knownIds.length > 0) {
    const recovered = await Promise.all(knownIds.map((jobId) => chain.getJob(jobId)));
    const byJobId = new Map(jobs.map((job) => [String(job.id), job]));
    for (const job of recovered) if (job) byJobId.set(String(job.id), job);
    jobs = [...byJobId.values()];
  }
  const scopedJobs = pilotScope.scopeJobs(jobs, chain.address);
  if (scopedJobs.nonPilotOwned) {
    return {
      action: "pilot_scope_owned_job_wait",
      jobId: String(scopedJobs.nonPilotOwned.id),
      status: Number(scopedJobs.nonPilotOwned.status),
      reason: "pilot_scope_skip",
      alert: true,
    };
  }
  jobs = scopedJobs.jobs;
  const pilotOwnsActiveJob = jobs.some((job) => [1, 2, 3].includes(Number(job.status)) && sameAddress(job.agent, chain.address));
  if (BigInt(agent.activeJobs || 0) > 0n && !pilotOwnsActiveJob) {
    return { action: "pilot_scope_owned_job_unresolved", reason: "active_job_outside_pilot_scope", alert: true };
  }
  const completed = jobs.find((job) => Number(job.status) === 4 && sameAddress(job.agent, chain.address) && snapshot.jobs[String(job.id)] && snapshot.jobs[String(job.id)].phase !== "completed");
  if (completed) {
    return observeSettlement({ chain, state, snapshot, job: completed });
  }

  const ambiguousPayout = jobs.find((job) => snapshot.jobs[String(job.id)]?.phase === "claiming_payout");
  if (ambiguousPayout) {
    return reconcileAmbiguousPayout({ chain, state, snapshot, job: ambiguousPayout, record: snapshot.jobs[String(ambiguousPayout.id)] });
  }

  const attentionPayout = jobs.find((job) => snapshot.jobs[String(job.id)]?.phase === "payout_needs_attention" && Number(job.status) === 2 && sameAddress(job.agent, chain.address));
  if (attentionPayout) {
    return { action: "payout_needs_attention_wait", jobId: String(attentionPayout.id), attempts: Number(snapshot.jobs[String(attentionPayout.id)].payoutAttempts || 0) };
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

  const ownedSubmitted = jobs
    .filter((job) => Number(job.status) === 2 && sameAddress(job.agent, chain.address))
    .sort(byId)[0];
  if (ownedSubmitted) return handleOwnedSubmitted({ chain, state, snapshot, job: ownedSubmitted });

  const ownedDisputed = jobs
    .filter((job) => Number(job.status) === 3 && sameAddress(job.agent, chain.address))
    .sort(byId)[0];
  if (ownedDisputed) return markDisputedWait({ state, snapshot, job: ownedDisputed });

  const balance = await chain.getNativeBalance();
  if (!hasGasReserve(balance)) return { action: "gas_guard", balance: String(balance) };

  const openJobs = jobs.filter((job) => Number(job.status) === 0).sort(byId);
  const houseDelaySkips = [];
  const prepareSkips = [];
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

    let opening;
    try {
      opening = await chain.getJobOpeningTime(job);
    } catch {
      houseDelaySkips.push({ jobId, reason: "job_open_time_unavailable" });
      continue;
    }
    const chainTimestamp = await chain.getChainTimestamp();
    const prepareRecord = snapshot.jobs[jobId];
    if (isPrepareCoolingDown(prepareRecord, chainTimestamp)) {
      prepareSkips.push({
        jobId,
        reason: "prepare_cooldown",
        attempts: Number(prepareRecord.attempts || 0),
        nextPrepareAttemptAt: String(prepareRecord.nextPrepareAttemptAt),
      });
      continue;
    }
    const eligibleAt = BigInt(opening.timestamp) + BigInt(chain.houseDelaySeconds);
    if (chainTimestamp < eligibleAt) {
      houseDelaySkips.push({
        jobId,
        reason: "house_delay_wait",
        openedAt: String(opening.timestamp),
        openingTimeSource: opening.source,
        eligibleAt: String(eligibleAt),
      });
      continue;
    }

    let prepared;
    try {
      prepared = await prepareJob(job, eligibility.request);
      assertPreparedArtifact(prepared);
    } catch (error) {
      const permanent = error?.permanent === true;
      const attempts = Number(snapshot.jobs[jobId]?.attempts || 0) + 1;
      const reason = safeReason(error);
      if (!permanent && attempts >= MAX_PREPARE_ATTEMPTS) {
        snapshot.jobs[jobId] = {
          phase: "rejected",
          reason: "source_unavailable",
          lastPrepareError: reason,
          permanent: true,
          attempts,
        };
        await state.save(snapshot);
        prepareSkips.push({ jobId, reason: "source_unavailable", attempts, alert: true });
        continue;
      }
      snapshot.jobs[jobId] = {
        phase: permanent ? "rejected" : "prepare_retry",
        reason,
        permanent,
        attempts,
        ...(!permanent ? { nextPrepareAttemptAt: String(chainTimestamp + prepareCooldownSeconds(attempts)) } : {}),
      };
      await state.save(snapshot);
      if (!permanent) {
        prepareSkips.push({
          jobId,
          reason,
          attempts,
          nextPrepareAttemptAt: snapshot.jobs[jobId].nextPrepareAttemptAt,
        });
      }
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
      jobOpenedAt: String(opening.timestamp),
      jobOpeningTimeSource: opening.source,
    };
    await state.save(snapshot);

    const freshJob = await chain.getJob(job.id);
    if (!freshJob || Number(freshJob.status) !== 0) {
      snapshot.jobs[jobId].phase = "accept_race_lost";
      await state.save(snapshot);
      return withHouseDiagnostics({ action: "accept_race_lost", jobId }, houseDelaySkips, opening, prepareSkips);
    }
    const freshBalance = await chain.getNativeBalance();
    if (!hasGasReserve(freshBalance)) return withHouseDiagnostics({ action: "gas_guard", balance: String(freshBalance), preparedJobId: jobId }, houseDelaySkips, opening, prepareSkips);
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
    const result = await submitPrepared({ chain, state, snapshot, job: acceptedJob });
    return withHouseDiagnostics(result, houseDelaySkips, opening, prepareSkips);
  }

  return withHouseDiagnostics({ action: "no_eligible_jobs" }, houseDelaySkips, undefined, prepareSkips);
}

function withHouseDiagnostics(result, houseDelaySkips, opening, prepareSkips = []) {
  return {
    ...result,
    ...(opening ? { jobOpenedAt: String(opening.timestamp), jobOpeningTimeSource: opening.source } : {}),
    ...(houseDelaySkips.length > 0 ? { houseDelaySkips } : {}),
    ...(prepareSkips.length > 0 ? { prepareSkips } : {}),
    ...(prepareSkips.some((skip) => skip.alert === true) ? { alert: true } : {}),
  };
}

function createPilotScopedChain(chain) {
  const pilotJobId = BigInt(chain.pilotJobId);
  const skipped = new Map();
  const rememberSkip = (job) => {
    const jobId = String(job?.id ?? "");
    if (!/^\d+$/.test(jobId) || BigInt(jobId) === pilotJobId) return;
    skipped.set(jobId, { jobId, status: Number(job?.status), reason: "pilot_scope_skip" });
  };
  const assertPilotId = (jobId) => {
    if (BigInt(jobId) !== pilotJobId) throw new Error("pilot_scope_violation");
  };
  const scopeWrite = (write) => async (jobId, ...args) => {
    assertPilotId(jobId);
    return write(jobId, ...args);
  };
  return {
    chain: {
      ...chain,
      acceptJob: scopeWrite(chain.acceptJob),
      submitDeliverable: scopeWrite(chain.submitDeliverable),
      claimTimeout: scopeWrite(chain.claimTimeout),
      claimApprovalTimeout: scopeWrite(chain.claimApprovalTimeout),
    },
    scopeJobs(jobs, address) {
      for (const job of jobs) rememberSkip(job);
      const nonPilotOwned = jobs
        .filter((job) => BigInt(job.id) !== pilotJobId && [1, 2, 3].includes(Number(job.status)) && sameAddress(job.agent, address))
        .sort(byId)[0];
      return {
        jobs: jobs.filter((job) => BigInt(job.id) === pilotJobId),
        nonPilotOwned,
      };
    },
    skips: () => [...skipped.values()].sort((left, right) => BigInt(left.jobId) < BigInt(right.jobId) ? -1 : 1),
  };
}

async function runReadOnlyCycle(chain) {
  const [agent, nativeBalance, jobs, chainTimestamp] = await Promise.all([
    chain.getAgent(), chain.getNativeBalance(), chain.listJobs(), chain.getChainTimestamp(),
  ]);
  const awaitingPayout = jobs
    .filter((job) => Number(job.status) === 2 && sameAddress(job.agent, chain.address) && chainTimestamp >= BigInt(job.approvalDeadline))
    .sort(byId)[0];
  if (awaitingPayout) {
    return { action: "awaiting_payout_claim_readonly", jobId: String(awaitingPayout.id), approvalDeadline: String(awaitingPayout.approvalDeadline) };
  }
  return { action: "read_only", registered: agent.registered, nativeBalance: String(nativeBalance), visibleJobs: jobs.length };
}

async function observeSettlement({ chain, state, snapshot, job }) {
  const jobId = String(job.id);
  const record = snapshot.jobs[jobId] || {};
  const [native, usdc] = await Promise.all([chain.getNativeBalance(), chain.getUsdcBalance()]);
  record.phase = "completed";
  record.deliveryUri ||= job.deliverableURI;
  record.balanceAfterSettlement = { native: String(native), usdc: String(usdc) };
  record.completedAt = new Date().toISOString();
  snapshot.jobs[jobId] = record;
  await state.save(snapshot);
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

async function handleOwnedSubmitted({ chain, state, snapshot, job }) {
  const jobId = String(job.id);
  const chainTimestamp = await chain.getChainTimestamp();
  if (chainTimestamp < BigInt(job.approvalDeadline)) {
    return { action: "awaiting_customer_approval", jobId, deliveryUri: job.deliverableURI, approvalDeadline: String(job.approvalDeadline) };
  }
  if (chain.writeEnabled === false) {
    return { action: "awaiting_payout_claim_readonly", jobId, deliveryUri: job.deliverableURI, approvalDeadline: String(job.approvalDeadline) };
  }

  const record = snapshot.jobs[jobId] || { phase: "submitted", deliveryUri: job.deliverableURI, payoutAttempts: 0 };
  snapshot.jobs[jobId] = record;
  if (record.phase === "payout_needs_attention") {
    return { action: "payout_needs_attention_wait", jobId, attempts: Number(record.payoutAttempts || 0) };
  }
  if (isPayoutCoolingDown(record, chainTimestamp)) {
    return payoutCooldownResult(jobId, record);
  }

  record.phase = "claiming_payout";
  record.payoutClaimIntentAt = new Date().toISOString();
  await state.save(snapshot);
  try {
    const claimed = await chain.claimApprovalTimeout(job.id, {
      onBroadcast: async (hash) => {
        record.payoutTxHash = hash;
        record.payoutBroadcastAt = new Date().toISOString();
        record.payoutBroadcastAtChainTimestamp = String(chainTimestamp);
        record.payoutSimulationFailures = 0;
        delete record.payoutSimulationAlerted;
        await state.save(snapshot);
      },
    });
    const fresh = await chain.getJob(job.id);
    return classifyPayoutJob({ chain, state, snapshot, job: fresh || job, record, payoutTxHash: claimed.hash });
  } catch (error) {
    record.reason = safeReason(error);
    const fresh = await chain.getJob(job.id);
    if (Number(fresh?.status) !== 2) {
      return classifyPayoutJob({ chain, state, snapshot, job: fresh || job, record });
    }
    if (record.payoutTxHash) {
      scheduleFailedPayoutAttempt(record, chainTimestamp, record.payoutTxHash);
      await state.save(snapshot);
      return payoutCooldownResult(jobId, record);
    }
    if (error?.transactionStage === "simulation") {
      record.phase = "submitted";
      record.payoutSimulationFailures = Number(record.payoutSimulationFailures || 0) + 1;
      record.nextPayoutAttemptAt = String(chainTimestamp + PAYOUT_BASE_COOLDOWN_SECONDS);
      const shouldAlert = record.payoutSimulationFailures === PAYOUT_SIMULATION_ALERT_THRESHOLD && record.payoutSimulationAlerted !== true;
      if (shouldAlert) record.payoutSimulationAlerted = true;
      await state.save(snapshot);
      return {
        action: "payout_simulation_cooldown",
        jobId,
        nextPayoutAttemptAt: record.nextPayoutAttemptAt,
        simulationFailures: record.payoutSimulationFailures,
        reason: shouldAlert ? "payout_simulation_failures_threshold" : record.reason,
        ...(shouldAlert ? { alert: true } : {}),
      };
    }
    return markPayoutNeedsAttention({ state, snapshot, job, record, reason: "payout_broadcast_state_unknown" });
  }
}

async function reconcileAmbiguousPayout({ chain, state, snapshot, job, record }) {
  const jobId = String(job.id);
  if (Number(job.status) !== 2) return classifyPayoutJob({ chain, state, snapshot, job, record, payoutTxHash: record.payoutTxHash });
  const chainTimestamp = await chain.getChainTimestamp();

  const txHash = record.payoutTxHash;
  if (!txHash) return markPayoutNeedsAttention({ state, snapshot, job, record, reason: "payout_broadcast_state_unknown" });
  if (record.payoutBroadcastAtChainTimestamp == null || record.payoutBroadcastAtChainTimestamp === "") {
    record.payoutBroadcastAtChainTimestamp = String(chainTimestamp);
    await state.save(snapshot);
  }
  const pendingTooLong = chainTimestamp > BigInt(record.payoutBroadcastAtChainTimestamp) + PAYOUT_PENDING_ATTENTION_SECONDS;
  if (isPayoutCoolingDown(record, chainTimestamp) && !pendingTooLong) return payoutCooldownResult(jobId, record);

  let transactionStatus;
  try {
    transactionStatus = await chain.getTransactionStatus(txHash);
  } catch (error) {
    record.reason = safeReason(error);
    scheduleFailedPayoutAttempt(record, chainTimestamp, txHash, { refreshCooldown: true });
    await state.save(snapshot);
    return payoutCooldownResult(jobId, record);
  }
  if (transactionStatus === "pending") {
    if (pendingTooLong) {
      return markPayoutNeedsAttention({ state, snapshot, job, record, reason: "payout_transaction_pending_too_long" });
    }
    record.nextPayoutAttemptAt = String(chainTimestamp + payoutCooldownSeconds(Math.max(1, Number(record.payoutAttempts || 0))));
    await state.save(snapshot);
    return { action: "payout_broadcast_reconciliation_wait", jobId, txHash, nextPayoutAttemptAt: record.nextPayoutAttemptAt };
  }
  const fresh = await chain.getJob(job.id);
  if (transactionStatus === "success" && Number(fresh?.status) === 2) {
    record.nextPayoutAttemptAt = String(chainTimestamp + PAYOUT_BASE_COOLDOWN_SECONDS);
    await state.save(snapshot);
    return { action: "payout_state_reconciliation_wait", jobId, txHash, nextPayoutAttemptAt: record.nextPayoutAttemptAt };
  }
  if (transactionStatus === "success" || Number(fresh?.status) !== 2) {
    return classifyPayoutJob({ chain, state, snapshot, job: fresh || job, record, payoutTxHash: txHash });
  }

  scheduleFailedPayoutAttempt(record, chainTimestamp, txHash);
  record.lastPayoutTxHash = txHash;
  delete record.payoutTxHash;
  delete record.payoutAttemptCountedHash;
  record.reason = "payout_transaction_reverted";
  if (Number(record.payoutAttempts || 0) >= MAX_PAYOUT_ATTEMPTS) {
    return markPayoutNeedsAttention({ state, snapshot, job, record, reason: record.reason });
  }
  record.phase = "submitted";
  await state.save(snapshot);
  return { action: "payout_reverted_retry_later", jobId, txHash, attempts: record.payoutAttempts, nextPayoutAttemptAt: record.nextPayoutAttemptAt };
}

function isPayoutCoolingDown(record, chainTimestamp) {
  if (record.nextPayoutAttemptAt == null || record.nextPayoutAttemptAt === "") return false;
  return chainTimestamp < BigInt(record.nextPayoutAttemptAt);
}

function payoutCooldownSeconds(attempts) {
  const exponent = Math.max(0, Number(attempts || 1) - 1);
  const delay = PAYOUT_BASE_COOLDOWN_SECONDS * (2n ** BigInt(exponent));
  return delay > PAYOUT_MAX_COOLDOWN_SECONDS ? PAYOUT_MAX_COOLDOWN_SECONDS : delay;
}

function scheduleFailedPayoutAttempt(record, chainTimestamp, txHash, { refreshCooldown = false } = {}) {
  const isNewFailure = record.payoutAttemptCountedHash !== txHash;
  if (isNewFailure) {
    record.payoutAttempts = Number(record.payoutAttempts || 0) + 1;
    record.payoutAttemptCountedHash = txHash;
  }
  if (isNewFailure || refreshCooldown) {
    record.nextPayoutAttemptAt = String(chainTimestamp + payoutCooldownSeconds(record.payoutAttempts));
  }
}

function payoutCooldownResult(jobId, record) {
  return {
    action: "payout_cooldown_wait",
    jobId,
    attempts: Number(record.payoutAttempts || 0),
    nextPayoutAttemptAt: record.nextPayoutAttemptAt,
    txHash: record.payoutTxHash,
  };
}

async function markPayoutNeedsAttention({ state, snapshot, job, record, reason }) {
  const jobId = String(job.id);
  record.phase = "payout_needs_attention";
  record.reason = reason;
  record.payoutNeedsAttentionAt = new Date().toISOString();
  snapshot.jobs[jobId] = record;
  await state.save(snapshot);
  return { action: "payout_needs_attention", alert: true, jobId, attempts: Number(record.payoutAttempts || 0), reason };
}

async function classifyPayoutJob({ chain, state, snapshot, job, record, payoutTxHash }) {
  const status = Number(job?.status);
  if (status === 7) return markPayoutClaimed({ state, snapshot, job, record, payoutTxHash });
  if (status === 4) return observeSettlement({ chain, state, snapshot, job });
  if (status === 3) return markDisputedWait({ state, snapshot, job });
  throw new Error("approval_timeout_state_mismatch");
}

async function markPayoutClaimed({ state, snapshot, job, record, payoutTxHash }) {
  const jobId = String(job.id);
  record.phase = "payout_claimed";
  record.payoutTxHash = payoutTxHash || record.payoutTxHash;
  record.payoutClaimedAt = new Date().toISOString();
  await state.save(snapshot);
  return { action: "approval_timeout_claimed", jobId, payoutTxHash: record.payoutTxHash };
}

async function markDisputedWait({ state, snapshot, job }) {
  const jobId = String(job.id);
  const record = snapshot.jobs[jobId] || {};
  if (record.phase !== "disputed") {
    record.phase = "disputed";
    record.disputedAt = new Date().toISOString();
    snapshot.jobs[jobId] = record;
    await state.save(snapshot);
  }
  return { action: "awaiting_dispute_resolution", jobId };
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

function isPrepareCoolingDown(record, chainTimestamp) {
  if (record?.phase !== "prepare_retry" || !/^\d+$/.test(String(record.nextPrepareAttemptAt || ""))) return false;
  return chainTimestamp < BigInt(record.nextPrepareAttemptAt);
}

function prepareCooldownSeconds(attempts) {
  const exponent = BigInt(Math.max(0, Math.min(Number(attempts) - 1, 63)));
  const cooldown = PREPARE_BASE_COOLDOWN_SECONDS * (2n ** exponent);
  return cooldown < PREPARE_MAX_COOLDOWN_SECONDS ? cooldown : PREPARE_MAX_COOLDOWN_SECONDS;
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
