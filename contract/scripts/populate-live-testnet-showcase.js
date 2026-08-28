const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");
require("dotenv").config();
const { normalizePrivateKey } = require("../lib/deploy-preflight");

const ROOT = path.resolve(__dirname, "..");
const RPC_URL = process.env.ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.network";
const EXPECTED_CHAIN_ID = 5042002n;
const USDC_ADDRESS = "0x3600000000000000000000000000000000000000";
const STAKE = 10_000000n;
const REWARD = 5_000000n;
const TOTAL_ESCROW = REWARD * 3n;
const AGENT_SECRET_PATH = path.join(ROOT, ".deployment-secrets", "arc-verification-agent.json");
const MARKET_ARTIFACT = require("../artifacts/contracts/AgentMarketplace.sol/AgentMarketplace.json");
const USDC_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];

function findRunState() {
  const names = fs.readdirSync(path.join(ROOT, "deployment-runs"))
    .filter((name) => name.startsWith("arc-testnet-live-testnet-0x") && name.endsWith(".json"));
  const attested = names
    .map((name) => ({ name, state: JSON.parse(fs.readFileSync(path.join(ROOT, "deployment-runs", name), "utf8")) }))
    .filter(({ state }) => state.deploymentMode === "live-testnet" && state.status === "ATTESTED");
  if (attested.length !== 1) throw new Error(`Expected exactly one ATTESTED live-testnet run, found ${attested.length}`);
  return { statePath: path.join(ROOT, "deployment-runs", attested[0].name), state: attested[0].state };
}

function saveState(statePath, state) {
  const temp = `${statePath}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.renameSync(temp, statePath);
}

function ensureShowcase(state) {
  state.showcase ??= { status: "IN_PROGRESS", transactions: [], jobs: {} };
  state.showcase.transactions ??= [];
  state.showcase.jobs ??= {};
}

function transactionRecord(state, label) {
  return state.showcase.transactions.find((record) => record.label === label);
}

async function executeTx({ statePath, state, provider, label, estimate, send }) {
  let record = transactionRecord(state, label);
  if (record?.receiptStatus === 1) return record;
  if (!record) {
    const estimatedGas = await estimate();
    const transaction = await send();
    record = {
      label,
      hash: transaction.hash,
      estimatedGas: estimatedGas.toString(),
      receiptStatus: "PENDING",
    };
    state.showcase.transactions.push(record);
    saveState(statePath, state);
  }
  const receipt = await provider.waitForTransaction(record.hash);
  record.receiptStatus = receipt.status;
  record.actualGas = receipt.gasUsed.toString();
  record.gasDeviation = (receipt.gasUsed - BigInt(record.estimatedGas)).toString();
  record.effectiveGasPriceWei = receipt.gasPrice.toString();
  record.actualFeeWei = (receipt.gasUsed * receipt.gasPrice).toString();
  record.blockNumber = receipt.blockNumber;
  saveState(statePath, state);
  if (receipt.status !== 1) throw new Error(`${label} failed with receipt.status=${receipt.status}`);
  console.log(`${label}: ${record.hash} status=1 gas=${record.estimatedGas}/${record.actualGas}`);
  return record;
}

async function postJob(context, key, description, category) {
  const { state, statePath, provider, clientMarket } = context;
  if (state.showcase.jobs[key]?.id) return BigInt(state.showcase.jobs[key].id);
  const record = await executeTx({
    ...context,
    label: `postJob:${key}`,
    estimate: () => clientMarket["postJob(string,uint256,string)"].estimateGas(description, REWARD, category),
    send: () => clientMarket["postJob(string,uint256,string)"](description, REWARD, category),
  });
  const receipt = await provider.getTransactionReceipt(record.hash);
  const posted = receipt.logs
    .map((log) => {
      try { return clientMarket.interface.parseLog(log); } catch { return null; }
    })
    .find((event) => event?.name === "JobPosted");
  if (!posted) throw new Error(`JobPosted event missing for ${key}`);
  const id = posted.args.jobId;
  state.showcase.jobs[key] = { id: id.toString(), expectedStatus: key === "open" ? "Open" : "Completed" };
  saveState(statePath, state);
  return id;
}

async function main() {
  if (!fs.existsSync(AGENT_SECRET_PATH)) throw new Error("Controlled agent secret file is missing");
  const { statePath, state } = findRunState();
  ensureShowcase(state);
  if (state.showcase.status === "VERIFIED") {
    console.log("Showcase already VERIFIED; no transaction sent.");
    return;
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const network = await provider.getNetwork();
  if (network.chainId !== EXPECTED_CHAIN_ID) throw new Error(`Wrong chain ${network.chainId}`);
  const client = new ethers.Wallet(normalizePrivateKey(process.env.PRIVATE_KEY), provider);
  const agentSecret = JSON.parse(fs.readFileSync(AGENT_SECRET_PATH, "utf8"));
  const agent = new ethers.Wallet(normalizePrivateKey(agentSecret.privateKey), provider);
  if (client.address.toLowerCase() === agent.address.toLowerCase()) throw new Error("Client and agent must differ");

  const tokenClient = new ethers.Contract(USDC_ADDRESS, USDC_ABI, client);
  const tokenAgent = new ethers.Contract(USDC_ADDRESS, USDC_ABI, agent);
  const clientMarket = new ethers.Contract(state.contractAddress, MARKET_ARTIFACT.abi, client);
  const agentMarket = new ethers.Contract(state.contractAddress, MARKET_ARTIFACT.abi, agent);
  const [configuredStake, delivery, approval, dispute, clientBalance, agentBalance] = await Promise.all([
    clientMarket.AGENT_STAKE(),
    clientMarket.DELIVERY_TIMEOUT(),
    clientMarket.APPROVAL_TIMEOUT(),
    clientMarket.DISPUTE_TIMEOUT(),
    tokenClient.balanceOf(client.address),
    tokenAgent.balanceOf(agent.address),
  ]);
  if (configuredStake !== STAKE || delivery !== 86400n || approval !== 86400n || dispute !== 86400n) {
    throw new Error("Live-testnet immutable configuration mismatch");
  }
  if (clientBalance < TOTAL_ESCROW) throw new Error("Client balance is below the 15 USDC showcase escrow requirement");
  if (agentBalance < STAKE) throw new Error("Agent balance is below the 10 USDC stake requirement");

  const context = { statePath, state, provider, clientMarket };
  await executeTx({
    ...context,
    label: "agent:approveStake",
    estimate: () => tokenAgent.approve.estimateGas(state.contractAddress, STAKE),
    send: () => tokenAgent.approve(state.contractAddress, STAKE),
  });
  await executeTx({
    ...context,
    label: "agent:register",
    estimate: () => agentMarket.registerAgent.estimateGas("Arc AI Builder", "AI automation", 0),
    send: () => agentMarket.registerAgent("Arc AI Builder", "AI automation", 0),
  });
  await executeTx({
    ...context,
    label: "client:approveEscrow",
    estimate: () => tokenClient.approve.estimateGas(state.contractAddress, TOTAL_ESCROW),
    send: () => tokenClient.approve(state.contractAddress, TOTAL_ESCROW),
  });

  const completedOne = await postJob(
    context,
    "completedOne",
    "Summarize an on-chain market into five actionable bullets\n\nAcceptance criteria:\nInclude sources, risks, and a concise recommendation.",
    "research",
  );
  await executeTx({ ...context, label: "completedOne:accept", estimate: () => agentMarket.acceptJob.estimateGas(completedOne), send: () => agentMarket.acceptJob(completedOne) });
  await executeTx({ ...context, label: "completedOne:submit", estimate: () => agentMarket.submitDeliverable.estimateGas(completedOne, "ipfs://arc-demo-market-summary"), send: () => agentMarket.submitDeliverable(completedOne, "ipfs://arc-demo-market-summary") });
  await executeTx({ ...context, label: "completedOne:approve", estimate: () => clientMarket.approveAndPay.estimateGas(completedOne), send: () => clientMarket.approveAndPay(completedOne) });

  const completedTwo = await postJob(
    context,
    "completedTwo",
    "Review an AI agent workflow for reliability gaps\n\nAcceptance criteria:\nReturn prioritized findings and concrete mitigations.",
    "engineering",
  );
  await executeTx({ ...context, label: "completedTwo:accept", estimate: () => agentMarket.acceptJob.estimateGas(completedTwo), send: () => agentMarket.acceptJob(completedTwo) });
  await executeTx({ ...context, label: "completedTwo:submit", estimate: () => agentMarket.submitDeliverable.estimateGas(completedTwo, "ipfs://arc-demo-workflow-review"), send: () => agentMarket.submitDeliverable(completedTwo, "ipfs://arc-demo-workflow-review") });
  await executeTx({ ...context, label: "completedTwo:approve", estimate: () => clientMarket.approveAndPay.estimateGas(completedTwo), send: () => clientMarket.approveAndPay(completedTwo) });

  const open = await postJob(
    context,
    "open",
    "Create a lightweight monitoring plan for an autonomous agent\n\nAcceptance criteria:\nDefine signals, thresholds, and a daily operator checklist.",
    "operations",
  );

  const [registeredAgent, jobOne, jobTwo, openJob, jobCount, slashSink, feeSink, contractBalance] = await Promise.all([
    clientMarket.getAgent(agent.address),
    clientMarket.jobs(completedOne),
    clientMarket.jobs(completedTwo),
    clientMarket.jobs(open),
    clientMarket.jobCount(),
    clientMarket.slashSinkBalance(),
    clientMarket.reputationFeeSinkBalance(),
    tokenClient.balanceOf(state.contractAddress),
  ]);
  const accepted = registeredAgent.registered === true
    && registeredAgent.stake === STAKE
    && registeredAgent.approvedDeliveries === 2n
    && registeredAgent.distinctClients === 1n
    && registeredAgent.activeJobs === 0n
    && jobOne.status === 4n
    && jobTwo.status === 4n
    && openJob.status === 0n
    && jobCount === 3n
    && slashSink === 0n
    && feeSink === 500000n
    && contractBalance === 15_500000n;
  if (!accepted) throw new Error("Showcase post-state verification failed");

  const latest = await provider.getBlock("latest");
  state.showcase.status = "VERIFIED";
  state.showcase.verifiedAtBlock = latest.number;
  state.showcase.verifiedAtTimestamp = latest.timestamp;
  state.showcase.clientAddress = client.address;
  state.showcase.agentAddress = agent.address;
  state.showcase.summary = {
    registeredAgents: 1,
    jobs: 3,
    statuses: ["Completed", "Completed", "Open"],
    agentStake: STAKE.toString(),
    approvedDeliveries: registeredAgent.approvedDeliveries.toString(),
    distinctClients: registeredAgent.distinctClients.toString(),
    slashSinkBalance: slashSink.toString(),
    reputationFeeSinkBalance: feeSink.toString(),
    contractBalance: contractBalance.toString(),
  };
  saveState(statePath, state);
  console.log(JSON.stringify({ accepted: true, contractAddress: state.contractAddress, ...state.showcase.summary }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
