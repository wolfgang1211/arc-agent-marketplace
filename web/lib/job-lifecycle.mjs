import { formatUsdcAmount, getTimeoutState, splitDisputedReward, terminalOutcomeCopy } from "./timeout-recovery.mjs";

// Preserve the legacy timeout-copy API while the lifecycle UI qualifies approval fees.
export function settlementOutcomeCopy(job, agentStake) {
  if (Number(job.status) === 4) {
    return `Completed — client approved the delivery. Gross reward: ${formatUsdcAmount(job.reward)} USDC. Agent paid after any reputation fee; the JobApproved event records the exact net payment.`;
  }
  return terminalOutcomeCopy(job, agentStake);
}

export const ACTIVITY_LIMIT = 6n;
const ACCEPTED = new Set([1, 2, 3, 4, 6, 7, 8]);
const SUBMITTED = new Set([2, 3, 4, 7, 8]);
const STATUS_LABELS = ["Open / funded", "Accepted", "Submitted", "Disputed", "Approved / settled", "Canceled / refunded", "Delivery timeout / refunded", "Approval timeout / paid", "Dispute timeout / split"];

export function chainDate(value) {
  try {
    const date = new Date(Number(BigInt(value) * 1000n));
    return date.toISOString().replace("T", " ").replace(".000Z", " UTC");
  } catch {
    return "Timestamp unavailable";
  }
}

// Only pass jobs returned by getJobsPaged on the configured chain, never indexer/backend projections.
// Terminal enum values prove successful atomic settlement, not its timestamp or transaction hash.
export function jobLifecycle(job, chainTimestamp) {
  const status = Number(job.status);
  if (BigInt(job.id) <= 0n || !Number.isInteger(status) || !STATUS_LABELS[status]) return null;
  const settled = status >= 4;
  const reward = `${formatUsdcAmount(job.reward)} USDC`;
  const steps = [
    { key: "posted", label: "Posted", state: "confirmed", detail: chainDate(job.createdAt) },
    { key: "funded", label: "Funded", state: "confirmed", detail: `${reward} escrowed atomically when posted.` },
    { key: "accepted", label: "Accepted", state: ACCEPTED.has(status) ? "confirmed" : settled ? "not-applicable" : "pending" },
    { key: "submitted", label: "Submitted", state: SUBMITTED.has(status) ? "confirmed" : settled ? "not-applicable" : "pending" },
    { key: "review", label: status === 3 || status === 8 ? "Disputed" : "Client approval", state: status === 3 || status === 4 || status === 8 ? "confirmed" : settled ? "not-applicable" : "pending" },
  ];
  let payment = "Escrow has not been settled.";
  let outcome = "No timeout settlement recorded.";
  if (status === 4) payment = "Client approved; agent paid after any reputation fee. Exact net amount requires the JobApproved event; gross reward is not net payment.";
  if (status === 5) payment = `${reward} refunded to the client after cancellation before acceptance.`;
  if (status === 6) {
    outcome = "Delivery timeout settled; registration stake slashed.";
    payment = `${reward} refunded to the client.`;
  }
  if (status === 7) {
    outcome = "Approval timeout settled, without client approval.";
    payment = `${reward} paid to the agent.`;
  }
  if (status === 8) {
    outcome = "Dispute timeout settled at the fixed split; no arbitration verdict.";
    const split = splitDisputedReward(job.reward, job.clientShareOnDispute);
    payment = `${formatUsdcAmount(split.clientAmount)} USDC to the client; ${formatUsdcAmount(split.agentAmount)} USDC to the agent.`;
  }
  steps.push({ key: "timeout", label: status === 5 ? "Canceled" : "Timeout outcome", state: status >= 5 ? "confirmed" : settled ? "not-applicable" : "pending", detail: status === 5 ? "Client canceled before assignment." : outcome });
  steps.push({ key: "payment", label: "Payment / refund", state: settled ? "confirmed" : "pending", detail: payment });
  const timeout = getTimeoutState(job, chainTimestamp);
  const deadlineLabel = { 1: "Delivery", 2: "Approval", 3: "Dispute" }[status];
  return {
    steps,
    statusLabel: STATUS_LABELS[status],
    deadline: timeout.active ? `${deadlineLabel} deadline: ${chainDate(timeout.deadline)}. ${timeout.chainTimePending ? "Chain time unavailable." : timeout.claimable ? "Reached on-chain; settlement still pending." : "Not reached at the observed chain time."}` : null,
  };
}

// Two bounded contract reads pinned to one chain block, regardless of marketplace size.
export async function loadRecentActivity({ getBlock, readContract }) {
  const block = await getBlock();
  if (block.number == null) throw new Error("Latest block number unavailable");
  const count = BigInt(await readContract("jobCount", [], block.number));
  const offset = count > ACTIVITY_LIMIT ? count - ACTIVITY_LIMIT : 0n;
  const [jobs, total] = await readContract("getJobsPaged", [offset, ACTIVITY_LIMIT], block.number);
  if (BigInt(total) !== count || BigInt(jobs.length) !== count - offset) throw new Error("Inconsistent on-chain activity snapshot");
  for (const [index, job] of jobs.entries()) {
    if (BigInt(job.id) !== offset + BigInt(index) + 1n || !jobLifecycle(job, block.timestamp)) throw new Error("Invalid on-chain activity record");
  }
  return { jobs: [...jobs].reverse(), blockNumber: block.number, timestamp: block.timestamp };
}
