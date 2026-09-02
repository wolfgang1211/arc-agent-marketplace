import assert from "node:assert/strict";
import test from "node:test";

import { buildArtifact, pinArtifact } from "../src/artifact.mjs";

const input = {
  jobId: 7n,
  sourceUrl: "https://example.com/article",
  source: {
    finalUrl: "https://example.com/final",
    title: `<script>alert("x")</script>Title`,
    sourceSha256: "a".repeat(64),
    sourceBytes: 1234,
  },
  request: { language: "en", maxWords: 400 },
  summary: {
    summary: "Grounded summary.",
    keyPoints: ["Point one", "Point two"],
    limitations: ["Single public source"],
  },
  fetchedAt: "2026-09-02T12:00:00.000Z",
};

test("builds matching human and machine artifacts with provenance and pinning risk", () => {
  const artifact = buildArtifact(input);
  assert.equal(artifact.result.jobId, "7");
  assert.equal(artifact.result.sourceSha256, "a".repeat(64));
  assert.equal(artifact.result.pinningRisk, "If pinning is lost, this CID still identifies what was delivered, but the content may become unavailable.");
  assert.deepEqual(JSON.parse(artifact.resultJson), artifact.result);
  assert.match(artifact.indexHtml, /Grounded summary\./);
  assert.match(artifact.indexHtml, /result\.json/);
  assert.doesNotMatch(artifact.indexHtml, /<script>alert/);
  assert.match(artifact.indexHtml, /&lt;script&gt;/);
});

test("uploads one IPFS directory, verifies both gateway bytes, and returns the index URI", async () => {
  const artifact = buildArtifact(input);
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("pinFileToIPFS")) {
      assert.equal(options.headers.Authorization, "Bearer pinata-secret");
      assert.equal(options.body instanceof FormData, true);
      assert.deepEqual(options.body.getAll("file").map((file) => file.name), ["arc-job-7/index.html", "arc-job-7/result.json"]);
      return { ok: true, json: async () => ({ IpfsHash: "bafkreidvbhs33ighmljlvr7zbv2ywwzcmp5adtf4kqvlly67cy56bdtmve" }) };
    }
    const body = String(url).endsWith("/result.json") ? artifact.resultJson : artifact.indexHtml;
    return { ok: true, text: async () => body };
  };
  const result = await pinArtifact({
    artifact,
    pinataJwt: "pinata-secret",
    gatewayBase: "https://example-gateway.mypinata.cloud",
    fetchImpl,
  });
  assert.equal(result.cid, "bafkreidvbhs33ighmljlvr7zbv2ywwzcmp5adtf4kqvlly67cy56bdtmve");
  assert.equal(result.deliveryUri, "https://example-gateway.mypinata.cloud/ipfs/bafkreidvbhs33ighmljlvr7zbv2ywwzcmp5adtf4kqvlly67cy56bdtmve/index.html");
  assert.equal(calls.length, 3);
});

test("rejects a malformed Pinata CID before gateway or chain use", async () => {
  const artifact = buildArtifact(input);
  let gatewayCalled = false;
  const fetchImpl = async (url) => {
    if (String(url).includes("pinFileToIPFS")) return { ok: true, json: async () => ({ IpfsHash: "not-a-cid" }) };
    gatewayCalled = true;
    throw new Error("must_not_fetch_gateway");
  };
  await assert.rejects(() => pinArtifact({ artifact, pinataJwt: "pinata-secret", gatewayBase: "https://example-gateway.mypinata.cloud", fetchImpl }), /pinata_upload_missing_cid/);
  assert.equal(gatewayCalled, false);
});

test("refuses to submit a gateway URI when retrieved bytes differ", async () => {
  const artifact = buildArtifact(input);
  const fetchImpl = async (url) => {
    if (String(url).includes("pinFileToIPFS")) return { ok: true, json: async () => ({ IpfsHash: "bafkreidvbhs33ighmljlvr7zbv2ywwzcmp5adtf4kqvlly67cy56bdtmve" }) };
    return { ok: true, text: async () => "tampered" };
  };
  await assert.rejects(() => pinArtifact({
    artifact,
    pinataJwt: "pinata-secret",
    gatewayBase: "https://example-gateway.mypinata.cloud",
    fetchImpl,
    verificationDelayMs: 0,
  }), /gateway_verification_mismatch/);
});

test("retries bounded gateway propagation before byte verification", async () => {
  const artifact = buildArtifact(input);
  let gatewayCalls = 0;
  const fetchImpl = async (url) => {
    if (String(url).includes("pinFileToIPFS")) return { ok: true, json: async () => ({ IpfsHash: "bafkreidvbhs33ighmljlvr7zbv2ywwzcmp5adtf4kqvlly67cy56bdtmve" }) };
    gatewayCalls += 1;
    if (gatewayCalls < 3) return { ok: false, status: 404, text: async () => "not ready" };
    return { ok: true, text: async () => String(url).endsWith("result.json") ? artifact.resultJson : artifact.indexHtml };
  };
  const result = await pinArtifact({ artifact, pinataJwt: "pinata-secret", gatewayBase: "https://example-gateway.mypinata.cloud", fetchImpl, verificationDelayMs: 0 });
  assert.equal(result.cid, "bafkreidvbhs33ighmljlvr7zbv2ywwzcmp5adtf4kqvlly67cy56bdtmve");
  assert.equal(gatewayCalls, 4);
});
