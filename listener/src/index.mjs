import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createPublicClient, getAddress, http } from "viem";
import { createNotificationChannel } from "./channels.mjs";
import { processEventRange } from "./listener.mjs";
import { createFileState } from "./state.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const ENV_PATH = resolve(ROOT, ".env");
if (existsSync(ENV_PATH) && typeof process.loadEnvFile === "function") process.loadEnvFile(ENV_PATH);

const config = loadConfig(process.env);
const client = createPublicClient({
  transport: http(config.rpcUrl, {
    timeout: 15_000,
    retryCount: 5,
    retryDelay: 1_500,
  }),
});
const channel = createNotificationChannel({
  discordWebhookUrl: config.discordWebhookUrl,
  telegramBotToken: config.telegramBotToken,
  telegramChatId: config.telegramChatId,
  stdoutEnabled: config.stdoutEnabled,
});
const state = createFileState(config.stateFile);
const once = process.argv.includes("--once");
let stopping = false;

process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

console.log(JSON.stringify({
  type: "listener_started",
  contract: config.contractAddress,
  channel: channel.name,
  confirmations: config.confirmations.toString(),
  pollIntervalMs: config.pollIntervalMs,
}));

await initializeCursor();
do {
  try {
    const result = await pollOnce();
    console.log(JSON.stringify({ type: "poll_complete", ...result }));
  } catch (error) {
    console.error(JSON.stringify({ type: "poll_failed", message: safeError(error) }));
    if (once) process.exitCode = 1;
  }
  if (!once && !stopping) await sleep(config.pollIntervalMs);
} while (!once && !stopping);

async function initializeCursor() {
  if (await state.load()) return;
  if (config.startBlock !== null) {
    await state.save({ blockNumber: config.startBlock.toString(), logIndex: -1, transactionHash: null });
    return;
  }
  const latest = await client.getBlockNumber();
  await state.save({ blockNumber: latest.toString(), logIndex: Number.MAX_SAFE_INTEGER, transactionHash: null });
  console.log(JSON.stringify({ type: "cursor_initialized", blockNumber: latest.toString(), replay: false }));
}

async function pollOnce() {
  const latest = await client.getBlockNumber();
  const safeHead = latest > config.confirmations ? latest - config.confirmations : 0n;
  let cursor = await state.load();
  let fromBlock = BigInt(cursor.blockNumber);
  let delivered = 0;

  while (fromBlock <= safeHead) {
    const candidate = fromBlock + config.blockChunkSize - 1n;
    const toBlock = candidate < safeHead ? candidate : safeHead;
    const result = await processEventRange({
      client,
      channel,
      state,
      contractAddress: config.contractAddress,
      fromBlock,
      toBlock,
    });
    delivered += result.delivered;
    fromBlock = toBlock + 1n;
    cursor = await state.load();
    if (stopping) break;
  }

  return { latest: latest.toString(), safeHead: safeHead.toString(), cursor: cursor.blockNumber, delivered };
}

function loadConfig(env) {
  const rpcUrl = env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
  const contractAddress = getAddress(env.CONTRACT_ADDRESS || "0xFc7dE289e02FCFB4268AE8f0e49991D2Eafe5C87");
  return {
    rpcUrl,
    contractAddress,
    discordWebhookUrl: env.DISCORD_WEBHOOK_URL || "",
    telegramBotToken: env.TELEGRAM_BOT_TOKEN || "",
    telegramChatId: env.TELEGRAM_CHAT_ID || "",
    stdoutEnabled: env.LISTENER_STDOUT === "true",
    pollIntervalMs: boundedInteger(env.POLL_INTERVAL_MS, 8_000, 1_000, 300_000, "POLL_INTERVAL_MS"),
    confirmations: BigInt(boundedInteger(env.CONFIRMATIONS, 2, 0, 100, "CONFIRMATIONS")),
    blockChunkSize: BigInt(boundedInteger(env.BLOCK_CHUNK_SIZE, 500, 1, 5_000, "BLOCK_CHUNK_SIZE")),
    startBlock: env.LISTENER_START_BLOCK ? BigInt(env.LISTENER_START_BLOCK) : null,
    stateFile: resolve(ROOT, env.LISTENER_STATE_FILE || "data/state.json"),
  };
}

function boundedInteger(raw, fallback, minimum, maximum, name) {
  const value = raw == null || raw === "" ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function safeError(error) {
  return String(error?.shortMessage || error?.message || "Unknown error").replace(/https?:\/\/\S+/g, "[URL REDACTED]").slice(0, 500);
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
