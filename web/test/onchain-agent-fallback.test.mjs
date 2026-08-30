import assert from "node:assert/strict";
import test from "node:test";

import {
  ONCHAIN_AGENT_JOB_LIMIT,
  ONCHAIN_AGENT_LIMIT,
  getBoundedAgentCandidates,
  loadOnchainAgentFallback,
} from "../lib/discovery.mjs";

const ZERO = "0x0000000000000000000000000000000000000000";
const address = (n) => `0x${n.toString(16).padStart(40, "0")}`;

test("derives unique agent candidates from one bounded getJobsPaged page", () => {
  assert.equal(ONCHAIN_AGENT_JOB_LIMIT, 20);
  assert.equal(ONCHAIN_AGENT_LIMIT, 8);
  const jobs = [
    { agent: ZERO },
    { agent: address(1) },
    { agent: address(1).toUpperCase() },
    ...Array.from({ length: 30 }, (_, i) => ({ agent: address(i + 2) })),
  ];
  assert.deepEqual(
    getBoundedAgentCandidates(jobs),
    Array.from({ length: 8 }, (_, i) => address(i + 1)),
  );
});

test("loads and ranks bounded on-chain recommendations with exact reputation fields", async () => {
  const jobs = [
    { agent: address(1) },
    { agent: address(2) },
    { agent: address(3) },
  ];
  const profileReads = [];
  const reputationReads = [];
  const agents = await loadOnchainAgentFallback(
    jobs,
    async (who) => {
      profileReads.push(who);
      return { name: `Agent ${who.slice(-1)}`, skill: "automation", registered: who !== address(3) };
    },
    async (who) => {
      reputationReads.push(who);
      return [
        who === address(2) ? 2n : 1n,
        0n,
        who === address(1) ? 5n : 3n,
        0n,
        0n,
      ];
    },
  );

  assert.equal(profileReads.length, 3);
  assert.equal(reputationReads.length, 3);
  assert.deepEqual(agents.map((agent) => agent.address), [address(2), address(1)]);
  assert.deepEqual(
    agents.map((agent) => [agent.currentDistinctClients, agent.currentApprovedDeliveries]),
    [[2n, 3n], [1n, 5n]],
  );
});

test("never reads more than the bounded candidate limit", async () => {
  const jobs = Array.from({ length: 50 }, (_, i) => ({ agent: address(i + 1) }));
  let reads = 0;
  await loadOnchainAgentFallback(
    jobs,
    async () => { reads += 1; return { name: "Agent", skill: "skill", registered: true }; },
    async () => ({ distinctClients: 1n, approvedDeliveries: 1n, totalEarned: 0n }),
  );
  assert.equal(reads, ONCHAIN_AGENT_LIMIT);
});
