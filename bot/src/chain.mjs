import { createPublicClient, createWalletClient, defineChain, getAddress, http, parseEventLogs } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ERC20_ABI, MARKETPLACE_ABI } from "./abi.mjs";

export const ARC_TESTNET = defineChain({
  id: 5_042_002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
});

const PAGE_LIMIT = 100n;

export function createLiveChain({ rpcUrl, contractAddress, usdcAddress, privateKey, writeEnabled }) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey || "")) throw new Error("BOT_PRIVATE_KEY must be a 32-byte hex key");
  const account = privateKeyToAccount(privateKey);
  const transport = http(rpcUrl, { timeout: 15_000, retryCount: 3, retryDelay: 1_000 });
  return createChainAdapter({
    publicClient: createPublicClient({ chain: ARC_TESTNET, transport }),
    walletClient: createWalletClient({ account, chain: ARC_TESTNET, transport }),
    account,
    contractAddress,
    usdcAddress,
    writeEnabled,
  });
}

export function createChainAdapter({ publicClient, walletClient, account, contractAddress, usdcAddress, writeEnabled = false }) {
  const contract = getAddress(contractAddress);
  const usdc = getAddress(usdcAddress);
  const address = getAddress(account.address);
  const readMarketplace = (functionName, args = []) => publicClient.readContract({ address: contract, abi: MARKETPLACE_ABI, functionName, args });
  const readUsdc = (functionName, args = []) => publicClient.readContract({ address: usdc, abi: ERC20_ABI, functionName, args });

  async function execute(addressTo, abi, functionName, args, expectedEvents = [], onBroadcast) {
    if (!writeEnabled) throw new Error("live_writes_disabled");
    const { request } = await publicClient.simulateContract({ account, address: addressTo, abi, functionName, args });
    const hash = await walletClient.writeContract(request);
    if (onBroadcast) await onBroadcast(hash);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 60_000 });
    if (receipt.status !== "success") throw new Error(`${functionName}_receipt_failed`);
    const eventEvidence = Array.isArray(receipt.eventNames)
      ? receipt.eventNames.map((eventName) => ({ eventName, args: null }))
      : parseEventLogs({ abi: MARKETPLACE_ABI, logs: receipt.logs || [], strict: false });
    for (const expected of expectedEvents) {
      const found = eventEvidence.some((event) => event.eventName === expected.name && (event.args == null || matchesEventArgs(event.args, expected.args)));
      if (!found) throw new Error(`${functionName}_missing_${expected.name}_event`);
    }
    return { hash, receipt, eventNames: eventEvidence.map((event) => event.eventName) };
  }

  return {
    address,
    contractAddress: contract,
    usdcAddress: usdc,
    async assertChain() {
      const chainId = await publicClient.getChainId();
      if (chainId !== ARC_TESTNET.id) throw new Error(`wrong_chain_id_${chainId}`);
      return chainId;
    },
    async listJobs() {
      const total = await readMarketplace("jobCount");
      if (total === 0n) return [];
      const offset = total > PAGE_LIMIT ? total - PAGE_LIMIT : 0n;
      const [page] = await readMarketplace("getJobsPaged", [offset, PAGE_LIMIT]);
      return page;
    },
    async getJob(jobId) {
      const id = BigInt(jobId);
      if (id <= 0n) return null;
      const [page] = await readMarketplace("getJobsPaged", [id - 1n, 1n]);
      return page[0]?.id === id ? page[0] : null;
    },
    getAgent: () => readMarketplace("getAgent", [address]),
    getAgentStake: () => readMarketplace("AGENT_STAKE"),
    getNativeBalance: () => publicClient.getBalance({ address }),
    getUsdcBalance: () => readUsdc("balanceOf", [address]),
    getAllowance: () => readUsdc("allowance", [address, contract]),
    async getChainTimestamp() {
      return (await publicClient.getBlock({ blockTag: "latest" })).timestamp;
    },
    acceptJob: (jobId, options = {}) => execute(contract, MARKETPLACE_ABI, "acceptJob", [BigInt(jobId)], [{ name: "JobAccepted", args: { jobId: BigInt(jobId), agent: address } }], options.onBroadcast),
    submitDeliverable: (jobId, uri, options = {}) => execute(contract, MARKETPLACE_ABI, "submitDeliverable", [BigInt(jobId), uri], [{ name: "DeliverableSubmitted", args: { jobId: BigInt(jobId), deliverableURI: uri } }], options.onBroadcast),
    claimTimeout: (jobId, options = {}) => execute(contract, MARKETPLACE_ABI, "claimTimeout", [BigInt(jobId)], [
      { name: "AgentSlashed", args: { agent: address } },
      { name: "JobExpiredRefunded", args: { jobId: BigInt(jobId) } },
    ], options.onBroadcast),
    approveStake: (amount) => execute(usdc, ERC20_ABI, "approve", [contract, BigInt(amount)]),
    registerAgent: (name, skill, fee) => execute(contract, MARKETPLACE_ABI, "registerAgent", [name, skill, BigInt(fee)], [{ name: "AgentRegistered", args: { agent: address, name, skill, fee: BigInt(fee) } }]),
  };
}

function matchesEventArgs(actual, expected) {
  return Object.entries(expected || {}).every(([key, value]) => {
    const observed = actual?.[key];
    if (typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)) {
      return String(observed || "").toLowerCase() === value.toLowerCase();
    }
    return observed === value;
  });
}
