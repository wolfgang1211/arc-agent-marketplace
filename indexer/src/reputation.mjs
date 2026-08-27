const emptyAgent = () => ({
  reputationEpoch: 0,
  lifetimeSlashes: 0,
  currentDistinctClients: 0,
  currentApprovedDeliveries: 0,
  currentTotalEarned: 0n,
  currentCategoryClients: new Map(),
});

export function createState() {
  return { agents: new Map(), seenClients: new Set(), seenCategoryClients: new Set() };
}

export function replayEvents(state, events) {
  for (const event of events) applyEvent(state, event);
  return state;
}

export function applyEvent(state, event) {
  const key = String(event.agent).toLowerCase();
  const current = state.agents.get(key) || emptyAgent();

  if (event.type === "AgentSlashed") {
    state.agents.set(key, {
      ...emptyAgent(),
      reputationEpoch: current.reputationEpoch + 1,
      lifetimeSlashes: current.lifetimeSlashes + 1,
    });
    return state;
  }

  if (event.type !== "JobApproved") return state;
  current.currentApprovedDeliveries += 1;
  current.currentTotalEarned += BigInt(event.reward);

  const client = String(event.client).toLowerCase();
  const clientKey = `${key}:${client}`;
  if (!state.seenClients.has(clientKey)) {
    state.seenClients.add(clientKey);
    current.currentDistinctClients += 1;
  }

  const category = normalizeCategory(event.category);
  if (category) {
    const categoryClientKey = `${key}:${category}:${client}`;
    if (!state.seenCategoryClients.has(categoryClientKey)) {
      state.seenCategoryClients.add(categoryClientKey);
      current.currentCategoryClients.set(category, (current.currentCategoryClients.get(category) || 0) + 1);
    }
  }

  state.agents.set(key, current);
  return state;
}

function normalizeCategory(value = "") {
  return String(value).trim().toLowerCase().replace(/\s+/g, " ");
}
