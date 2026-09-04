import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { createLiveChain } from "./chain.mjs";
import { GAS_RESERVE_WEI } from "./eligibility.mjs";
import { loadConfig } from "./config.mjs";
import { createJobPreparer } from "./prepare.mjs";
import { runCycle } from "./runtime.mjs";
import { createOpenAICompatibleSummarizer } from "./summarizer.mjs";
import { createFileState } from "./state.mjs";

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath) && typeof process.loadEnvFile === "function") process.loadEnvFile(envPath);
if (process.env.BOT_MODE === "register") {
  await import("./register.mjs");
  process.exit(0);
}
const config = loadConfig(process.env, { root: process.cwd() });
const chain = createLiveChain(config);
await chain.assertChain();
const state = createFileState(config.stateFile);
const summarize = createOpenAICompatibleSummarizer({ apiKey: config.summaryApiKey, endpoint: config.summaryApiUrl, model: config.summaryModel });
const prepareJob = createJobPreparer({ summarize, pinataJwt: config.pinataJwt, gatewayBase: config.pinataGatewayBase });
const once = process.argv.includes("--once");
let stopping = false;
let health = { started: true, address: chain.address, writeEnabled: config.writeEnabled, lastCycle: null, lastError: null };

if (config.port) createHealthServer(config.port);
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

log({ type: "bot_started", address: chain.address, contract: chain.contractAddress, writeEnabled: config.writeEnabled, pollIntervalMs: config.pollIntervalMs });
do {
  try {
    if (!config.writeEnabled) {
      const [agent, nativeBalance, jobs] = await Promise.all([chain.getAgent(), chain.getNativeBalance(), chain.listJobs()]);
      health.lastCycle = { action: "read_only", registered: agent.registered, nativeBalance: String(nativeBalance), visibleJobs: jobs.length };
    } else {
      health.lastCycle = await runCycle({ chain, state, prepareJob });
    }
    const [readinessAgent, readinessNative, readinessUsdc] = await Promise.all([chain.getAgent(), chain.getNativeBalance(), chain.getUsdcBalance()]);
    health.readiness = {
      registered: readinessAgent.registered,
      activeJobs: String(readinessAgent.activeJobs),
      nativeBalance: String(readinessNative),
      usdcBalance: String(readinessUsdc),
      gasGuardSatisfied: readinessNative >= GAS_RESERVE_WEI,
      readyForNewJob: config.writeEnabled && readinessAgent.registered && readinessAgent.activeJobs === 0n && readinessNative >= GAS_RESERVE_WEI && !["halted", "halted_after_slash", "registration_lost_halt"].includes(health.lastCycle.action),
    };
    health.lastError = null;
    log({ type: "cycle_complete", ...health.lastCycle });
    if (["halted", "halted_after_slash", "registration_lost_halt"].includes(health.lastCycle.action)) stopping = true;
  } catch (error) {
    health.lastError = safeError(error);
    log({ type: "cycle_failed", error: health.lastError }, true);
    if (once) process.exitCode = 1;
  }
  if (!once && !stopping) await sleep(config.pollIntervalMs);
} while (!once && !stopping);

function createHealthServer(port) {
  const server = createServer((request, response) => {
    if (request.url !== "/healthz") { response.writeHead(404).end(); return; }
    response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    response.end(JSON.stringify(health));
  });
  server.listen(port, "0.0.0.0");
  server.unref();
}

function log(value, error = false) {
  const line = JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item);
  (error ? console.error : console.log)(line);
}

function safeError(error) {
  return String(error?.code || error?.shortMessage || error?.message || "unknown_error").replace(/https?:\/\/\S+/g, "[URL_REDACTED]").slice(0, 300);
}

function sleep(ms) { return new Promise((resolveSleep) => setTimeout(resolveSleep, ms)); }
