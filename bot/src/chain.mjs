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

export function createLiveChain({ rpcUrl, contractAddress, usdcAddress, privateKey, writeEnabled, houseDelaySeconds, pilotJobId, pilotScopeValid, pilotScopeReason }) {
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
    houseDelaySeconds,
    pilotJobId,
    pilotScopeValid,
    pilotScopeReason,
  });
}

export function createChainAdapter({ publicClient, walletClient, account, contractAddress, usdcAddress, writeEnabled = false, houseDelaySeconds = 14_400, pilotJobId = null, pilotScopeValid = false, pilotScopeReason = "pilot_job_id_missing" }) {
  const contract = getAddress(contractAddress);
  const usdc = getAddress(usdcAddress);
  const address = getAddress(account.address);
  const readMarketplace = (functionName, args = []) => publicClient.readContract({ address: contract, abi: MARKETPLACE_ABI, functionName, args });
  const readUsdc = (functionName, args = []) => publicClient.readContract({ address: usdc, abi: ERC20_ABI, functionName, args });

  async function execute(addressTo, abi, functionName, args, expectedEvents = [], onBroadcast, scopedJobId = null) {
    if (!writeEnabled) throw new Error("live_writes_disabled");
    if (!pilotScopeValid || pilotJobId == null) throw new Error(`pilot_scope_invalid:${pilotScopeReason || "pilot_job_id_invalid"}`);
    if (scopedJobId == null) throw new Error("pilot_scope_non_job_write");
    if (BigInt(scopedJobId) !== BigInt(pilotJobId)) throw new Error("pilot_scope_violation");
    let request;
    try {
      ({ request } = await publicClient.simulateContract({ account, address: addressTo, abi, functionName, args }));
    } catch (error) {
      throw withTransactionStage(error, "simulation");
    }
    let hash;
    try {
      hash = await walletClient.writeContract(request);
    } catch (error) {
      throw withTransactionStage(error, "broadcast");
    }
    if (onBroadcast) await onBroadcast(hash);
    let receipt;
    try {
      receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 60_000 });
    } catch (error) {
      throw withTransactionStage(error, "receipt", hash);
    }
    if (receipt.status !== "success") throw withTransactionStage(new Error(`${functionName}_receipt_failed`), "receipt", hash);
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
    writeEnabled,
    houseDelaySeconds,
    pilotJobId,
    pilotScopeValid,
    pilotScopeReason,
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
    async getTransactionStatus(hash) {
      try {
        const receipt = await publicClient.getTransactionReceipt({ hash });
        return receipt.status === "success" ? "success" : "reverted";
      } catch (error) {
        if (["TransactionReceiptNotFoundError", "TransactionNotFoundError"].includes(error?.name)) return "pending";
        throw error;
      }
    },
    async getChainTimestamp() {
      return (await publicClient.getBlock({ blockTag: "latest" })).timestamp;
    },
    async getJobOpeningTime(job) {
      const structTimestamp = positiveTimestamp(job?.createdAt);
      if (structTimestamp != null) return { timestamp: structTimestamp, source: "createdAt" };

      const jobId = BigInt(job?.id || 0);
      if (jobId <= 0n) throw new Error("job_open_time_unavailable");
      let events;
      try {
        events = await publicClient.getContractEvents({
          address: contract,
          abi: MARKETPLACE_ABI,
          eventName: "JobPosted",
          args: { jobId },
          fromBlock: 0n,
          toBlock: "latest",
        });
      } catch {
        throw new Error("job_open_time_unavailable");
      }
      if (!Array.isArray(events) || events.length !== 1 || events[0].blockNumber == null) throw new Error("job_open_time_unavailable");
      try {
        const block = await publicClient.getBlock({ blockNumber: events[0].blockNumber });
        const eventTimestamp = positiveTimestamp(block?.timestamp);
        if (eventTimestamp == null) throw new Error("job_open_time_unavailable");
        return { timestamp: eventTimestamp, source: "JobPosted" };
      } catch {
        throw new Error("job_open_time_unavailable");
      }
    },
    acceptJob: (jobId, options = {}) => execute(contract, MARKETPLACE_ABI, "acceptJob", [BigInt(jobId)], [{ name: "JobAccepted", args: { jobId: BigInt(jobId), agent: address } }], options.onBroadcast, jobId),
    submitDeliverable: (jobId, uri, options = {}) => execute(contract, MARKETPLACE_ABI, "submitDeliverable", [BigInt(jobId), uri], [{ name: "DeliverableSubmitted", args: { jobId: BigInt(jobId), deliverableURI: uri } }], options.onBroadcast, jobId),
    claimTimeout: (jobId, options = {}) => execute(contract, MARKETPLACE_ABI, "claimTimeout", [BigInt(jobId)], [
      { name: "AgentSlashed", args: { agent: address } },
      { name: "JobExpiredRefunded", args: { jobId: BigInt(jobId) } },
    ], options.onBroadcast, jobId),
    claimApprovalTimeout: (jobId, options = {}) => execute(contract, MARKETPLACE_ABI, "claimTimeout", [BigInt(jobId)], [
      { name: "JobExpiredPaid", args: { jobId: BigInt(jobId), agent: address } },
    ], options.onBroadcast, jobId),
    approveStake: (amount) => execute(usdc, ERC20_ABI, "approve", [contract, BigInt(amount)]),
    registerAgent: (name, skill, fee) => execute(contract, MARKETPLACE_ABI, "registerAgent", [name, skill, BigInt(fee)], [{ name: "AgentRegistered", args: { agent: address, name, skill, fee: BigInt(fee) } }]),
  };
}

function withTransactionStage(error, transactionStage, transactionHash) {
  const staged = error instanceof Error ? error : new Error(String(error || "transaction_failed"));
  staged.transactionStage = transactionStage;
  if (transactionHash) staged.transactionHash = transactionHash;
  return staged;
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

function positiveTimestamp(value) {
  try {
    const timestamp = BigInt(value);
    return timestamp > 0n ? timestamp : null;
  } catch {
    return null;
  }
}
