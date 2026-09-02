import { resolve } from "node:path";
import { getAddress } from "viem";

export const DEFAULT_CONTRACT = "0xFc7dE289e02FCFB4268AE8f0e49991D2Eafe5C87";
export const DEFAULT_USDC = "0x3600000000000000000000000000000000000000";

export function loadConfig(env = process.env, { requireSecrets = true, root = process.cwd() } = {}) {
  const config = {
    rpcUrl: httpsUrl(env.ARC_RPC_URL || "https://rpc.testnet.arc.network", "ARC_RPC_URL"),
    contractAddress: getAddress(env.CONTRACT_ADDRESS || DEFAULT_CONTRACT),
    usdcAddress: getAddress(env.USDC_ADDRESS || DEFAULT_USDC),
    privateKey: env.BOT_PRIVATE_KEY || "",
    writeEnabled: env.BOT_LIVE_WRITES === "true",
    pollIntervalMs: boundedInteger(env.POLL_INTERVAL_MS, 8_000, 1_000, 300_000, "POLL_INTERVAL_MS"),
    stateFile: resolve(root, env.BOT_STATE_FILE || "data/state.json"),
    summaryApiUrl: env.SUMMARY_API_URL || "",
    summaryApiKey: env.SUMMARY_API_KEY || "",
    summaryModel: env.SUMMARY_MODEL || "",
    pinataJwt: env.PINATA_JWT || "",
    pinataGatewayBase: env.PINATA_GATEWAY_BASE || "",
    agentName: env.BOT_AGENT_NAME || "Arc URL Summarizer",
    agentSkill: "url-summary-v1",
    agentFee: 5_000000n,
    port: optionalPort(env.PORT),
  };
  if (requireSecrets) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(config.privateKey)) throw new Error("BOT_PRIVATE_KEY is required and must be a 32-byte hex key");
    config.summaryApiUrl = httpsUrl(config.summaryApiUrl, "SUMMARY_API_URL");
    if (!config.summaryApiKey) throw new Error("SUMMARY_API_KEY is required");
    if (!config.summaryModel) throw new Error("SUMMARY_MODEL is required");
    if (!config.pinataJwt) throw new Error("PINATA_JWT is required");
    config.pinataGatewayBase = httpsUrl(config.pinataGatewayBase, "PINATA_GATEWAY_BASE").replace(/\/$/, "");
  }
  return config;
}

function httpsUrl(value, name) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error();
    return url.toString();
  } catch {
    throw new Error(`${name} must be an HTTPS URL without credentials`);
  }
}

function boundedInteger(raw, fallback, minimum, maximum, name) {
  const value = raw == null || raw === "" ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  return value;
}

function optionalPort(raw) {
  if (raw == null || raw === "") return null;
  return boundedInteger(raw, 0, 1, 65_535, "PORT");
}
