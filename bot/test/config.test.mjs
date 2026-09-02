import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_CONTRACT, loadConfig } from "../src/config.mjs";

const secrets = {
  BOT_PRIVATE_KEY: "0x" + "1".repeat(64),
  SUMMARY_API_URL: "https://api.example.test/v1/chat/completions",
  SUMMARY_API_KEY: "summary-secret",
  SUMMARY_MODEL: "test-model",
  PINATA_JWT: "pinata-secret",
  PINATA_GATEWAY_BASE: "https://gateway.example.test",
};

test("config is fail-closed for secrets and live writes are explicit", () => {
  assert.throws(() => loadConfig({}, { root: "C:/tmp" }), /BOT_PRIVATE_KEY/);
  const config = loadConfig(secrets, { root: "C:/tmp" });
  assert.equal(config.writeEnabled, false);
  assert.equal(config.contractAddress, DEFAULT_CONTRACT);
  assert.match(config.stateFile.replaceAll("\\", "/"), /C:\/tmp\/data\/state\.json$/i);
  assert.equal(config.agentSkill, "url-summary-v1");
  assert.equal(config.agentFee, 5_000000n);
  assert.equal(loadConfig({ ...secrets, BOT_LIVE_WRITES: "true" }, { root: "C:/tmp" }).writeEnabled, true);
});

test("rejects credential-bearing or non-HTTPS provider URLs", () => {
  assert.throws(() => loadConfig({ ...secrets, SUMMARY_API_URL: "http://api.example.test" }, { root: "C:/tmp" }), /SUMMARY_API_URL/);
  assert.throws(() => loadConfig({ ...secrets, PINATA_GATEWAY_BASE: "https://u:p@gateway.example.test" }, { root: "C:/tmp" }), /PINATA_GATEWAY_BASE/);
});
