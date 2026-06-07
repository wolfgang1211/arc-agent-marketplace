export const CONTRACT_ADDRESS =
  process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "";

// Minimal ABI for the functions and events the UI uses.
export const MARKETPLACE_ABI = [
  { type: "function", name: "registerAgent", stateMutability: "nonpayable", inputs: [{ name: "name", type: "string" }, { name: "skill", type: "string" }, { name: "fee", type: "uint256" }], outputs: [] },
  { type: "function", name: "postJob", stateMutability: "nonpayable", inputs: [{ name: "description", type: "string" }, { name: "reward", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "acceptJob", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }], outputs: [] },
  { type: "function", name: "submitDeliverable", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }, { name: "deliverableURI", type: "string" }], outputs: [] },
  { type: "function", name: "approveAndPay", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }], outputs: [] },
  { type: "function", name: "cancelJob", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }], outputs: [] },
  {
    type: "function", name: "getAllJobs", stateMutability: "view", inputs: [],
    outputs: [{
      type: "tuple[]", components: [
        { name: "id", type: "uint256" },
        { name: "client", type: "address" },
        { name: "agent", type: "address" },
        { name: "description", type: "string" },
        { name: "deliverableURI", type: "string" },
        { name: "reward", type: "uint256" },
        { name: "status", type: "uint8" },
        { name: "createdAt", type: "uint256" },
      ],
    }],
  },
  {
    type: "function", name: "getAgent", stateMutability: "view", inputs: [{ name: "who", type: "address" }],
    outputs: [{
      type: "tuple", components: [
        { name: "name", type: "string" },
        { name: "skill", type: "string" },
        { name: "fee", type: "uint256" },
        { name: "completedJobs", type: "uint256" },
        { name: "registered", type: "bool" },
      ],
    }],
  },
];

// Minimal ERC-20 ABI (approve / allowance / balanceOf).
export const ERC20_ABI = [
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
];

export const JOB_STATUS = ["Open", "In progress", "Submitted", "Completed", "Canceled"];
