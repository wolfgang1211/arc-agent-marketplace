import { indexer } from "envio";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const normalizeAddress = (value: string) => value.toLowerCase();
const normalizeCategory = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
const jobId = (value: bigint) => value.toString();

const emptyAgent = (address: string) => ({
  id: address,
  address,
  name: "",
  skill: "",
  reputationEpoch: 0,
  lifetimeSlashes: 0,
  currentDistinctClients: 0,
  currentApprovedDeliveries: 0,
  currentTotalEarned: 0n,
});

indexer.onEvent({ contract: "AgentMarketplace", event: "AgentRegistered" }, async ({ event, context }) => {
  const address = normalizeAddress(event.params.agent);
  const current = (await context.Agent.get(address)) ?? emptyAgent(address);
  context.Agent.set({ ...current, name: event.params.name, skill: event.params.skill });
});

indexer.onEvent({ contract: "AgentMarketplace", event: "JobPosted" }, async ({ event, context }) => {
  const id = jobId(event.params.jobId);
  context.Job.set({
    id,
    jobId: event.params.jobId,
    client: normalizeAddress(event.params.client),
    agent: ZERO_ADDRESS,
    description: event.params.description,
    category: event.params.category,
    categoryNormalized: normalizeCategory(event.params.category),
    reward: event.params.reward,
    status: "Open",
    deliverableURI: "",
    createdAt: event.block.timestamp,
    updatedAt: event.block.timestamp,
  });
});

indexer.onEvent({ contract: "AgentMarketplace", event: "JobAccepted" }, async ({ event, context }) => {
  const id = jobId(event.params.jobId);
  const job = await context.Job.getOrThrow(id);
  context.Job.set({ ...job, agent: normalizeAddress(event.params.agent), status: "InProgress", updatedAt: event.block.timestamp });
});

indexer.onEvent({ contract: "AgentMarketplace", event: "DeliverableSubmitted" }, async ({ event, context }) => {
  const id = jobId(event.params.jobId);
  const job = await context.Job.getOrThrow(id);
  context.Job.set({ ...job, deliverableURI: event.params.deliverableURI, status: "Submitted", updatedAt: event.block.timestamp });
});

indexer.onEvent({ contract: "AgentMarketplace", event: "JobDisputed" }, async ({ event, context }) => {
  await setJobStatus(context, event.params.jobId, "Disputed", event.block.timestamp);
});

indexer.onEvent({ contract: "AgentMarketplace", event: "JobCancelled" }, async ({ event, context }) => {
  await setJobStatus(context, event.params.jobId, "Cancelled", event.block.timestamp);
});

indexer.onEvent({ contract: "AgentMarketplace", event: "JobExpiredRefunded" }, async ({ event, context }) => {
  await setJobStatus(context, event.params.jobId, "ExpiredRefund", event.block.timestamp);
});

indexer.onEvent({ contract: "AgentMarketplace", event: "JobExpiredPaid" }, async ({ event, context }) => {
  await setJobStatus(context, event.params.jobId, "ExpiredPayout", event.block.timestamp);
});

indexer.onEvent({ contract: "AgentMarketplace", event: "JobExpiredSplit" }, async ({ event, context }) => {
  await setJobStatus(context, event.params.jobId, "ExpiredSplit", event.block.timestamp);
});

indexer.onEvent({ contract: "AgentMarketplace", event: "JobApproved" }, async ({ event, context }) => {
  const id = jobId(event.params.jobId);
  const job = await context.Job.getOrThrow(id);
  const address = normalizeAddress(event.params.agent);
  const agent = (await context.Agent.get(address)) ?? emptyAgent(address);
  const client = normalizeAddress(job.client);
  const clientPairId = `${address}:${client}`;
  const knownClient = await context.AgentClient.get(clientPairId);
  let currentDistinctClients = agent.currentDistinctClients;

  if (!knownClient) {
    currentDistinctClients += 1;
    context.AgentClient.set({
      id: clientPairId,
      agent: address,
      client,
      firstApprovedJob: id,
      lastApprovedJob: id,
      epoch: agent.reputationEpoch,
    });
  } else {
    context.AgentClient.set({ ...knownClient, lastApprovedJob: id, epoch: agent.reputationEpoch });
  }

  const category = normalizeCategory(job.category);
  if (category) {
    const categoryPairId = `${address}:${category}:${client}`;
    const knownCategoryClient = await context.AgentCategoryClient.get(categoryPairId);
    if (!knownCategoryClient) {
      const categoryId = `${address}:${category}`;
      const aggregate = (await context.AgentCategory.get(categoryId)) ?? {
        id: categoryId,
        agent: address,
        category,
        epoch: agent.reputationEpoch,
        currentDistinctClients: 0,
      };
      context.AgentCategory.set({
        ...aggregate,
        epoch: agent.reputationEpoch,
        currentDistinctClients: aggregate.currentDistinctClients + 1,
      });
      context.AgentCategoryClient.set({
        id: categoryPairId,
        agent: address,
        client,
        category,
        firstApprovedJob: id,
        lastApprovedJob: id,
        epoch: agent.reputationEpoch,
      });
    } else {
      context.AgentCategoryClient.set({ ...knownCategoryClient, lastApprovedJob: id, epoch: agent.reputationEpoch });
    }
  }

  context.Agent.set({
    ...agent,
    currentDistinctClients,
    currentApprovedDeliveries: agent.currentApprovedDeliveries + 1,
    currentTotalEarned: agent.currentTotalEarned + event.params.reward,
  });
  context.Job.set({ ...job, status: "Completed", updatedAt: event.block.timestamp });
});

indexer.onEvent({ contract: "AgentMarketplace", event: "AgentSlashed" }, async ({ event, context }) => {
  const address = normalizeAddress(event.params.agent);
  const agent = (await context.Agent.get(address)) ?? emptyAgent(address);
  const nextEpoch = agent.reputationEpoch + 1;
  context.Agent.set({
    ...agent,
    reputationEpoch: nextEpoch,
    lifetimeSlashes: agent.lifetimeSlashes + 1,
    currentDistinctClients: 0,
    currentApprovedDeliveries: 0,
    currentTotalEarned: 0n,
  });

  const categories = await context.AgentCategory.getWhere({ agent: { _eq: address } });
  for (const category of categories) {
    context.AgentCategory.set({ ...category, epoch: nextEpoch, currentDistinctClients: 0 });
  }
});

async function setJobStatus(context: any, rawJobId: bigint, status: string, updatedAt: bigint) {
  const id = jobId(rawJobId);
  const job = await context.Job.getOrThrow(id);
  context.Job.set({ ...job, status, updatedAt });
}
