import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { buildUrlSummaryDescription } from "../lib/url-summary-job.mjs";
import { fetchBoundedJson } from "../lib/server/safe-fetch.mjs";
import { createDeliveryPreviewHandler } from "../lib/server/delivery-preview-handler.mjs";
import { DeliveryPreviewError, deriveResultJsonUrl, validateDeliveryArtifact } from "../lib/server/delivery-preview.mjs";

const cid = `b${"a".repeat(30)}`;
const deliveryURI = `https://gateway.example/ipfs/${cid}/index.html`;
const resultUri = `https://gateway.example/ipfs/${cid}/result.json`;
const description = buildUrlSummaryDescription({ sourceUrl: "https://example.com/article", language: "en", maxWords: 250 });
const request = JSON.parse(description);
const job = { id: "7", category: "url-summary-v1", description, deliverableURI: deliveryURI };
const artifact = {
  schemaVersion: 2,
  generatorVersion: "arc-url-summary-agent/2.0.0",
  jobId: "7",
  sourceUrl: request.sourceUrl,
  finalUrl: "https://example.com/article",
  fetchedAt: "2026-09-17T12:00:00.000Z",
  sourceSha256: "a".repeat(64),
  sourceBytes: 1234,
  title: "Bound result",
  language: "en",
  maxWords: 250,
  summary: "A short grounded summary.",
  keyPoints: ["First supported point."],
  limitations: [],
  pinningRisk: "If pinning is lost, this CID still identifies what was delivered, but the content may become unavailable.",
  requestSchemaVersion: 2,
  request,
  acceptanceCriteria: request.acceptanceCriteria,
};

const rejects = (fn, code) => assert.throws(fn, error => error instanceof DeliveryPreviewError && error.code === code);

test("only a canonical IPFS index delivery can derive result.json", () => {
  assert.equal(deriveResultJsonUrl(deliveryURI), resultUri);
  assert.equal(deriveResultJsonUrl(`ipfs://${cid}/index.html`), `https://ipfs.io/ipfs/${cid}/result.json`);
  for (const value of ["https://example.com/result.json", "https://user@example.com/ipfs/x/index.html", `https://gateway.example/ipfs/${cid}/other.html`, "javascript:alert(1)"]) {
    rejects(() => deriveResultJsonUrl(value), "unsupported_delivery_uri");
  }
});

test("validated previews bind exact job, request, criteria, schema and hash shape", () => {
  const preview = validateDeliveryArtifact(job, JSON.stringify(artifact), resultUri);
  assert.equal(preview.title, artifact.title);
  assert.equal(preview.sourceSha256, artifact.sourceSha256);
  assert.deepEqual(preview.keyPoints, artifact.keyPoints);

  const cases = [
    [{ ...artifact, jobId: "8" }, "job_binding_mismatch"],
    [{ ...artifact, sourceUrl: "https://example.com/other" }, "job_binding_mismatch"],
    [{ ...artifact, sourceSha256: "not-a-hash" }, "artifact_schema_mismatch"],
    [{ ...artifact, finalUrl: "https://127.0.0.1/private" }, "artifact_schema_mismatch"],
    [{ ...artifact, summary: "word ".repeat(251) }, "artifact_schema_mismatch"],
    [{ ...artifact, unexpected: true }, "artifact_schema_mismatch"],
    [{ ...artifact, acceptanceCriteria: ["changed"] }, "job_binding_mismatch"],
  ];
  for (const [value, code] of cases) rejects(() => validateDeliveryArtifact(job, JSON.stringify(value), resultUri), code);
  const duplicate = JSON.stringify(artifact).replace('"title":"Bound result"', '"title":"Wrong","title":"Bound result"');
  rejects(() => validateDeliveryArtifact(job, duplicate, resultUri), "malformed_artifact");
});

test("bounded JSON fetch pins public DNS, requests JSON and rejects unsafe redirects", async () => {
  const calls = [];
  const fetched = await fetchBoundedJson(resultUri, {
    resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
    request: async options => {
      calls.push(options);
      return { statusCode: 200, headers: { "content-type": "application/json", "content-length": "2" }, body: Buffer.from("{}") };
    },
  });
  assert.equal(fetched.body.toString(), "{}");
  assert.equal(calls[0].address, "93.184.216.34");
  assert.equal(calls[0].accept, "application/json");
  assert.equal(calls[0].maxBytes, 256 * 1024);

  let requests = 0;
  await assert.rejects(fetchBoundedJson(resultUri, {
    resolveHost: async hostname => hostname === "gateway.example" ? [{ address: "93.184.216.34", family: 4 }] : [{ address: "169.254.169.254", family: 4 }],
    request: async () => { requests++; return { statusCode: 302, headers: { location: "https://metadata.example/result.json" }, body: Buffer.alloc(0) }; },
  }), error => error.code === "unsafe_dns_answer");
  assert.equal(requests, 1);
});

test("delivery preview API returns sanitized validated fields and safe failures", async () => {
  const handler = createDeliveryPreviewHandler({ fetchJson: async () => ({ body: Buffer.from(JSON.stringify(artifact)) }) });
  const makeRequest = body => new Request("https://market.example/api/delivery-preview", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const response = await handler(makeRequest(job));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.preview.summary, artifact.summary);
  assert.equal(payload.preview.request, undefined);

  const bad = await handler(makeRequest({ ...job, deliverableURI: "https://example.com/file.html" }));
  assert.equal(bad.status, 422);
  assert.deepEqual(await bad.json(), { ok: false, reason: "unsupported_delivery_uri", retryable: false });
});

test("UI uses text-only JSON preview and preserves the canonical delivery link", async () => {
  const component = await readFile(new URL("../app/components/delivery-preview.js", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");
  assert.match(component, /Validated JSON only/);
  assert.match(component, /Remote HTML is never embedded/);
  assert.doesNotMatch(component, /dangerouslySetInnerHTML|<iframe|<object|<embed/);
  assert.match(page, /Delivery: \{job\.deliverableURI\}/);
  assert.match(page, /<DeliveryPreview[\s\S]*key=\{JSON\.stringify/);
  assert.match(component, /requestGeneration\.current/);
  assert.match(component, /state\.snapshot === snapshot/);
  assert.doesNotMatch(component, /href=\{preview\.finalUrl\}/);
  assert.match(component, /Source claim/);
});
