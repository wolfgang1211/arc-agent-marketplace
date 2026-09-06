import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  URL_SUMMARY_CATEGORY,
  buildUrlSummaryDescription,
  validateUrlSummaryReward,
  validateUrlSummaryRequest,
} from "../lib/url-summary-job.mjs";

const page = fs.readFileSync(new URL("../app/page.js", import.meta.url), "utf8");

test("URL summary form produces the exact strict bot schema without asking users for JSON", () => {
  assert.equal(URL_SUMMARY_CATEGORY, "url-summary-v1");
  assert.equal(
    buildUrlSummaryDescription({
      sourceUrl: "https://example.com/article",
      language: "en",
      maxWords: "400",
    }),
    '{"schemaVersion":1,"task":"url_summary","sourceUrl":"https://example.com/article","language":"en","maxWords":400}',
  );
});

test("URL summary form rejects invalid public inputs before wallet actions", () => {
  const cases = [
    [{ sourceUrl: "http://example.com", language: "en", maxWords: 400 }, "URL must use HTTPS."],
    [{ sourceUrl: "https://user:pass@example.com", language: "en", maxWords: 400 }, "URL cannot include credentials."],
    [{ sourceUrl: "https://example.com:8443", language: "en", maxWords: 400 }, "URL must use port 443."],
    [{ sourceUrl: "https://example.com", language: "fr", maxWords: 400 }, "Language must be English or Turkish."],
    [{ sourceUrl: "https://example.com", language: "en", maxWords: 149 }, "Maximum words must be between 150 and 600."],
    [{ sourceUrl: "https://example.com", language: "en", maxWords: 601 }, "Maximum words must be between 150 and 600."],
    [{ sourceUrl: "https://example.com", language: "en", maxWords: 400.5 }, "Maximum words must be a whole number."],
  ];

  for (const [request, error] of cases) {
    assert.deepEqual(validateUrlSummaryRequest(request), { valid: false, error });
  }
});

test("URL summary reward guard accepts only values viem can encode exactly", () => {
  for (const value of [5, "5", 12.5, "12.500001", 20, "20.000000"]) assert.equal(validateUrlSummaryReward(value), true);
  for (const value of ["", 0, 4.999999, 20.000001, 21, "not-a-number", "5e0", "5.0000001", "05"]) {
    assert.equal(validateUrlSummaryReward(value), false);
  }
});

test("URL summary form rejects literal local and private network sources before escrow", () => {
  for (const sourceUrl of [
    "https://localhost/article",
    "https://api.localhost/article",
    "https://127.0.0.1/article",
    "https://10.0.0.8/article",
    "https://172.16.0.1/article",
    "https://192.168.1.1/article",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/article",
  ]) {
    assert.deepEqual(
      validateUrlSummaryRequest({ sourceUrl, language: "en", maxWords: 400 }),
      { valid: false, error: "URL must use a public hostname." },
    );
  }
});

test("walletless visitors get human-readable URL summary fields and never see a JSON editor", () => {
  for (const copy of [
    "URL summary",
    "Source URL",
    "Summary language",
    "Maximum words",
    "No JSON required",
    "Connect wallet to post a job",
  ]) {
    assert.match(page, new RegExp(copy));
  }
  assert.doesNotMatch(page, /JSON payload|JSON editor/);
  assert.match(page, /buildUrlSummaryDescription/);
  assert.match(page, /URL_SUMMARY_CATEGORY/);
});

test("URL summary posting warns that the bot may decline and names the open-job refund path", () => {
  const copy = "The bot may decline the job after checking the source; an unaccepted job remains open, and the job owner can cancel it to reclaim the escrowed reward.";
  assert.match(page, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(page, /bot-decline-note[\s\S]*Connect wallet to post a job/);
  assert.doesNotMatch(page, /someone (will )?(review|inspect)/i);
});

test("first render defaults to the bot-compatible URL summary form and keeps Other job honest", () => {
  const warning = "No registered agent currently accepts this job type, so it may remain open.";
  assert.match(page, /useState\(URL_SUMMARY_CATEGORY\)/);
  assert.match(page, />Other job<\/button>/);
  assert.match(page, new RegExp(warning.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(page, /categoryMode === "custom"[\s\S]*other-job-warning/);
});
