import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { parseEligibleJob } from "../../bot/src/eligibility.mjs";
import { buildUrlSummaryDescription } from "../lib/url-summary-job.mjs";
import { classifyJobExecutability } from "../lib/job-executability.mjs";

const validDescription = buildUrlSummaryDescription({
  sourceUrl: "https://example.com/article",
  language: "en",
  maxWords: 250,
});
const job = (override = {}) => ({
  id: 1n,
  status: 0,
  category: "url-summary-v1",
  reward: 5_000000n,
  description: validDescription,
  ...override,
});

test("UI static classification conforms to the bot eligibility boundary", () => {
  const rows = [
    [job({ status: 1 }), "job_not_open", "hidden"],
    [job({ category: "Research" }), "unsupported_category", "byo"],
    [job({ reward: 4_999999n }), "reward_out_of_range", "invalid"],
    [job({ reward: 20_000001n }), "reward_out_of_range", "invalid"],
    [job({ description: "not-json" }), "invalid_json", "invalid"],
    [job({ description: JSON.stringify({ schemaVersion: 2 }) }), "schema_fields_mismatch", "invalid"],
  ];
  for (const [candidate, reason, state] of rows) {
    assert.deepEqual(parseEligibleJob(candidate), { ok: false, reason });
    const actual = classifyJobExecutability(candidate);
    assert.equal(actual.reasonCode, reason);
    assert.equal(actual.state, state);
  }

  assert.equal(parseEligibleJob(job()).ok, true);
  assert.equal(classifyJobExecutability(job()).state, "checking");
  assert.equal(classifyJobExecutability(job(), { ok: true }).state, "compatible");
});

test("live-pattern failures are explicit and block acceptance", () => {
  const deadUrl = classifyJobExecutability(job(), { reason: "dns_error", retryable: true });
  assert.equal(deadUrl.state, "invalid");
  assert.equal(deadUrl.canAccept, false);
  assert.match(deadUrl.reason, /could not be resolved/i);
  assert.match(deadUrl.reason, /Retry/);

  const unsupported = classifyJobExecutability(job({ category: "Research", reward: 100_000000n }));
  assert.equal(unsupported.state, "byo");
  assert.equal(unsupported.canAccept, true);
  assert.match(unsupported.reason, /external agent/);

  const malformed = classifyJobExecutability(job({ description: "{}" }));
  assert.equal(malformed.state, "invalid");
  assert.equal(malformed.canAccept, false);

  const unavailable = classifyJobExecutability(job(), { state: "unavailable" });
  assert.equal(unavailable.state, "unavailable");
  assert.equal(unavailable.canAccept, false);
});

test("job cards render the classification before a guarded accept action", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");
  const component = await readFile(new URL("../app/components/job-executability.js", import.meta.url), "utf8");
  const badge = page.indexOf("<JobExecutability classification={executability} />");
  const button = page.indexOf("!executability.canAccept");
  assert.ok(badge > 0 && button > badge);
  assert.match(page, /disabled={!executability\.canAccept/);
  assert.match(page, /Bring your own agent|Job cannot be accepted/);
  assert.match(component, /\/api\/source-preflight/);
  assert.match(component, /AbortController/);
  assert.doesNotMatch(component, /response\.statusText|error\.message/);
});
