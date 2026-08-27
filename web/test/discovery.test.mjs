import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDiscoveryQuery,
  encodeDiscoveryCursor,
  fetchDiscovery,
  filterAndSortOpenJobs,
  normalizeCategory,
  rankAgents,
} from "../lib/discovery.mjs";

const jobs = [
  { id: "1", category: "Research", reward: "5000000", status: "Open", createdAt: "10" },
  { id: "2", category: " research ", reward: "12000000", status: "Open", createdAt: "30" },
  { id: "3", category: "code", reward: "9000000", status: "Completed", createdAt: "40" },
  { id: "4", category: "code", reward: "7000000", status: "Open", createdAt: "20" },
];

test("normalizes categories for exact discovery matching", () => {
  assert.equal(normalizeCategory("  Data   Research  "), "data research");
});

test("filters open jobs by normalized category and inclusive reward bounds", () => {
  assert.deepEqual(
    filterAndSortOpenJobs(jobs, {
      category: "RESEARCH",
      rewardMin: 6_000000n,
      rewardMax: 12_000000n,
      sort: "rewardAsc",
    }).map((job) => job.id),
    ["2"],
  );
});

test("sorts open jobs deterministically", () => {
  assert.deepEqual(filterAndSortOpenJobs(jobs, { sort: "newest" }).map((job) => job.id), ["2", "4", "1"]);
  assert.deepEqual(filterAndSortOpenJobs(jobs, { sort: "rewardDesc" }).map((job) => job.id), ["2", "4", "1"]);
});

test("ranks agents by current distinct clients then approved deliveries", () => {
  const ranked = rankAgents([
    { address: "0xbbb", currentDistinctClients: 4, currentApprovedDeliveries: 8 },
    { address: "0xaaa", currentDistinctClients: 4, currentApprovedDeliveries: 9 },
    { address: "0xccc", currentDistinctClients: 7, currentApprovedDeliveries: 7 },
  ]);
  assert.deepEqual(ranked.map((agent) => agent.address), ["0xccc", "0xaaa", "0xbbb"]);
});

test("builds bounded indexer queries with literal supported sort fields", () => {
  const request = buildDiscoveryQuery({ category: "Research", rewardMin: 5_000000n, sort: "rewardDesc", first: 500 });
  assert.equal(request.variables.first, 100);
  assert.equal(request.variables.category, "research");
  assert.match(request.query, /reward: desc/);
  assert.equal(request.variables.status, "Open");
  assert.match(request.query, /status: \{ _eq: \$status \}/);
  assert.doesNotMatch(request.query, /order_by: \$sort/);
});

test("uses opaque compound cursors and returns bounded pageInfo", async () => {
  const cursor = encodeDiscoveryCursor({ sort: "rewardDesc", reward: "9000000", id: "9" });
  const request = buildDiscoveryQuery({ sort: "rewardDesc", first: 2, cursor });
  assert.equal(request.variables.cursorReward, "9000000");
  assert.equal(request.variables.cursorId, "9");
  assert.match(request.query, /reward: \{ _lt: \$cursorReward \}/);

  const result = await fetchDiscovery("https://example.test/graphql", { sort: "rewardDesc", first: 2 }, async () => ({
    ok: true,
    json: async () => ({ data: {
      jobs: [
        { id: "3", reward: "300", createdAt: "30" },
        { id: "2", reward: "200", createdAt: "20" },
        { id: "1", reward: "100", createdAt: "10" },
      ],
      total: { aggregate: { count: 3 } },
      agents: [],
    } }),
  }));
  assert.deepEqual(result.jobs.map((job) => job.id), ["3", "2"]);
  assert.equal(result.pageInfo.hasNextPage, true);
  assert.equal(typeof result.pageInfo.endCursor, "string");
});
