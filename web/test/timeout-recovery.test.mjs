import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSuccessfulReceipt,
  formatDuration,
  formatUsdcAmount,
  getPaginationState,
  getTimeoutState,
  PERMISSIONLESS_SETTLEMENT_COPY,
  revalidateTimeoutClaim,
  splitDisputedReward,
  terminalOutcomeCopy,
  timeoutOutcomeCopy,
} from "../lib/timeout-recovery.mjs";

const baseJob = {
  id: 7n,
  reward: 12_345678n,
  deliveryDeadline: 1_000n,
  approvalDeadline: 2_000n,
  disputeDeadline: 3_000n,
  clientShareOnDispute: 3333n,
};

for (const row of [
  { status: 1, deadline: 1_000n, name: "InProgress" },
  { status: 2, deadline: 2_000n, name: "Submitted" },
  { status: 3, deadline: 3_000n, name: "Disputed" },
]) {
  test(`${row.name} is not claimable before its own deadline`, () => {
    const state = getTimeoutState({ ...baseJob, status: row.status }, row.deadline - 1n);
    assert.equal(state.deadline, row.deadline);
    assert.equal(state.claimable, false);
    assert.equal(state.remainingSeconds, 1n);
  });

  test(`${row.name} is claimable exactly at its own deadline`, () => {
    const state = getTimeoutState({ ...baseJob, status: row.status }, row.deadline);
    assert.equal(state.claimable, true);
    assert.equal(state.remainingSeconds, 0n);
  });

  test(`${row.name} remains claimable after its own deadline`, () => {
    assert.equal(getTimeoutState({ ...baseJob, status: row.status }, row.deadline + 1n).claimable, true);
  });
}

test("browser wall-clock skew cannot change chain-time eligibility", () => {
  const originalNow = Date.now;
  try {
    Date.now = () => 99_999_999_999_999;
    assert.equal(getTimeoutState({ ...baseJob, status: 1 }, 999n).claimable, false);
    Date.now = () => 0;
    assert.equal(getTimeoutState({ ...baseJob, status: 1 }, 1_000n).claimable, true);
  } finally {
    Date.now = originalNow;
  }
});

test("missing chain time never enables settlement", () => {
  assert.deepEqual(getTimeoutState({ ...baseJob, status: 1 }, null), {
    active: true,
    claimable: false,
    deadline: 1_000n,
    chainTimePending: true,
  });
});

test("inactive and terminal statuses never expose timeout eligibility", () => {
  for (const status of [0, 4, 5, 6, 7, 8]) {
    assert.deepEqual(getTimeoutState({ ...baseJob, status }, 99_999n), { active: false, claimable: false });
  }
});

test("remaining duration is human-readable for authoritative copy substitution", () => {
  assert.equal(formatDuration(0n), "0s");
  assert.equal(formatDuration(59n), "59s");
  assert.equal(formatDuration(61n), "1m 1s");
  assert.equal(formatDuration(3_661n), "1h 1m");
  assert.equal(formatDuration(172_800n), "2d");
});

test("USDC formatting and disputed split use integer six-decimal arithmetic without rounding up", () => {
  assert.equal(formatUsdcAmount(1n), "0.000001");
  assert.equal(formatUsdcAmount(1_234567n), "1.234567");
  assert.deepEqual(splitDisputedReward(10_000001n, 3333n), {
    clientAmount: 3_333000n,
    agentAmount: 6_667001n,
  });
});

test("countdown copy is exact and role-scoped", () => {
  const inProgress = { ...baseJob, status: 1 };
  assert.equal(
    timeoutOutcomeCopy(inProgress, "client", 61n, false),
    "Delivery due in 1m 1s. If the agent misses it, anyone can settle the job: you get your 12.345678 USDC back and the agent's stake is burned.",
  );
  assert.equal(
    timeoutOutcomeCopy(inProgress, "agent", 61n, false),
    "You have 1m 1s left to deliver. Miss this deadline and your 100.000000 USDC stake is burned and the client is refunded. The stake is not recoverable.",
  );
  assert.equal(
    timeoutOutcomeCopy(inProgress, "observer", 61n, false),
    "Delivery due in 1m 1s. If the agent misses it, the client is refunded 12.345678 USDC and the agent's stake is burned.",
  );

  const submitted = { ...baseJob, status: 2 };
  assert.equal(
    timeoutOutcomeCopy(submitted, "client", 61n, false),
    "You have 1m 1s to approve or dispute. If you do nothing, anyone can settle the job and the agent is paid 12.345678 USDC.",
  );
  assert.equal(
    timeoutOutcomeCopy(submitted, "agent", 61n, false),
    "The client has 1m 1s to approve or dispute. If they do nothing, you can settle the job yourself and collect 12.345678 USDC.",
  );
  assert.equal(
    timeoutOutcomeCopy(submitted, "observer", 61n, false),
    "Awaiting client approval for 1m 1s. If the window closes, the agent is paid 12.345678 USDC.",
  );

  assert.equal(
    timeoutOutcomeCopy({ ...baseJob, status: 3 }, "observer", 61n, false),
    "Dispute window closes in 1m 1s. No one reviews this. When it closes, the escrow is split at the fixed rate set when the job was posted: 4.114814 USDC to the client, 8.230864 USDC to the agent.",
  );
});

test("observer countdown variants contain no second-person wording", () => {
  for (const status of [1, 2, 3]) {
    const copy = timeoutOutcomeCopy({ ...baseJob, status }, "observer", 61n, false);
    assert.doesNotMatch(copy, /\byou(?:r|rs|self)?\b/i);
  }
});

test("each claimable branch uses the exact permissionless outcome copy", () => {
  assert.equal(
    timeoutOutcomeCopy({ ...baseJob, status: 1 }, "observer", 0n, true),
    "Delivery deadline passed. Settling refunds 12.345678 USDC to the client and burns the agent's 100.000000 USDC stake. The stake is not paid to anyone — it stays in the contract permanently.",
  );
  assert.equal(
    timeoutOutcomeCopy({ ...baseJob, status: 2 }, "observer", 0n, true),
    "Approval deadline passed. Settling pays 12.345678 USDC to the agent. The client's window to dispute has closed.",
  );
  assert.equal(
    timeoutOutcomeCopy({ ...baseJob, status: 3 }, "observer", 0n, true),
    "Dispute window closed. Settling splits the escrow at the rate fixed when the job was posted: 4.114814 USDC to the client, 8.230864 USDC to the agent.",
  );
  assert.equal(PERMISSIONLESS_SETTLEMENT_COPY, "Anyone can settle an expired job. You pay only the network fee.");
});

test("terminal timeout outcomes use the exact read-only copy", () => {
  assert.equal(
    terminalOutcomeCopy({ ...baseJob, status: 6 }),
    "Settled — agent missed the delivery deadline. 12.345678 USDC refunded to the client. Agent's 100.000000 USDC stake was burned.",
  );
  assert.equal(
    terminalOutcomeCopy({ ...baseJob, status: 7 }),
    "Settled — client did not approve in time. 12.345678 USDC paid to the agent.",
  );
  assert.equal(
    terminalOutcomeCopy({ ...baseJob, status: 8 }),
    "Settled — dispute window closed with no resolution. 4.114814 USDC to the client, 8.230864 USDC to the agent.",
  );
});

test("pagination clamps previous and next offsets at boundaries", () => {
  assert.deepEqual(getPaginationState(0n, 20n, 45n), {
    hasPrevious: false,
    hasNext: true,
    previousOffset: 0n,
    nextOffset: 20n,
    start: 1n,
    end: 20n,
  });
  assert.deepEqual(getPaginationState(20n, 20n, 45n), {
    hasPrevious: true,
    hasNext: true,
    previousOffset: 0n,
    nextOffset: 40n,
    start: 21n,
    end: 40n,
  });
  assert.deepEqual(getPaginationState(40n, 20n, 45n), {
    hasPrevious: true,
    hasNext: false,
    previousOffset: 20n,
    nextOffset: 40n,
    start: 41n,
    end: 45n,
  });
  assert.deepEqual(getPaginationState(0n, 20n, 0n), {
    hasPrevious: false,
    hasNext: false,
    previousOffset: 0n,
    nextOffset: 0n,
    start: 0n,
    end: 0n,
  });
});

test("claim click revalidates fresh chain status and timestamp", async () => {
  const fresh = await revalidateTimeoutClaim(7n, async () => ({
    job: { ...baseJob, status: 2 },
    chainTimestamp: 2_000n,
  }));
  assert.equal(fresh.state.claimable, true);
  assert.equal(fresh.job.status, 2);
});

test("claim click fails honestly when status or deadline became stale", async () => {
  await assert.rejects(
    revalidateTimeoutClaim(7n, async () => ({ job: { ...baseJob, status: 4 }, chainTimestamp: 2_000n })),
    { message: "This job was already settled. Refreshing." },
  );
  await assert.rejects(
    revalidateTimeoutClaim(7n, async () => ({ job: { ...baseJob, status: 2, approvalDeadline: 2_001n }, chainTimestamp: 2_000n })),
    { message: "The deadline had not passed on-chain yet. Chain time can run a few seconds behind. Try again shortly." },
  );
});

test("failed transaction receipts are surfaced", () => {
  assert.doesNotThrow(() => assertSuccessfulReceipt({ status: "success" }));
  assert.throws(() => assertSuccessfulReceipt({ status: "reverted" }), /receipt status: reverted/i);
  assert.throws(() => assertSuccessfulReceipt({}), /missing receipt status/i);
});
