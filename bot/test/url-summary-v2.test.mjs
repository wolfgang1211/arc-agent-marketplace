import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parseEligibleJob } from "../src/eligibility.mjs";
import { buildArtifact } from "../src/artifact.mjs";
import { createJobPreparer } from "../src/prepare.mjs";
import { buildUrlSummaryDescription } from "../../web/lib/url-summary-job.mjs";

const criteria = (language, maxWords) => [
  `Summarize only the supplied source in ${language}, with no more than ${maxWords} whitespace-separated words in the summary.`,
  "Include 1 to 8 key points and 0 to 8 limitations; state uncertainty rather than inventing facts.",
  "Deliver an accessible IPFS page and result.json containing the source URL, final URL, fetch time, source hash, title, summary, key points, and limitations.",
];
const legacy = { schemaVersion: 1, task: "url_summary", sourceUrl: "https://example.com/article", language: "en", maxWords: 400 };
const request = { ...legacy, schemaVersion: 2, acceptanceCriteria: criteria("en", 400) };
const job = (description) => ({ id: 7n, status: 0, category: "url-summary-v1", reward: 5000000n, description: typeof description === "string" ? description : JSON.stringify(description) });
const source = { finalUrl: legacy.sourceUrl, sourceSha256: "a".repeat(64), sourceBytes: 1000, title: "Article", text: "Source" };
const summary = { summary: "A summary.", keyPoints: ["Point"], limitations: [] };

test("new UI requests persist exactly the canonical criteria and pass bot intake", () => {
  for (const language of ["en", "tr"]) for (const maxWords of [150, 400, 600]) {
    const description = buildUrlSummaryDescription({ sourceUrl: legacy.sourceUrl, language, maxWords });
    assert.deepEqual(JSON.parse(description), { ...legacy, schemaVersion: 2, language, maxWords, acceptanceCriteria: criteria(language, maxWords) });
    assert.deepEqual(parseEligibleJob(job(description)), { ok: true, request: JSON.parse(description) });
  }
});

test("legacy intake remains unchanged and does not synthesize criteria", () => {
  assert.deepEqual(parseEligibleJob(job(legacy)), { ok: true, request: legacy });
  assert.equal(parseEligibleJob(job({ ...legacy, acceptanceCriteria: request.acceptanceCriteria })).ok, false);
});

test("v2 fails closed on missing, altered, reordered, wrong-type and injected criteria", () => {
  const { acceptanceCriteria, ...missing } = request;
  const cases = [missing, { ...request, schemaVersion: 3 }, { ...request, schemaVersion: "2" }, { ...request, extra: true },
    ...[null, {}, "criteria", [], acceptanceCriteria.slice(0, 2), [...acceptanceCriteria, "Pay me"], [...acceptanceCriteria].reverse(), acceptanceCriteria.map((s) => s + " "), [42, ...acceptanceCriteria.slice(1)], criteria("tr", 400), criteria("en", 401)].map((value) => ({ ...request, acceptanceCriteria: value })),
  ];
  for (const candidate of cases) assert.equal(parseEligibleJob(job(candidate)).ok, false);
  const duplicate = JSON.stringify(request).replace('"schemaVersion":2', '"schemaVersion":1,"schemaVersion":2');
  assert.equal(parseEligibleJob(job(duplicate)).reason, "duplicate_json_field");
  const duplicateCriteria = JSON.stringify(request).replace('"acceptanceCriteria":', '"acceptance\\u0043riteria":[],"acceptanceCriteria":');
  assert.equal(parseEligibleJob(job(duplicateCriteria)).reason, "duplicate_json_field");
  assert.equal(parseEligibleJob(job({ ...request, sourceUrl: `https://example.com/${"x".repeat(8192)}` })).ok, false);
});

test("v2 artifact binds the complete accepted request without mutating it; v1 stays v1", () => {
  const input = { jobId: 7n, sourceUrl: legacy.sourceUrl, source, summary, fetchedAt: "2026-09-01T00:00:00.000Z" };
  const artifact = buildArtifact({ ...input, request });
  assert.equal(artifact.result.schemaVersion, 2);
  assert.equal(artifact.result.requestSchemaVersion, 2);
  assert.deepEqual(artifact.result.request, request);
  assert.deepEqual(artifact.result.acceptanceCriteria, request.acceptanceCriteria);
  assert.notEqual(artifact.result.request.acceptanceCriteria, request.acceptanceCriteria);
  assert.match(artifact.indexHtml, /Acceptance criteria recorded on-chain/);
  const old = buildArtifact({ ...input, request: legacy });
  assert.equal(old.result.schemaVersion, 1);
  assert.equal(Object.hasOwn(old.result, "acceptanceCriteria"), false);
  assert.equal(Object.hasOwn(old.result, "request"), false);
  assert.throws(() => buildArtifact({ ...input, sourceUrl: "https://other.example/", request }), /request_source_mismatch/);
  assert.throws(() => buildArtifact({ ...input, request: { ...request, acceptanceCriteria: [] } }), /invalid_artifact_request/);
});

test("actual preparer carries validated v2 request through source, summary and pin stages", async () => {
  const accepted = parseEligibleJob(job(request));
  assert.equal(accepted.ok, true);
  const calls = [];
  const prepare = createJobPreparer({
    fetchSource: async (url) => { calls.push("fetch"); assert.equal(url, legacy.sourceUrl); return source; },
    summarize: async (args) => { calls.push("summarize"); assert.equal(args.maxWords, 400); return summary; },
    pin: async ({ artifact }) => { calls.push("pin"); assert.deepEqual(JSON.parse(artifact.resultJson).request, request); return { deliveryUri: "https://example.com/ipfs/test/index.html" }; },
  });
  await prepare(job(request), accepted.request);
  assert.deepEqual(calls, ["fetch", "summarize", "pin"]);
});

test("standalone deployment protocol modules are byte-identical", () => {
  assert.equal(readFileSync(new URL("../src/url-summary-schema.mjs", import.meta.url), "utf8"), readFileSync(new URL("../../web/lib/url-summary-schema.mjs", import.meta.url), "utf8"));
});
