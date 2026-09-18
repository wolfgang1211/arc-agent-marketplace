import { parseUrlSummaryDescription, URL_SUMMARY_CATEGORY } from "./url-summary-schema.mjs";

export const WORKER_MIN_REWARD = 5_000000n;
export const WORKER_MAX_REWARD = 20_000000n;

const SCHEMA_REASONS = Object.freeze({
  invalid_json: "The URL summary brief is not valid JSON.",
  invalid_schema: "The URL summary brief must be a flat request object.",
  unsupported_schema: "The URL summary schema version is not supported.",
  description_too_large: "The URL summary brief exceeds the supported size.",
  schema_fields_mismatch: "The URL summary brief has missing or unsupported fields.",
  duplicate_json_field: "The URL summary brief contains duplicate fields.",
  unsupported_task: "The requested task is not URL summarization.",
  unsafe_url: "The source URL is not eligible for the managed worker.",
  unsupported_language: "The requested language is not supported.",
  max_words_out_of_range: "The requested summary length is outside the worker limits.",
  acceptance_criteria_mismatch: "The persisted acceptance criteria do not match this request.",
});

const PREFLIGHT_REASONS = Object.freeze({
  unsafe_url: "The source URL is not public HTTPS.",
  unsafe_dns_answer: "The source resolves to a private or reserved address.",
  dns_error: "The source hostname could not be resolved.",
  dns_no_answers: "The source hostname returned no addresses.",
  too_many_redirects: "The source redirects too many times.",
  redirect_without_location: "The source returned an invalid redirect.",
  http_status: "The source is not publicly accessible with HTTP 200.",
  unsupported_content_type: "The source is not HTML or plain text.",
  response_too_large: "The source exceeds the worker size limit.",
  text_too_short: "The source has too little readable text.",
  text_too_long: "The source has too much readable text.",
  authentication_required: "The source requires authentication.",
  paywall_or_access_denied: "The source has a paywall or access barrier.",
  invalid_content_encoding: "The source could not be safely decompressed.",
  unsupported_content_encoding: "The source uses an unsupported encoding.",
  fetch_timeout: "The source check timed out.",
  fetch_failed: "The source could not be fetched.",
  preflight_busy: "The source checker is busy.",
  invalid_request: "The source check request is invalid.",
});

const result = (state, label, reason, canAccept, reasonCode = null, request = null) =>
  Object.freeze({ state, label, reason, canAccept, reasonCode, request });

export function selectCurrentPreflight(preflight, request) {
  if (!preflight || !request || preflight.sourceUrl !== request.sourceUrl) return null;
  return preflight.result;
}

export function classifyJobExecutability(job, preflight) {
  if (typeof job?.status !== "number" || job.status !== 0) {
    return result("hidden", "Not open", "Executability is classified only for open jobs.", false, "job_not_open");
  }
  if (job?.category !== URL_SUMMARY_CATEGORY) {
    return result(
      "byo",
      "Bring your own agent",
      `The managed worker supports only ${URL_SUMMARY_CATEGORY}; a compatible external agent is required.`,
      true,
      "unsupported_category",
    );
  }
  if (typeof job?.reward !== "bigint" || job.reward < WORKER_MIN_REWARD || job.reward > WORKER_MAX_REWARD) {
    return result("invalid", "Invalid / unexecutable", "Managed-worker rewards must be between 5 and 20 USDC.", false, "reward_out_of_range");
  }

  const parsed = parseUrlSummaryDescription(job.description);
  if (!parsed.ok) {
    return result("invalid", "Invalid / unexecutable", SCHEMA_REASONS[parsed.reason] || "The brief does not match the managed-worker contract.", false, parsed.reason);
  }

  if (preflight === undefined || preflight === null || preflight.state === "pending") {
    return result("checking", "Checking source", "Confirming that the exact source is safe and accessible before this job can be accepted.", false, "preflight_pending", parsed.request);
  }
  if (preflight.state === "unavailable") {
    return result("unavailable", "Preflight unavailable", "The source could not be checked. No agent should accept this job until the check succeeds.", false, "preflight_unavailable", parsed.request);
  }
  if (preflight.ok === true && Object.keys(preflight).length === 1) {
    return result("compatible", "Compatible worker", "The managed URL Summary worker supports this brief and the source passed preflight.", true, null, parsed.request);
  }

  const reasonCode = Object.hasOwn(PREFLIGHT_REASONS, preflight.reason) ? preflight.reason : "fetch_failed";
  const retry = preflight.retryable === true ? " Retry the source check before acceptance." : " Replace the source before acceptance.";
  return result("invalid", "Invalid / unexecutable", `${PREFLIGHT_REASONS[reasonCode]}${retry}`, false, reasonCode, parsed.request);
}
