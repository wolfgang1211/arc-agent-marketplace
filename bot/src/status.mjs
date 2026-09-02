import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createLiveChain } from "./chain.mjs";
import { GAS_RESERVE_WEI } from "./eligibility.mjs";
import { loadConfig } from "./config.mjs";

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath) && typeof process.loadEnvFile === "function") process.loadEnvFile(envPath);
const config = loadConfig(process.env, { requireSecrets: false, root: process.cwd() });
const chain = createLiveChain(config);
await chain.assertChain();
const [nativeBalance, usdcBalance, agent, visibleJobs, chainTimestamp] = await Promise.all([
  chain.getNativeBalance(), chain.getUsdcBalance(), chain.getAgent(), chain.listJobs(), chain.getChainTimestamp(),
]);
console.log(JSON.stringify({
  address: chain.address,
  contract: chain.contractAddress,
  nativeBalance: nativeBalance.toString(),
  usdcBalance: usdcBalance.toString(),
  registered: agent.registered,
  stake: agent.stake.toString(),
  activeJobs: agent.activeJobs.toString(),
  visibleJobs: visibleJobs.length,
  chainTimestamp: chainTimestamp.toString(),
  gasGuardSatisfied: nativeBalance >= GAS_RESERVE_WEI,
  readyForNewJob: config.writeEnabled && agent.registered && agent.activeJobs === 0n && nativeBalance >= GAS_RESERVE_WEI,
  writeEnabled: config.writeEnabled,
}));
