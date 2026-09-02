import { File } from "node:buffer";
import { isValidCid } from "./cid.mjs";

export const PINNING_RISK = "If pinning is lost, this CID still identifies what was delivered, but the content may become unavailable.";

export function buildArtifact({ jobId, sourceUrl, source, request, summary, fetchedAt }) {
  const result = {
    schemaVersion: 1,
    generatorVersion: "arc-url-summary-agent/1.0.0",
    jobId: String(jobId),
    sourceUrl,
    finalUrl: source.finalUrl,
    fetchedAt,
    sourceSha256: source.sourceSha256,
    sourceBytes: source.sourceBytes,
    title: source.title,
    language: request.language,
    maxWords: request.maxWords,
    summary: summary.summary,
    keyPoints: summary.keyPoints,
    limitations: summary.limitations,
    pinningRisk: PINNING_RISK,
  };
  const resultJson = `${JSON.stringify(result, null, 2)}\n`;
  const indexHtml = renderHtml(result);
  return { result, resultJson, indexHtml };
}

export async function pinArtifact({ artifact, pinataJwt, gatewayBase, fetchImpl = fetch, verificationDelayMs = 1_500 }) {
  if (!pinataJwt) throw new Error("PINATA_JWT is required");
  const gateway = validateGateway(gatewayBase);
  const folder = `arc-job-${artifact.result.jobId}`;
  const form = new FormData();
  form.append("file", new File([artifact.indexHtml], "index.html", { type: "text/html; charset=utf-8" }), `${folder}/index.html`);
  form.append("file", new File([artifact.resultJson], "result.json", { type: "application/json" }), `${folder}/result.json`);
  form.append("pinataMetadata", JSON.stringify({ name: folder, keyvalues: { jobId: artifact.result.jobId, schema: "url-summary-v1" } }));
  form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));

  let upload;
  try {
    upload = await fetchImpl("https://api.pinata.cloud/pinning/pinFileToIPFS", {
      method: "POST",
      headers: { Authorization: `Bearer ${pinataJwt}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new Error("pinata_upload_unavailable");
  }
  if (!upload.ok) throw new Error(`pinata_upload_http_${Number(upload.status) || "error"}`);
  let uploadResult;
  try {
    uploadResult = await upload.json();
  } catch {
    throw new Error("pinata_upload_invalid_json");
  }
  const cid = uploadResult?.IpfsHash;
  if (!isValidCid(cid)) throw new Error("pinata_upload_missing_cid");

  const root = `${gateway}/ipfs/${cid}`;
  await verifyGateway(`${root}/result.json`, artifact.resultJson, fetchImpl, verificationDelayMs);
  await verifyGateway(`${root}/index.html`, artifact.indexHtml, fetchImpl, verificationDelayMs);
  return {
    cid,
    deliveryUri: `${root}/index.html`,
    resultUri: `${root}/result.json`,
  };
}

async function verifyGateway(url, expected, fetchImpl, delayMs) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(url, { headers: { Accept: "*/*" }, signal: AbortSignal.timeout(60_000) });
    } catch {
      if (attempt === 5) throw new Error("gateway_verification_unavailable");
      await sleep(delayMs);
      continue;
    }
    if (!response.ok) {
      if (attempt === 5) throw new Error(`gateway_verification_http_${Number(response.status) || "error"}`);
      await sleep(delayMs);
      continue;
    }
    const actual = await response.text();
    if (actual !== expected) throw new Error("gateway_verification_mismatch");
    return;
  }
}

function sleep(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function validateGateway(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error();
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new Error("PINATA_GATEWAY_BASE must be a clean HTTPS URL");
  }
}

function renderHtml(result) {
  const points = result.keyPoints.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const limitations = result.limitations.length
    ? `<ul>${result.limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : "<p>None stated.</p>";
  return `<!doctype html>
<html lang="${escapeHtml(result.language)}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(result.title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;line-height:1.6;color:#18202b}code{overflow-wrap:anywhere}.meta{color:#536070;font-size:.9rem}.risk{border-left:4px solid #d99b18;padding:8px 12px;background:#fff8e8}</style></head>
<body><main><h1>${escapeHtml(result.title)}</h1><p class="meta">Job ${escapeHtml(result.jobId)} · fetched ${escapeHtml(result.fetchedAt)}</p>
<h2>Summary</h2><p>${escapeHtml(result.summary)}</p><h2>Key points</h2><ul>${points}</ul><h2>Limitations</h2>${limitations}
<h2>Provenance</h2><p>Source: <a href="${escapeAttribute(result.finalUrl)}">${escapeHtml(result.finalUrl)}</a></p><p>SHA-256: <code>${escapeHtml(result.sourceSha256)}</code></p>
<p class="risk">${escapeHtml(result.pinningRisk)}</p><p><a href="result.json">View machine-readable result.json</a></p></main></body></html>\n`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
