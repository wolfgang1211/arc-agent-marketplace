import { DeliveryPreviewError, loadDeliveryPreview } from "./delivery-preview.mjs";

const MAX_INPUT_BYTES = 16 * 1024;
const SAFE_REASONS = new Set([
  "unsupported_delivery_uri", "unsupported_artifact_type", "malformed_artifact", "artifact_schema_mismatch",
  "job_binding_mismatch", "unsafe_url", "dns_error", "dns_no_answers", "unsafe_dns_answer",
  "too_many_redirects", "redirect_without_location", "http_status", "unsupported_content_type",
  "response_too_large", "invalid_content_encoding", "unsupported_content_encoding", "fetch_timeout",
  "fetch_failed", "preview_unavailable",
]);
const RETRYABLE = new Set(["dns_error", "dns_no_answers", "http_status", "fetch_timeout", "fetch_failed", "preview_unavailable", "preview_busy"]);

function reply(value, status = 200) {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}

async function readInput(request) {
  if (request.method !== "POST" || request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json") throw Error();
  if (Number(request.headers.get("content-length")) > MAX_INPUT_BYTES || !request.body) throw Error();
  const reader = request.body.getReader();
  let timer;
  try {
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => { void reader.cancel().catch(() => {}); reject(Error()); }, 5000); });
    const chunks = [];
    let length = 0;
    while (true) {
      const { value, done } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      length += value.byteLength;
      if (length > MAX_INPUT_BYTES) throw Error();
      chunks.push(Buffer.from(value));
    }
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const keys = Object.keys(input || {}).sort();
    if (!input || typeof input !== "object" || Array.isArray(input)
      || keys.join(",") !== "category,deliverableURI,description,id"
      || typeof input.id !== "string" || !/^[1-9]\d{0,77}$/.test(input.id)
      || typeof input.category !== "string" || input.category.length > 100
      || typeof input.description !== "string" || Buffer.byteLength(input.description) > 8192
      || typeof input.deliverableURI !== "string" || input.deliverableURI.length > 2048) throw Error();
    return input;
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}

export function createDeliveryPreviewHandler(options = {}) {
  let active = 0;
  return async function POST(request) {
    if (active >= 4) return reply({ ok: false, reason: "preview_busy", retryable: true }, 503);
    active++;
    try {
      let job;
      try { job = await readInput(request); }
      catch { return reply({ ok: false, reason: "invalid_request", retryable: false }, 400); }
      try {
        const preview = await loadDeliveryPreview(job, options);
        return reply({ ok: true, preview });
      } catch (error) {
        const reason = error instanceof DeliveryPreviewError && SAFE_REASONS.has(error.code) ? error.code : "preview_unavailable";
        return reply({ ok: false, reason, retryable: RETRYABLE.has(reason) }, RETRYABLE.has(reason) ? 503 : 422);
      }
    } finally {
      active--;
    }
  };
}
