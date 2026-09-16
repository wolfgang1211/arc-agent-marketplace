import { fetchEligibleSource, IntakeError } from "./safe-fetch.mjs";

const MAX_INPUT_BYTES = 8192;
const SAFE_REASONS = new Set([
  "unsafe_url", "dns_error", "dns_no_answers", "unsafe_dns_answer", "too_many_redirects",
  "redirect_without_location", "http_status", "unsupported_content_type", "response_too_large",
  "text_too_short", "text_too_long", "authentication_required", "paywall_or_access_denied",
  "invalid_content_encoding", "unsupported_content_encoding", "fetch_timeout", "fetch_failed",
]);

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
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 1 || typeof input.sourceUrl !== "string" || !input.sourceUrl.length || input.sourceUrl.length > 4096) throw Error();
    return input.sourceUrl;
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}

// Per-process concurrency bound, not a distributed rate limiter. Dependencies are
// only bounded DNS/HTTPS + parsing; no worker, upload, model or wallet imports.
export function createSourcePreflightHandler(options = {}) {
  let active = 0;
  return async function POST(request) {
    if (active >= 4) return reply({ ok: false, reason: "preflight_busy", retryable: true }, 503);
    active++;
    try {
      let sourceUrl;
      try { sourceUrl = await readInput(request); }
      catch { return reply({ ok: false, reason: "invalid_request", retryable: false }, 400); }
      try {
        await fetchEligibleSource(sourceUrl, options);
        return reply({ ok: true });
      } catch (error) {
        const known = error instanceof IntakeError && SAFE_REASONS.has(error.code);
        return reply({ ok: false, reason: known ? error.code : "fetch_failed", retryable: known ? !error.permanent : true });
      }
    } finally {
      active--;
    }
  };
}
