const ACTIVE_DEADLINES = {
  1: "deliveryDeadline",
  2: "approvalDeadline",
  3: "disputeDeadline",
};

const USDC_SCALE = 1_000000n;
const DISPUTE_BPS_SCALE = 10_000n;
const AGENT_STAKE = 100_000000n;

export const JOB_STATUS_BUCKETS = Object.freeze([
  "open",
  "active",
  "active",
  "active",
  "settled",
  "settled",
  "settled",
  "settled",
  "settled",
]);

export function getJobStatusCounts(jobs) {
  const counts = { open: 0, active: 0, settled: 0, total: 0 };
  for (const job of jobs) {
    const status = Number(job.status);
    const bucket = JOB_STATUS_BUCKETS[status];
    if (!bucket) throw new Error(`Unclassified JobStatus: ${status}`);
    counts[bucket] += 1;
    counts.total += 1;
  }
  if (counts.open + counts.active + counts.settled !== counts.total) {
    throw new Error("Job status bucket total mismatch");
  }
  return counts;
}

export function formatUsdcAmount(value) {
  const amount = BigInt(value ?? 0);
  const sign = amount < 0n ? "-" : "";
  const absolute = amount < 0n ? -amount : amount;
  return `${sign}${absolute / USDC_SCALE}.${(absolute % USDC_SCALE).toString().padStart(6, "0")}`;
}

export function splitDisputedReward(reward, clientShareOnDispute) {
  const total = BigInt(reward);
  const clientAmount = (total * BigInt(clientShareOnDispute)) / DISPUTE_BPS_SCALE;
  return { clientAmount, agentAmount: total - clientAmount };
}

export function getTimeoutState(job, chainTimestamp) {
  const status = Number(job.status);
  const deadlineField = ACTIVE_DEADLINES[status];
  if (!deadlineField) return { active: false, claimable: false };

  if (chainTimestamp == null) {
    return { active: true, claimable: false, deadline: BigInt(job[deadlineField]), chainTimePending: true };
  }

  const deadline = BigInt(job[deadlineField]);
  const observedChainTime = BigInt(chainTimestamp);
  const claimable = observedChainTime >= deadline;
  return {
    active: true,
    claimable,
    deadline,
    remainingSeconds: claimable ? 0n : deadline - observedChainTime,
  };
}

export function formatDuration(seconds) {
  const total = BigInt(seconds);
  if (total <= 0n) return "0s";
  const days = total / 86_400n;
  if (days > 0n) return `${days}d`;
  const hours = total / 3_600n;
  const minutes = (total % 3_600n) / 60n;
  if (hours > 0n) return `${hours}h${minutes > 0n ? ` ${minutes}m` : ""}`;
  const secondsPart = total % 60n;
  if (minutes > 0n) return `${minutes}m${secondsPart > 0n ? ` ${secondsPart}s` : ""}`;
  return `${secondsPart}s`;
}

export function timeoutOutcomeCopy(job, role, remainingSeconds, claimable) {
  const status = Number(job.status);
  const reward = formatUsdcAmount(job.reward);
  const stake = formatUsdcAmount(AGENT_STAKE);
  const t = formatDuration(remainingSeconds ?? 0n);

  if (!claimable) {
    if (status === 1 && role === "client") {
      return `Delivery due in ${t}. If the agent misses it, anyone can settle the job: you get your ${reward} USDC back and the agent's stake is burned.`;
    }
    if (status === 1 && role === "agent") {
      return `You have ${t} left to deliver. Miss this deadline and your ${stake} USDC stake is burned and the client is refunded. The stake is not recoverable.`;
    }
    if (status === 1) {
      return `Delivery due in ${t}. If the agent misses it, the client is refunded ${reward} USDC and the agent's stake is burned.`;
    }
    if (status === 2 && role === "client") {
      return `You have ${t} to approve or dispute. If you do nothing, anyone can settle the job and the agent is paid ${reward} USDC.`;
    }
    if (status === 2 && role === "agent") {
      return `The client has ${t} to approve or dispute. If they do nothing, you can settle the job yourself and collect ${reward} USDC.`;
    }
    if (status === 2) {
      return `Awaiting client approval for ${t}. If the window closes, the agent is paid ${reward} USDC.`;
    }
    if (status === 3) {
      const { clientAmount, agentAmount } = splitDisputedReward(job.reward, job.clientShareOnDispute);
      return `Dispute window closes in ${t}. No one reviews this. When it closes, the escrow is split at the fixed rate set when the job was posted: ${formatUsdcAmount(clientAmount)} USDC to the client, ${formatUsdcAmount(agentAmount)} USDC to the agent.`;
    }
    return "";
  }

  if (status === 1) {
    return `Delivery deadline passed. Settling refunds ${reward} USDC to the client and burns the agent's ${stake} USDC stake. The stake is not paid to anyone — it stays in the contract permanently.`;
  }
  if (status === 2) {
    return `Approval deadline passed. Settling pays ${reward} USDC to the agent. The client's window to dispute has closed.`;
  }
  if (status === 3) {
    const { clientAmount, agentAmount } = splitDisputedReward(job.reward, job.clientShareOnDispute);
    return `Dispute window closed. Settling splits the escrow at the rate fixed when the job was posted: ${formatUsdcAmount(clientAmount)} USDC to the client, ${formatUsdcAmount(agentAmount)} USDC to the agent.`;
  }
  return "";
}

export const PERMISSIONLESS_SETTLEMENT_COPY = "Anyone can settle an expired job. You pay only the network fee.";

export function terminalOutcomeCopy(job) {
  const status = Number(job.status);
  const reward = formatUsdcAmount(job.reward);
  if (status === 6) {
    return `Settled — agent missed the delivery deadline. ${reward} USDC refunded to the client. Agent's ${formatUsdcAmount(AGENT_STAKE)} USDC stake was burned.`;
  }
  if (status === 7) {
    return `Settled — client did not approve in time. ${reward} USDC paid to the agent.`;
  }
  if (status === 8) {
    const { clientAmount, agentAmount } = splitDisputedReward(job.reward, job.clientShareOnDispute);
    return `Settled — dispute window closed with no resolution. ${formatUsdcAmount(clientAmount)} USDC to the client, ${formatUsdcAmount(agentAmount)} USDC to the agent.`;
  }
  return "";
}

export function getPaginationState(offset, pageSize, total) {
  const currentOffset = BigInt(offset);
  const size = BigInt(pageSize);
  const count = BigInt(total);
  const hasPrevious = currentOffset > 0n;
  const hasNext = currentOffset + size < count;
  const previousOffset = hasPrevious ? (currentOffset > size ? currentOffset - size : 0n) : 0n;
  const nextOffset = hasNext ? currentOffset + size : currentOffset;
  return {
    hasPrevious,
    hasNext,
    previousOffset,
    nextOffset,
    start: count === 0n ? 0n : currentOffset + 1n,
    end: count === 0n ? 0n : (currentOffset + size < count ? currentOffset + size : count),
  };
}

export async function revalidateTimeoutClaim(jobId, readChainSnapshot) {
  const snapshot = await readChainSnapshot();
  if (!snapshot?.job || BigInt(snapshot.job.id) !== BigInt(jobId)) {
    throw new Error("Job changed while timeout eligibility was being checked. Refresh and try again.");
  }
  const state = getTimeoutState(snapshot.job, snapshot.chainTimestamp);
  if (!state.active) {
    throw new Error("This job was already settled. Refreshing.");
  }
  if (!state.claimable) {
    throw new Error("The deadline had not passed on-chain yet. Chain time can run a few seconds behind. Try again shortly.");
  }
  return { ...snapshot, state };
}

export function assertSuccessfulReceipt(receipt) {
  if (!receipt || receipt.status == null) {
    throw new Error("Transaction confirmation is missing receipt status.");
  }
  if (receipt.status !== "success") {
    throw new Error(`Transaction failed with receipt status: ${receipt.status}.`);
  }
  return receipt;
}
