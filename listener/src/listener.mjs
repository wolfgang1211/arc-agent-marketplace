const EXPLORER = "https://testnet.arcscan.app";
const USDC_SCALE = 1_000000n;

export const EVENT_NAMES = [
  "JobPosted",
  "JobAccepted",
  "DeliverableSubmitted",
  "JobApproved",
  "AgentSlashed",
];

export const MARKETPLACE_EVENT_ABI = [
  {
    type: "event",
    name: "JobPosted",
    inputs: [
      { indexed: true, name: "jobId", type: "uint256" },
      { indexed: true, name: "client", type: "address" },
      { indexed: false, name: "reward", type: "uint256" },
      { indexed: false, name: "description", type: "string" },
      { indexed: false, name: "category", type: "string" },
    ],
  },
  {
    type: "event",
    name: "JobAccepted",
    inputs: [
      { indexed: true, name: "jobId", type: "uint256" },
      { indexed: true, name: "agent", type: "address" },
    ],
  },
  {
    type: "event",
    name: "DeliverableSubmitted",
    inputs: [
      { indexed: true, name: "jobId", type: "uint256" },
      { indexed: false, name: "deliverableURI", type: "string" },
    ],
  },
  {
    type: "event",
    name: "JobApproved",
    inputs: [
      { indexed: true, name: "jobId", type: "uint256" },
      { indexed: true, name: "agent", type: "address" },
      { indexed: false, name: "reward", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "AgentSlashed",
    inputs: [
      { indexed: true, name: "agent", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
    ],
  },
];

export async function processEventRange({ client, channel, state, contractAddress, fromBlock, toBlock }) {
  if (toBlock < fromBlock) return { delivered: 0, scannedTo: toBlock };
  const cursor = await state.load();
  const logs = await client.getContractEvents({
    address: contractAddress,
    abi: MARKETPLACE_EVENT_ABI,
    fromBlock,
    toBlock,
  });
  const ordered = [...logs]
    .filter((entry) => EVENT_NAMES.includes(entry.eventName))
    .sort(compareLogs);

  let delivered = 0;
  for (const entry of ordered) {
    if (cursor && comparePosition(entry, cursor) <= 0) continue;
    await channel.send(formatEventNotification(entry));
    await state.save(cursorFromLog(entry));
    delivered += 1;
  }

  await state.save({
    blockNumber: toBlock.toString(),
    logIndex: Number.MAX_SAFE_INTEGER,
    transactionHash: null,
  });
  return { delivered, scannedTo: toBlock };
}

export function formatEventNotification(entry) {
  const args = entry.args || {};
  const txUrl = `${EXPLORER}/tx/${entry.transactionHash}`;
  switch (entry.eventName) {
    case "JobPosted":
      return [
        `New job #${args.jobId} · ${formatUsdc(args.reward)} USDC · ${clean(args.category) || "uncategorized"}`,
        `Client: ${short(args.client)}`,
        clean(args.description, 400),
        txUrl,
      ].filter(Boolean).join("\n");
    case "JobAccepted":
      return `Job #${args.jobId} accepted\nAgent: ${short(args.agent)}\n${txUrl}`;
    case "DeliverableSubmitted":
      return `Deliverable submitted for job #${args.jobId}\n${clean(args.deliverableURI, 500)}\n${txUrl}`;
    case "JobApproved":
      return `Job #${args.jobId} approved · ${formatUsdc(args.reward)} USDC paid\nAgent: ${short(args.agent)}\n${txUrl}`;
    case "AgentSlashed":
      return `Agent slashed · ${formatUsdc(args.amount)} USDC\nAgent: ${short(args.agent)}\n${txUrl}`;
    default:
      throw new Error(`Unsupported marketplace event: ${entry.eventName}`);
  }
}

function compareLogs(a, b) {
  const blockComparison = compareBigInt(a.blockNumber, b.blockNumber);
  return blockComparison || Number(a.logIndex) - Number(b.logIndex);
}

function comparePosition(entry, cursor) {
  const blockComparison = compareBigInt(entry.blockNumber, BigInt(cursor.blockNumber));
  return blockComparison || Number(entry.logIndex) - Number(cursor.logIndex);
}

function compareBigInt(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function cursorFromLog(entry) {
  return {
    blockNumber: entry.blockNumber.toString(),
    logIndex: Number(entry.logIndex),
    transactionHash: entry.transactionHash,
  };
}

function formatUsdc(value) {
  const amount = BigInt(value ?? 0);
  const whole = amount / USDC_SCALE;
  const fraction = (amount % USDC_SCALE).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function clean(value, limit = 200) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

function short(value) {
  const text = String(value ?? "");
  return text.length > 12 ? `${text.slice(0, 6)}…${text.slice(-4)}` : text;
}
