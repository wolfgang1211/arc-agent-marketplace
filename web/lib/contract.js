export const CONTRACT_ADDRESS =
  process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "";

// Minimal ABI for the functions and events the UI uses.
export const MARKETPLACE_ABI = [
  {
    type: "event",
    name: "AgentSlashed",
    anonymous: false,
    inputs: [
      { name: "agent", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  { type: "function", name: "AGENT_STAKE", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "DISPUTE_TIMEOUT", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "jobCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "registerAgent", stateMutability: "nonpayable", inputs: [{ name: "name", type: "string" }, { name: "skill", type: "string" }, { name: "fee", type: "uint256" }], outputs: [] },
  { type: "function", name: "postJob", stateMutability: "nonpayable", inputs: [{ name: "description", type: "string" }, { name: "reward", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "postJob", stateMutability: "nonpayable", inputs: [{ name: "description", type: "string" }, { name: "reward", type: "uint256" }, { name: "category", type: "string" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "acceptJob", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }], outputs: [] },
  { type: "function", name: "submitDeliverable", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }, { name: "deliverableURI", type: "string" }], outputs: [] },
  { type: "function", name: "approveAndPay", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }], outputs: [] },
  { type: "function", name: "disputeJob", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }], outputs: [] },
  { type: "function", name: "claimTimeout", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }], outputs: [] },
  { type: "function", name: "cancelJob", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }], outputs: [] },
  { type: "function", name: "withdrawStake", stateMutability: "nonpayable", inputs: [], outputs: [] },
  {
    type: "function", name: "getAgent", stateMutability: "view", inputs: [{ name: "who", type: "address" }],
    outputs: [{
      type: "tuple", components: [
        { name: "name", type: "string" },
        { name: "skill", type: "string" },
        { name: "fee", type: "uint256" },
        { name: "distinctClients", type: "uint256" },
        { name: "inProgress", type: "uint256" },
        { name: "submitted", type: "uint256" },
        { name: "approvedDeliveries", type: "uint256" },
        { name: "disputes", type: "uint256" },
        { name: "totalEarned", type: "uint256" },
        { name: "stake", type: "uint256" },
        { name: "activeJobs", type: "uint256" },
        { name: "registered", type: "bool" },
      ],
    }],
  },
  {
    type: "function", name: "getAgentReputation", stateMutability: "view", inputs: [{ name: "who", type: "address" }],
    outputs: [
      { name: "distinctClients", type: "uint256" },
      { name: "submitted", type: "uint256" },
      { name: "approvedDeliveries", type: "uint256" },
      { name: "disputes", type: "uint256" },
      { name: "totalEarned", type: "uint256" },
    ],
  },
  { type: "function", name: "getReputationByCategory", stateMutability: "view", inputs: [{ name: "who", type: "address" }, { name: "category", type: "string" }], outputs: [{ type: "uint256" }] },
  {
    type: "function", name: "getJobsPaged", stateMutability: "view", inputs: [{ name: "offset", type: "uint256" }, { name: "limit", type: "uint256" }],
    outputs: [
      {
        name: "page", type: "tuple[]", components: [
          { name: "id", type: "uint256" },
          { name: "client", type: "address" },
          { name: "agent", type: "address" },
          { name: "description", type: "string" },
          { name: "category", type: "string" },
          { name: "deliverableURI", type: "string" },
          { name: "reward", type: "uint256" },
          { name: "status", type: "uint8" },
          { name: "createdAt", type: "uint256" },
          { name: "deliveryDeadline", type: "uint256" },
          { name: "approvalDeadline", type: "uint256" },
          { name: "disputeDeadline", type: "uint256" },
          { name: "clientShareOnDispute", type: "uint256" },
        ],
      },
      { name: "total", type: "uint256" },
    ],
  },
];

// Minimal ERC-20 ABI (approve / allowance / balanceOf).
export const ERC20_ABI = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
];

export const JOB_STATUS = [
  "Open",
  "In progress",
  "Submitted",
  "Disputed",
  "Completed",
  "Canceled",
  "Expired refund",
  "Expired payout",
  "Expired split",
];
