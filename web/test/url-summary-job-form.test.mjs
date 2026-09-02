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

test("URL summary reward guard accepts only the bot's fixed 5–20 USDC range", () => {
  for (const value of [5, "5", 12.5, 20, "20"]) assert.equal(validateUrlSummaryReward(value), true);
  for (const value of ["", 0, 4.999999, 20.000001, 21, "not-a-number"]) assert.equal(validateUrlSummaryReward(value), false);
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
