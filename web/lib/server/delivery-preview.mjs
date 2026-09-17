import { parseUrlSummaryDescription, URL_SUMMARY_CATEGORY } from "../url-summary-schema.mjs";
import { fetchBoundedJson, IntakeError, isPublicAddress } from "./safe-fetch.mjs";

const CID = /^(?:b[a-z2-7]{20,120}|Qm[1-9A-HJ-NP-Za-km-z]{44})$/;
const PINNING_RISK = "If pinning is lost, this CID still identifies what was delivered, but the content may become unavailable.";
const V1_FIELDS = ["fetchedAt", "finalUrl", "generatorVersion", "jobId", "keyPoints", "language", "limitations", "maxWords", "pinningRisk", "schemaVersion", "sourceBytes", "sourceSha256", "sourceUrl", "summary", "title"];
const V2_FIELDS = [...V1_FIELDS, "acceptanceCriteria", "request", "requestSchemaVersion"].sort();

export class DeliveryPreviewError extends Error {
  constructor(code) {
    super(code);
    this.name = "DeliveryPreviewError";
    this.code = code;
  }
}

export function deriveResultJsonUrl(deliveryUri) {
  if (typeof deliveryUri !== "string" || deliveryUri.length > 2048) throw new DeliveryPreviewError("unsupported_delivery_uri");
  let value = deliveryUri;
  if (value.startsWith("ipfs://")) {
    const match = value.match(/^ipfs:\/\/([^/?#]+)(?:\/index\.html)?$/);
    if (!match || !CID.test(match[1])) throw new DeliveryPreviewError("unsupported_delivery_uri");
    value = `https://ipfs.io/ipfs/${match[1]}/index.html`;
  }
  let url;
  try { url = new URL(value); } catch { throw new DeliveryPreviewError("unsupported_delivery_uri"); }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || url.search || url.hash) {
    throw new DeliveryPreviewError("unsupported_delivery_uri");
  }
  const match = url.pathname.match(/^(.*\/ipfs\/)([^/]+)\/index\.html$/);
  if (!match || !CID.test(match[2])) throw new DeliveryPreviewError("unsupported_delivery_uri");
  url.pathname = `${match[1]}${match[2]}/result.json`;
  return url.toString();
}

export function validateDeliveryArtifact(job, rawJson, resultUri) {
  if (job?.category !== URL_SUMMARY_CATEGORY) throw new DeliveryPreviewError("unsupported_artifact_type");
  const parsedRequest = parseUrlSummaryDescription(job?.description);
  if (!parsedRequest.ok) throw new DeliveryPreviewError("job_binding_mismatch");
  if (typeof rawJson !== "string" || Buffer.byteLength(rawJson) > 256 * 1024 || hasDuplicateObjectKeys(rawJson)) {
    throw new DeliveryPreviewError("malformed_artifact");
  }
  let artifact;
  try { artifact = JSON.parse(rawJson); } catch { throw new DeliveryPreviewError("malformed_artifact"); }
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) throw new DeliveryPreviewError("malformed_artifact");

  const request = parsedRequest.request;
  const expectedFields = request.schemaVersion === 2 ? V2_FIELDS : V1_FIELDS;
  const fields = Object.keys(artifact).sort();
  if (fields.length !== expectedFields.length || fields.some((field, index) => field !== expectedFields[index])) {
    throw new DeliveryPreviewError("artifact_schema_mismatch");
  }
  if (artifact.schemaVersion !== request.schemaVersion
    || artifact.generatorVersion !== `arc-url-summary-agent/${request.schemaVersion}.0.0`
    || artifact.jobId !== String(job.id)
    || artifact.sourceUrl !== request.sourceUrl
    || artifact.language !== request.language
    || artifact.maxWords !== request.maxWords) {
    throw new DeliveryPreviewError("job_binding_mismatch");
  }
  if (request.schemaVersion === 2) {
    if (artifact.requestSchemaVersion !== 2 || !sameRequest(artifact.request, request)
      || !sameStringArray(artifact.acceptanceCriteria, request.acceptanceCriteria)) {
      throw new DeliveryPreviewError("job_binding_mismatch");
    }
  }

  if (!isCleanHttps(artifact.finalUrl) || !isIsoDate(artifact.fetchedAt)
    || !/^[0-9a-f]{64}$/.test(artifact.sourceSha256)
    || !Number.isSafeInteger(artifact.sourceBytes) || artifact.sourceBytes < 1 || artifact.sourceBytes > 2 * 1024 * 1024
    || !boundedString(artifact.title, 1, 500)
    || !boundedString(artifact.summary, 1, 20_000)
    || wordCount(artifact.summary) > request.maxWords
    || !boundedStringArray(artifact.keyPoints, 1, 8, 2_000)
    || !boundedStringArray(artifact.limitations, 0, 8, 2_000)
    || artifact.pinningRisk !== PINNING_RISK) {
    throw new DeliveryPreviewError("artifact_schema_mismatch");
  }

  return Object.freeze({
    title: artifact.title,
    summary: artifact.summary,
    keyPoints: [...artifact.keyPoints],
    limitations: [...artifact.limitations],
    sourceUrl: artifact.sourceUrl,
    finalUrl: artifact.finalUrl,
    fetchedAt: artifact.fetchedAt,
    sourceSha256: artifact.sourceSha256,
    sourceBytes: artifact.sourceBytes,
    resultUri,
    pinningRisk: artifact.pinningRisk,
  });
}

export async function loadDeliveryPreview(job, options = {}) {
  const resultUri = deriveResultJsonUrl(job?.deliverableURI);
  let fetched;
  try {
    fetched = await (options.fetchJson || fetchBoundedJson)(resultUri, options.fetchOptions);
  } catch (error) {
    if (error instanceof DeliveryPreviewError) throw error;
    throw new DeliveryPreviewError(error instanceof IntakeError ? error.code : "preview_unavailable");
  }
  return validateDeliveryArtifact(job, fetched.body.toString("utf8"), resultUri);
}

function sameRequest(actual, expected) {
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
  const fields = expected.schemaVersion === 2
    ? ["acceptanceCriteria", "language", "maxWords", "schemaVersion", "sourceUrl", "task"]
    : ["language", "maxWords", "schemaVersion", "sourceUrl", "task"];
  const keys = Object.keys(actual).sort();
  if (keys.length !== fields.length || keys.some((key, index) => key !== fields[index])) return false;
  return actual.schemaVersion === expected.schemaVersion && actual.task === expected.task
    && actual.sourceUrl === expected.sourceUrl && actual.language === expected.language
    && actual.maxWords === expected.maxWords
    && (expected.schemaVersion !== 2 || sameStringArray(actual.acceptanceCriteria, expected.acceptanceCriteria));
}
function sameStringArray(actual, expected) {
  return Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}
function boundedString(value, minimum, maximum) {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum;
}
function boundedStringArray(value, minimum, maximum, itemMaximum) {
  return Array.isArray(value) && value.length >= minimum && value.length <= maximum
    && value.every((item) => boundedString(item, 1, itemMaximum));
}
function wordCount(value) { return String(value).trim().split(/\s+/).filter(Boolean).length; }
function isIsoDate(value) {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}
function isCleanHttps(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")
      || !host || host === "localhost" || host.endsWith(".localhost") || /\.(?:local|internal|lan|home)$/.test(host)
      || host.includes(":")) return false;
    return !/^\d+(?:\.\d+){3}$/.test(host) || isPublicAddress(host);
  } catch { return false; }
}
function hasDuplicateObjectKeys(text) {
  const stack = [];
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "{") { stack.push({ type: "object", keys: new Set() }); continue; }
    if (character === "[") { stack.push({ type: "array" }); continue; }
    if (character === "}" || character === "]") { stack.pop(); continue; }
    if (character !== '"') continue;
    const start = index;
    index += 1;
    while (index < text.length) {
      if (text[index] === "\\") { index += 2; continue; }
      if (text[index] === '"') break;
      index += 1;
    }
    let next = index + 1;
    while (/\s/.test(text[next] || "")) next += 1;
    const frame = stack.at(-1);
    if (text[next] !== ":" || frame?.type !== "object") continue;
    let key;
    try { key = JSON.parse(text.slice(start, index + 1)); } catch { return true; }
    if (frame.keys.has(key)) return true;
    frame.keys.add(key);
  }
  return false;
}
