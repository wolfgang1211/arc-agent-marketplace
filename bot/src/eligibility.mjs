export const URL_SUMMARY_CATEGORY = "url-summary-v1";
export const GAS_RESERVE_WEI = 20_000_000_000_000_000n;
export const MIN_REWARD = 5_000000n;
export const MAX_REWARD = 20_000000n;

const EXPECTED_FIELDS = ["language", "maxWords", "schemaVersion", "sourceUrl", "task"];

export function hasGasReserve(balance, threshold = GAS_RESERVE_WEI) {
  return typeof balance === "bigint" && balance >= threshold;
}

export function parseEligibleJob(job) {
  if (typeof job?.status !== "number" || job.status !== 0) return reject("job_not_open");
  if (job?.category !== URL_SUMMARY_CATEGORY) return reject("unsupported_category");
  if (typeof job?.reward !== "bigint" || job.reward < MIN_REWARD || job.reward > MAX_REWARD) {
    return reject("reward_out_of_range");
  }

  let request;
  try {
    if (typeof job.description !== "string") throw new Error();
    if (hasDuplicateTopLevelKeys(job.description)) return reject("duplicate_json_field");
    request = JSON.parse(job.description);
  } catch {
    return reject("invalid_json");
  }
  if (!request || typeof request !== "object" || Array.isArray(request)) return reject("invalid_schema");
  const fields = Object.keys(request).sort();
  if (fields.length !== EXPECTED_FIELDS.length || fields.some((field, index) => field !== EXPECTED_FIELDS[index])) {
    return reject("schema_fields_mismatch");
  }
  if (request.schemaVersion !== 1) return reject("unsupported_schema");
  if (request.task !== "url_summary") return reject("unsupported_task");
  if (!isShallowSafeUrl(request.sourceUrl)) return reject("unsafe_url");
  if (!new Set(["en", "tr"]).has(request.language)) return reject("unsupported_language");
  if (!Number.isInteger(request.maxWords) || request.maxWords < 150 || request.maxWords > 600) {
    return reject("max_words_out_of_range");
  }
  return { ok: true, request };
}

function isShallowSafeUrl(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && (url.port === "" || url.port === "443")
      && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function hasDuplicateTopLevelKeys(text) {
  const keys = new Set();
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "{") { depth += 1; continue; }
    if (character === "}") { depth -= 1; continue; }
    if (character === "[") { depth += 1; continue; }
    if (character === "]") { depth -= 1; continue; }
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

function reject(reason) {
  return { ok: false, reason };
}
