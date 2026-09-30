import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { computeBuildFingerprint } from "../src/build-identity.mjs";

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
  assert.equal(config.houseDelaySeconds, 14_400);
  assert.equal(config.pilotJobId, null);
  assert.equal(config.pilotScopeValid, false);
  assert.equal(config.pilotScopeReason, "pilot_job_id_missing");
  assert.equal(loadConfig({ ...secrets, BOT_LIVE_WRITES: "true" }, { root: "C:/tmp" }).writeEnabled, true);
});

test("pilot job scope is canonical uint256 and invalid live scope remains observable", () => {
  const valid = loadConfig({ ...secrets, BOT_LIVE_WRITES: "true", BOT_PILOT_JOB_ID: "7" }, { root: "C:/tmp" });
  assert.equal(valid.pilotJobId, 7n);
  assert.equal(valid.pilotScopeValid, true);
  assert.equal(valid.pilotScopeReason, null);

  for (const value of ["", "0", "01", "-1", "1.0", "nope", (2n ** 256n).toString()]) {
    const invalid = loadConfig({ ...secrets, BOT_LIVE_WRITES: "true", BOT_PILOT_JOB_ID: value }, { root: "C:/tmp" });
    assert.equal(invalid.pilotJobId, null, value);
    assert.equal(invalid.pilotScopeValid, false, value);
    assert.match(invalid.pilotScopeReason, /^pilot_job_id_(missing|invalid)$/);
  }
});

test("build SHA is normalized for deployment log attestation", () => {
  const sha = "A".repeat(40);
  assert.equal(loadConfig({ ...secrets, BOT_BUILD_SHA: sha }, { root: "C:/tmp" }).buildSha, sha.toLowerCase());
  assert.equal(loadConfig(secrets, { root: "C:/tmp" }).buildSha, "unavailable");
  assert.equal(loadConfig({ ...secrets, BOT_BUILD_SHA: "not-a-sha" }, { root: "C:/tmp" }).buildSha, "unavailable");
  const startupSource = readFileSync(new URL("../src/index.mjs", import.meta.url), "utf8");
  assert.match(startupSource, /type: "bot_started", buildSha: config\.buildSha/);
  assert.match(startupSource, /let health = \{ started: true, address: chain\.address, writeEnabled: config\.writeEnabled, buildSha: config\.buildSha/);
  assert.match(startupSource, /pilotJobId: config\.pilotJobId == null \? null : String\(config\.pilotJobId\)/);
});

test("runtime build fingerprint is deterministic and source-derived", () => {
  const root = mkdtempSync(join(tmpdir(), "arc-bot-build-"));
  try {
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "package.json"), "{}\n");
    writeFileSync(join(root, "package-lock.json"), "{}\n");
    writeFileSync(join(root, "src", "worker.mjs"), "export const value = 1;\n");
    const first = computeBuildFingerprint(root);
    assert.match(first, /^[0-9a-f]{64}$/);
    assert.equal(computeBuildFingerprint(root), first);
    writeFileSync(join(root, "src", "worker.mjs"), "export const value = 2;\n");
    assert.notEqual(computeBuildFingerprint(root), first);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("registration, runtime logging, and status preserve the pilot fail-closed boundary", () => {
  const registerSource = readFileSync(new URL("../src/register.mjs", import.meta.url), "utf8");
  const indexSource = readFileSync(new URL("../src/index.mjs", import.meta.url), "utf8");
  const statusSource = readFileSync(new URL("../src/status.mjs", import.meta.url), "utf8");
  assert.match(registerSource, /type: "operator_alert", action: "pilot_scope_invalid"/);
  const alertIndex = indexSource.indexOf('if (health.lastCycle.alert === true) log({ type: "operator_alert"');
  const readinessIndex = indexSource.indexOf("const [readinessAgent, readinessNative, readinessUsdc]");
  const successIndex = indexSource.indexOf('if (health.lastCycle.alert !== true) log({ type: "cycle_complete"');
  assert.ok(alertIndex >= 0 && alertIndex < readinessIndex);
  assert.ok(readinessIndex >= 0 && readinessIndex < successIndex);
  assert.match(indexSource, /health\.readiness = \{ readyForNewJob: false, reason: "readiness_unavailable" \}/);
  assert.match(statusSource, /readyForNewJob: config\.writeEnabled && config\.pilotScopeValid/);
  assert.match(statusSource, /pilotScopeReason: config\.pilotScopeReason/);
  assert.match(statusSource, /buildFingerprint,/);
});

test("house delay defaults to four hours and accepts only bounded integer seconds", () => {
  assert.equal(loadConfig(secrets, { root: "C:/tmp" }).houseDelaySeconds, 14_400);
  assert.equal(loadConfig({ ...secrets, HOUSE_DELAY_SECONDS: "0" }, { root: "C:/tmp" }).houseDelaySeconds, 0);
  assert.equal(loadConfig({ ...secrets, HOUSE_DELAY_SECONDS: "86400" }, { root: "C:/tmp" }).houseDelaySeconds, 86_400);
  for (const value of ["-1", "86401", "1.5", "nope"]) {
    assert.throws(() => loadConfig({ ...secrets, HOUSE_DELAY_SECONDS: value }, { root: "C:/tmp" }), /HOUSE_DELAY_SECONDS must be an integer between 0 and 86400/);
  }
});

test("rejects credential-bearing or non-HTTPS provider URLs", () => {
  assert.throws(() => loadConfig({ ...secrets, SUMMARY_API_URL: "http://api.example.test" }, { root: "C:/tmp" }), /SUMMARY_API_URL/);
  assert.throws(() => loadConfig({ ...secrets, PINATA_GATEWAY_BASE: "https://u:p@gateway.example.test" }, { root: "C:/tmp" }), /PINATA_GATEWAY_BASE/);
});
