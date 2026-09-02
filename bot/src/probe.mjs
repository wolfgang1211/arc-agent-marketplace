import { createPublicClient, http } from "viem";
import { ARC_TESTNET } from "./chain.mjs";
import { DEFAULT_CONTRACT, DEFAULT_USDC, loadConfig } from "./config.mjs";
import { MARKETPLACE_ABI } from "./abi.mjs";

const config = loadConfig({
  ARC_RPC_URL: process.env.ARC_RPC_URL,
  CONTRACT_ADDRESS: process.env.CONTRACT_ADDRESS || DEFAULT_CONTRACT,
  USDC_ADDRESS: process.env.USDC_ADDRESS || DEFAULT_USDC,
}, { requireSecrets: false, root: process.cwd() });
const client = createPublicClient({ chain: ARC_TESTNET, transport: http(config.rpcUrl, { timeout: 15_000, retryCount: 3 }) });
const [chainId, contractCode, usdcCode, stake, jobCount] = await Promise.all([
  client.getChainId(),
  client.getBytecode({ address: config.contractAddress }),
  client.getBytecode({ address: config.usdcAddress }),
  client.readContract({ address: config.contractAddress, abi: MARKETPLACE_ABI, functionName: "AGENT_STAKE" }),
  client.readContract({ address: config.contractAddress, abi: MARKETPLACE_ABI, functionName: "jobCount" }),
]);
if (chainId !== ARC_TESTNET.id) throw new Error(`wrong_chain_id_${chainId}`);
if (!contractCode || contractCode === "0x") throw new Error("marketplace_code_missing");
if (!usdcCode || usdcCode === "0x") throw new Error("usdc_code_missing");
console.log(JSON.stringify({
  chainId,
  contract: config.contractAddress,
  contractCodeBytes: (contractCode.length - 2) / 2,
  usdc: config.usdcAddress,
  usdcCodeBytes: (usdcCode.length - 2) / 2,
  agentStake: stake.toString(),
  jobCount: jobCount.toString(),
}));
