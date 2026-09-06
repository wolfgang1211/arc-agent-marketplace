import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createLiveChain } from "./chain.mjs";
import { loadConfig } from "./config.mjs";
import { createOpenAICompatibleSummarizer } from "./summarizer.mjs";

export async function checkSummaryCredential(config, fetchImpl = fetch) {
  const summarize = createOpenAICompatibleSummarizer({
    apiKey: config.summaryApiKey,
    endpoint: config.summaryApiUrl,
    model: config.summaryModel,
    fetchImpl,
  });
  const result = await summarize({
    source: {
      title: "Credential preflight",
      finalUrl: "https://example.com/credential-preflight",
      text: "This is a credential preflight for a bounded URL summarization worker. The check must return a short grounded summary and must not perform any external action.",
    },
    language: "en",
    maxWords: 150,
  });
  return Boolean(result.summary && result.keyPoints.length);
}

export async function checkPinataCredential(jwt, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl("https://api.pinata.cloud/data/testAuthentication", {
      headers: { Authorization: `Bearer ${jwt}`, Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error("pinata_auth_unavailable");
  }
  if (!response.ok) throw new Error(`pinata_auth_http_${Number(response.status) || "error"}`);
  return true;
}

async function main() {
  const envPath = resolve(process.cwd(), ".env");
  if (existsSync(envPath) && typeof process.loadEnvFile === "function") process.loadEnvFile(envPath);
  const config = loadConfig(process.env, { root: process.cwd() });
  const chain = createLiveChain(config);
  const [chainId, agent, nativeBalance, usdcBalance, summaryCredential, pinataCredential] = await Promise.all([
    chain.assertChain(),
    chain.getAgent(),
    chain.getNativeBalance(),
    chain.getUsdcBalance(),
    checkSummaryCredential(config),
    checkPinataCredential(config.pinataJwt),
  ]);
  console.log(JSON.stringify({
    preflight: "passed",
    chainId,
    address: chain.address,
    registered: agent.registered,
    activeJobs: agent.activeJobs.toString(),
    nativeBalance: nativeBalance.toString(),
    usdcBalance: usdcBalance.toString(),
    summaryCredential,
    pinataCredential,
    gatewayConfigured: Boolean(config.pinataGatewayBase),
    writeEnabled: config.writeEnabled,
    sideEffects: { deployment: false, chainWrite: false, pinUpload: false },
  }));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1"))) {
  main().catch((error) => {
    console.error(JSON.stringify({ preflight: "failed", error: safeError(error) }));
    process.exitCode = 1;
  });
}

function safeError(error) {
  return String(error?.code || error?.shortMessage || error?.message || "unknown_error")
    .replace(/https?:\/\/\S+/g, "[URL_REDACTED]")
    .slice(0, 200);
}
