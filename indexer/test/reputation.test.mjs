import assert from "node:assert/strict";
import test from "node:test";

import { createState, replayEvents } from "../src/reputation.mjs";

const agent = "0xagent";
const approved = (jobId, client, category = "research") => ({
  type: "JobApproved",
  jobId: String(jobId),
  agent,
  client,
  category,
  reward: 5_000000n,
});

test("slash resets current-era ranking while retaining lifetime dedupe", () => {
  const firstEra = Array.from({ length: 12 }, (_, index) => approved(index + 1, `0xclient${index + 1}`));
  const events = [
    ...firstEra,
    { type: "AgentSlashed", agent },
    approved(13, "0xclient1"),
    approved(14, "0xclient13"),
  ];

  const state = replayEvents(createState(), events);
  const projection = state.agents.get(agent);
  assert.equal(projection.reputationEpoch, 1);
  assert.equal(projection.lifetimeSlashes, 1);
  assert.equal(projection.currentDistinctClients, 1);
  assert.equal(projection.currentApprovedDeliveries, 2);
  assert.equal(projection.currentCategoryClients.get("research"), 1);
});

test("replay is deterministic", () => {
  const events = [approved(1, "0xclient1"), { type: "AgentSlashed", agent }, approved(2, "0xclient2")];
  const serialize = (state) => ({
    agents: [...state.agents].map(([address, value]) => [address, { ...value, currentCategoryClients: [...value.currentCategoryClients] }]),
    seenClients: [...state.seenClients].sort(),
    seenCategoryClients: [...state.seenCategoryClients].sort(),
  });
  assert.deepEqual(serialize(replayEvents(createState(), events)), serialize(replayEvents(createState(), events)));
});
