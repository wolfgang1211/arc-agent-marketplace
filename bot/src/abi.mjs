export const MARKETPLACE_ABI = [
  { type: "function", name: "AGENT_STAKE", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "jobCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "registerAgent", stateMutability: "nonpayable", inputs: [{ name: "name", type: "string" }, { name: "skill", type: "string" }, { name: "fee", type: "uint256" }], outputs: [] },
  { type: "function", name: "acceptJob", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }], outputs: [] },
  { type: "function", name: "submitDeliverable", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }, { name: "deliverableURI", type: "string" }], outputs: [] },
  { type: "function", name: "claimTimeout", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }], outputs: [] },
  {
    type: "function", name: "getAgent", stateMutability: "view", inputs: [{ name: "who", type: "address" }], outputs: [{
      type: "tuple", components: [
        { name: "name", type: "string" }, { name: "skill", type: "string" }, { name: "fee", type: "uint256" },
        { name: "distinctClients", type: "uint256" }, { name: "inProgress", type: "uint256" }, { name: "submitted", type: "uint256" },
        { name: "approvedDeliveries", type: "uint256" }, { name: "disputes", type: "uint256" }, { name: "totalEarned", type: "uint256" },
        { name: "stake", type: "uint256" }, { name: "activeJobs", type: "uint256" }, { name: "registered", type: "bool" },
      ],
    }],
  },
  {
    type: "function", name: "getJobsPaged", stateMutability: "view", inputs: [{ name: "offset", type: "uint256" }, { name: "limit", type: "uint256" }], outputs: [
      { name: "page", type: "tuple[]", components: [
        { name: "id", type: "uint256" }, { name: "client", type: "address" }, { name: "agent", type: "address" },
        { name: "description", type: "string" }, { name: "category", type: "string" }, { name: "deliverableURI", type: "string" },
        { name: "reward", type: "uint256" }, { name: "status", type: "uint8" }, { name: "createdAt", type: "uint256" },
        { name: "deliveryDeadline", type: "uint256" }, { name: "approvalDeadline", type: "uint256" }, { name: "disputeDeadline", type: "uint256" },
        { name: "clientShareOnDispute", type: "uint256" },
      ] },
      { name: "total", type: "uint256" },
    ],
  },
  { type: "event", name: "AgentRegistered", inputs: [{ name: "agent", type: "address", indexed: true }, { name: "name", type: "string", indexed: false }, { name: "skill", type: "string", indexed: false }, { name: "fee", type: "uint256", indexed: false }], anonymous: false },
  { type: "event", name: "JobAccepted", inputs: [{ name: "jobId", type: "uint256", indexed: true }, { name: "agent", type: "address", indexed: true }], anonymous: false },
  { type: "event", name: "DeliverableSubmitted", inputs: [{ name: "jobId", type: "uint256", indexed: true }, { name: "deliverableURI", type: "string", indexed: false }], anonymous: false },
  { type: "event", name: "AgentSlashed", inputs: [{ name: "agent", type: "address", indexed: true }, { name: "amount", type: "uint256", indexed: false }], anonymous: false },
  { type: "event", name: "JobExpiredRefunded", inputs: [{ name: "jobId", type: "uint256", indexed: true }, { name: "client", type: "address", indexed: true }, { name: "reward", type: "uint256", indexed: false }], anonymous: false },
];

export const ERC20_ABI = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
];
