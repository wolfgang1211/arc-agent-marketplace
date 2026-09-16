// Mirrored byte-for-byte in web/lib/url-summary-schema.mjs for standalone deployments.
// Frozen v2 protocol: changing these strings requires a new schema version.
export const URL_SUMMARY_CATEGORY = "url-summary-v1";
export const URL_SUMMARY_CRITERIA = Object.freeze([
  "Summarize only the supplied source in {language}, with no more than {maxWords} whitespace-separated words in the summary.",
  "Include 1 to 8 key points and 0 to 8 limitations; state uncertainty rather than inventing facts.",
  "Deliver an accessible IPFS page and result.json containing the source URL, final URL, fetch time, source hash, title, summary, key points, and limitations.",
]);
export function buildUrlSummaryCriteria({ language, maxWords }) {
  if (!["en", "tr"].includes(language) || !Number.isInteger(maxWords) || maxWords < 150 || maxWords > 600) throw new Error("invalid_criteria_parameters");
  return URL_SUMMARY_CRITERIA.map((text) => text.replace("{language}", language).replace("{maxWords}", String(maxWords)));
}
const V1_FIELDS = ["language", "maxWords", "schemaVersion", "sourceUrl", "task"];
const V2_FIELDS = ["acceptanceCriteria", ...V1_FIELDS];
const reject = (reason) => ({ ok: false, reason });

// Parses posted text only: never fills defaults or upgrades historical requests.
export function parseUrlSummaryDescription(description) {
  let request;
  try {
    if (typeof description !== "string") return reject("invalid_json");
    // The contract permits larger historical descriptions; v1 semantics are unchanged.
    request = JSON.parse(description);
    if (hasDuplicateTopLevelKeys(description)) return reject("duplicate_json_field");
  } catch { return reject("invalid_json"); }
  if (!request || typeof request !== "object" || Array.isArray(request)) return reject("invalid_schema");
  if (request.schemaVersion !== 1 && request.schemaVersion !== 2) return reject("unsupported_schema");
  if (request.schemaVersion === 2 && new TextEncoder().encode(description).length > 8192) return reject("description_too_large");
  const expected = request.schemaVersion === 1 ? V1_FIELDS : V2_FIELDS;
  const fields = Object.keys(request).sort();
  if (fields.length !== expected.length || fields.some((field, index) => field !== expected[index])) return reject("schema_fields_mismatch");
  if (request.task !== "url_summary") return reject("unsupported_task");
  if (!isShallowSafeUrl(request.sourceUrl)) return reject("unsafe_url");
  if (!["en", "tr"].includes(request.language)) return reject("unsupported_language");
  if (!Number.isInteger(request.maxWords) || request.maxWords < 150 || request.maxWords > 600) return reject("max_words_out_of_range");
  if (request.schemaVersion === 2) {
    const criteria = buildUrlSummaryCriteria(request);
    if (!Array.isArray(request.acceptanceCriteria) || request.acceptanceCriteria.length !== criteria.length
      || request.acceptanceCriteria.some((text, index) => text !== criteria[index])) return reject("acceptance_criteria_mismatch");
  }
  return { ok: true, request };
}
function isShallowSafeUrl(value) {
  if (typeof value !== "string" || !value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443") && Boolean(url.hostname);
  } catch { return false; }
}
function hasDuplicateTopLevelKeys(text) {
  const keys = new Set();
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "{" || character === "[") { depth += 1; continue; }
    if (character === "}" || character === "]") { depth -= 1; continue; }
    if (character !== '"') continue;
    const start = index;
    index += 1;
    while (index < text.length) {
      if (text[index] === "\\") { index += 2; continue; }
      if (text[index] === '"') break;
      index += 1;
    }
    if (depth !== 1 || index >= text.length) continue;
    let next = index + 1;
    while (/\s/.test(text[next] || "")) next += 1;
    if (text[next] !== ":") continue;
    const key = JSON.parse(text.slice(start, index + 1));
    if (keys.has(key)) return true;
    keys.add(key);
  }
  return false;
}
