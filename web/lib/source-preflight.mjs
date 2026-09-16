const REASONS = Object.freeze({
  unsafe_url: "Use a public HTTPS URL without credentials or custom ports.",
  unsafe_dns_answer: "The source does not resolve exclusively to public addresses.",
  dns_error: "The source hostname could not be resolved.",
  dns_no_answers: "The source hostname returned no addresses.",
  too_many_redirects: "The source redirects too many times.",
  redirect_without_location: "The source returned an invalid redirect.",
  http_status: "The source did not return an accessible page (HTTP 200 required).",
  unsupported_content_type: "The source must be HTML or plain text.",
  response_too_large: "The source exceeds the 2 MiB size limit.",
  text_too_short: "The source has fewer than 500 readable characters.",
  text_too_long: "The source exceeds 100,000 readable characters.",
  authentication_required: "The source requires authentication.",
  paywall_or_access_denied: "The source has a paywall or access barrier.",
  invalid_content_encoding: "The source could not be safely decompressed.",
  unsupported_content_encoding: "The source uses an unsupported encoding.",
  fetch_timeout: "The source check timed out.",
  fetch_failed: "The source could not be fetched.",
  preflight_busy: "The source checker is busy.",
  invalid_request: "The source check request is invalid.",
});

class SourcePreflightError extends Error {}

// The continuation owns BOTH approve and postJob; failures never enter it.
// Deliberately do not cache: check the exact submitted source on every attempt.
export async function withSourcePreflight(category, description, continuePosting, fetchImpl = fetch) {
  if (category === "url-summary-v1") {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const { sourceUrl } = JSON.parse(description);
      const response = await fetchImpl("/api/source-preflight", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceUrl }), cache: "no-store", signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok || result?.ok !== true || Object.keys(result).length !== 1) {
        const reason = Object.hasOwn(REASONS, result?.reason) ? result.reason : "fetch_failed";
        const retry = result?.retryable === true ? " Try again before posting." : " Choose an accessible source before posting.";
        throw new SourcePreflightError(`Source check failed (${reason}): ${REASONS[reason]}${retry}`);
      }
    } catch (error) {
      // Never display a raw transport exception or an arbitrary server message.
      if (error instanceof SourcePreflightError) throw error;
      throw new Error("Source check unavailable. No wallet action was requested. Try again before posting.");
    } finally {
      clearTimeout(timer);
    }
  }
  return continuePosting();
}
