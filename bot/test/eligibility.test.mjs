import assert from "node:assert/strict";
import test from "node:test";

import {
  GAS_RESERVE_WEI,
  URL_SUMMARY_CATEGORY,
  hasGasReserve,
  parseEligibleJob,
} from "../src/eligibility.mjs";

const validDescription = JSON.stringify({
  schemaVersion: 1,
  task: "url_summary",
  sourceUrl: "https://example.com/article",
  language: "en",
  maxWords: 400,
});
const job = (overrides = {}) => ({
  id: 7n,
  category: URL_SUMMARY_CATEGORY,
  description: validDescription,
  reward: 5_000000n,
  status: 0,
  ...overrides,
});

test("accepts only the exact url-summary-v1 schema and bounded reward", () => {
  assert.deepEqual(parseEligibleJob(job()), {
    ok: true,
    request: {
      schemaVersion: 1,
      task: "url_summary",
      sourceUrl: "https://example.com/article",
      language: "en",
      maxWords: 400,
    },
  });
  assert.equal(parseEligibleJob(job({ category: "research" })).reason, "unsupported_category");
  assert.equal(parseEligibleJob(job({ reward: 4_999999n })).reason, "reward_out_of_range");
  assert.equal(parseEligibleJob(job({ reward: 20_000001n })).reason, "reward_out_of_range");
  assert.equal(parseEligibleJob(job({ reward: "5000000" })).reason, "reward_out_of_range");
  assert.equal(parseEligibleJob(job({ status: "0" })).reason, "job_not_open");
});

test("rejects malformed JSON, unknown fields, and every schema boundary", () => {
  const cases = [
    ["{", "invalid_json"],
    [{ schemaVersion: 1, task: "url_summary", sourceUrl: "https://example.com", language: "en", maxWords: 400, extra: true }, "schema_fields_mismatch"],
    [{ schemaVersion: 2, task: "url_summary", sourceUrl: "https://example.com", language: "en", maxWords: 400 }, "unsupported_schema"],
    [{ schemaVersion: 1, task: "browse", sourceUrl: "https://example.com", language: "en", maxWords: 400 }, "unsupported_task"],
    [{ schemaVersion: 1, task: "url_summary", sourceUrl: "http://example.com", language: "en", maxWords: 400 }, "unsafe_url"],
    [{ schemaVersion: 1, task: "url_summary", sourceUrl: "https://u:p@example.com", language: "en", maxWords: 400 }, "unsafe_url"],
    [{ schemaVersion: 1, task: "url_summary", sourceUrl: "https://example.com:8443", language: "en", maxWords: 400 }, "unsafe_url"],
    [{ schemaVersion: 1, task: "url_summary", sourceUrl: "https://example.com", language: "fr", maxWords: 400 }, "unsupported_language"],
    [{ schemaVersion: 1, task: "url_summary", sourceUrl: "https://example.com", language: "en", maxWords: 149 }, "max_words_out_of_range"],
    [{ schemaVersion: 1, task: "url_summary", sourceUrl: "https://example.com", language: "en", maxWords: 601 }, "max_words_out_of_range"],
  ];
  for (const [description, reason] of cases) {
    const encoded = typeof description === "string" ? description : JSON.stringify(description);
    assert.equal(parseEligibleJob(job({ description: encoded })).reason, reason, reason);
  }
});

test("rejects duplicate top-level JSON fields instead of last-value-wins parsing", () => {
  const duplicate = '{"schemaVersion":1,"task":"url_summary","sourceUrl":"https://safe.example","sourceUrl":"https://other.example","language":"en","maxWords":400}';
  assert.equal(parseEligibleJob(job({ description: duplicate })).reason, "duplicate_json_field");
});

test("0.02 native USDC gas guard is inclusive and executable", () => {
  assert.equal(GAS_RESERVE_WEI, 20_000_000_000_000_000n);
  assert.equal(hasGasReserve(GAS_RESERVE_WEI - 1n), false);
  assert.equal(hasGasReserve(GAS_RESERVE_WEI), true);
  assert.equal(hasGasReserve(GAS_RESERVE_WEI + 1n), true);
});
