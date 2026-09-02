import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { GAS_RESERVE_WEI } from "./eligibility.mjs";
import { createLiveChain } from "./chain.mjs";
import { loadConfig } from "./config.mjs";

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath) && typeof process.loadEnvFile === "function") process.loadEnvFile(envPath);
const config = loadConfig(process.env, { requireSecrets: false, root: process.cwd() });
if (!config.writeEnabled) throw new Error("BOT_LIVE_WRITES=true is required for explicit registration");
const chain = createLiveChain(config);
await chain.assertChain();
const before = await balances(chain);
const existing = await chain.getAgent();
if (existing.registered) {
  print({ status: "already_registered", address: chain.address, balances: before, stake: existing.stake });
  process.exit(0);
}
const stake = await chain.getAgentStake();
if (before.usdc < stake) throw new Error("insufficient_usdc_for_stake");
if (before.native < GAS_RESERVE_WEI) throw new Error("native_gas_below_0.02_USDC_guard");

let approveTxHash = null;
const allowance = await chain.getAllowance();
if (allowance < stake) approveTxHash = (await chain.approveStake(stake)).hash;
const registerTxHash = (await chain.registerAgent(config.agentName, config.agentSkill, config.agentFee)).hash;
const [registered, after] = await Promise.all([chain.getAgent(), balances(chain)]);
if (!registered.registered || registered.stake !== stake) throw new Error("registration_state_mismatch");
print({ status: "registered", address: chain.address, stake, approveTxHash, registerTxHash, before, after });

async function balances(target) {
  const [native, usdc] = await Promise.all([target.getNativeBalance(), target.getUsdcBalance()]);
  return { native, usdc };
}
function print(value) { console.log(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item)); }
