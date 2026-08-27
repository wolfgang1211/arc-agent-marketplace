const SORTS = new Set(["newest", "rewardAsc", "rewardDesc"]);
const MAX_FIRST = 100;

export function normalizeCategory(value = "") {
  return String(value).trim().toLowerCase().replace(/\s+/g, " ");
}

export function filterAndSortOpenJobs(jobs = [], filters = {}) {
  const category = normalizeCategory(filters.category);
  const min = filters.rewardMin == null || filters.rewardMin === "" ? null : BigInt(filters.rewardMin);
  const max = filters.rewardMax == null || filters.rewardMax === "" ? null : BigInt(filters.rewardMax);
  const sort = SORTS.has(filters.sort) ? filters.sort : "newest";
  const direction = sort === "rewardAsc" ? 1 : -1;

  return jobs
    .filter((job) => String(job.status).toLowerCase() === "open" || Number(job.status) === 0)
    .filter((job) => !category || normalizeCategory(job.category) === category)
    .filter((job) => min == null || BigInt(job.reward) >= min)
    .filter((job) => max == null || BigInt(job.reward) <= max)
    .sort((left, right) => {
      const primary = sort === "newest"
        ? compareBigInt(left.createdAt ?? left.id, right.createdAt ?? right.id)
        : compareBigInt(left.reward, right.reward);
      if (primary !== 0) return primary * direction;
      return compareBigInt(left.id, right.id) * direction;
    });
}

export function rankAgents(agents = []) {
  return [...agents].sort((left, right) => {
    const clients = Number(right.currentDistinctClients) - Number(left.currentDistinctClients);
    if (clients !== 0) return clients;
    const approvals = Number(right.currentApprovedDeliveries) - Number(left.currentApprovedDeliveries);
    if (approvals !== 0) return approvals;
    return String(left.address).localeCompare(String(right.address));
  });
}

export function encodeDiscoveryCursor(value) {
  return btoa(JSON.stringify(value));
}

function decodeDiscoveryCursor(cursor) {
  if (!cursor) return null;
  try {
    const value = JSON.parse(atob(cursor));
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

export function buildDiscoveryQuery(filters = {}) {
  const sort = SORTS.has(filters.sort) ? filters.sort : "newest";
  const first = Math.max(1, Math.min(MAX_FIRST, Number(filters.first) || 20));
  const category = normalizeCategory(filters.category);
  const where = ["status: { _eq: $status }"];
  const variableDefinitions = ["$limit: Int!", "$status: String!"];
  const variables = { first, limit: first + 1, status: "Open" };

  if (category) {
    where.push("categoryNormalized: { _eq: $category }");
    variableDefinitions.push("$category: String!");
    variables.category = category;
  }
  if (filters.rewardMin != null && filters.rewardMin !== "") {
    where.push("reward: { _gte: $rewardMin }");
    variableDefinitions.push("$rewardMin: numeric!");
    variables.rewardMin = String(filters.rewardMin);
  }
  if (filters.rewardMax != null && filters.rewardMax !== "") {
    where.push("reward: { _lte: $rewardMax }");
    variableDefinitions.push("$rewardMax: numeric!");
    variables.rewardMax = String(filters.rewardMax);
  }

  const totalWhere = [...where];
  const cursor = decodeDiscoveryCursor(filters.cursor);
  if (cursor?.sort === sort && cursor.id != null) {
    variableDefinitions.push("$cursorId: numeric!");
    variables.cursorId = String(cursor.id);
    if (sort === "newest" && cursor.createdAt != null) {
      variableDefinitions.push("$cursorCreatedAt: numeric!");
      variables.cursorCreatedAt = String(cursor.createdAt);
      where.push("_or: [{ createdAt: { _lt: $cursorCreatedAt } }, { _and: [{ createdAt: { _eq: $cursorCreatedAt } }, { jobId: { _lt: $cursorId } }] }]");
    } else if (cursor.reward != null) {
      variableDefinitions.push("$cursorReward: numeric!");
      variables.cursorReward = String(cursor.reward);
      const operator = sort === "rewardAsc" ? "_gt" : "_lt";
      where.push(`_or: [{ reward: { ${operator}: $cursorReward } }, { _and: [{ reward: { _eq: $cursorReward } }, { jobId: { ${operator}: $cursorId } }] }]`);
    }
  }

  const order = sort === "rewardAsc" ? "reward: asc, jobId: asc" : sort === "rewardDesc" ? "reward: desc, jobId: desc" : "createdAt: desc, jobId: desc";
  const query = `query JobDiscovery(${variableDefinitions.join(", ")}) {
    jobs: Job(where: { ${where.join(", ")} }, order_by: { ${order} }, limit: $limit) {
      id: jobId client agent description category reward status deliverableURI createdAt updatedAt
    }
    total: Job_aggregate(where: { ${totalWhere.join(", ")} }) { aggregate { count } }
    agents: Agent(order_by: { currentDistinctClients: desc, currentApprovedDeliveries: desc, address: asc }, limit: 8) {
      address name skill reputationEpoch lifetimeSlashes currentDistinctClients currentApprovedDeliveries currentTotalEarned
    }
  }`;

  return { query, variables };
}

export async function fetchDiscovery(endpoint, filters = {}, fetchImpl = fetch) {
  if (!endpoint) throw new Error("Indexer endpoint is not configured");
  const request = buildDiscoveryQuery(filters);
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Error(`Indexer request failed (${response.status})`);
  const payload = await response.json();
  if (payload.errors?.length) throw new Error(payload.errors[0].message || "Indexer query failed");
  const first = request.variables.first;
  const allJobs = payload.data?.jobs || [];
  const jobs = allJobs.slice(0, first);
  const lastJob = jobs.at(-1);
  const sort = SORTS.has(filters.sort) ? filters.sort : "newest";
  const endCursor = lastJob ? encodeDiscoveryCursor({
    sort,
    id: String(lastJob.id),
    ...(sort === "newest" ? { createdAt: String(lastJob.createdAt) } : { reward: String(lastJob.reward) }),
  }) : null;
  return {
    jobs,
    total: payload.data?.total?.aggregate?.count || 0,
    agents: rankAgents(payload.data?.agents || []),
    pageInfo: { hasNextPage: allJobs.length > first, endCursor },
  };
}

function compareBigInt(left, right) {
  const a = BigInt(left ?? 0);
  const b = BigInt(right ?? 0);
  return a === b ? 0 : a > b ? 1 : -1;
}
