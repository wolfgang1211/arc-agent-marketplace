export const URL_SUMMARY_CATEGORY = "url-summary-v1";
export const URL_SUMMARY_LANGUAGES = Object.freeze([
  Object.freeze({ value: "en", label: "English" }),
  Object.freeze({ value: "tr", label: "Turkish" }),
]);
export const URL_SUMMARY_MIN_WORDS = 150;
export const URL_SUMMARY_MAX_WORDS = 600;
export const URL_SUMMARY_MIN_REWARD = 5;
export const URL_SUMMARY_MAX_REWARD = 20;

export function validateUrlSummaryReward(reward) {
  const value = String(reward).trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) return false;
  const amount = Number(value);
  return Number.isFinite(amount)
    && amount >= URL_SUMMARY_MIN_REWARD
    && amount <= URL_SUMMARY_MAX_REWARD;
}

export function validateUrlSummaryRequest({ sourceUrl, language, maxWords }) {
  let parsed;
  try {
    parsed = new URL(String(sourceUrl || "").trim());
  } catch {
    return { valid: false, error: "Enter a valid source URL." };
  }

  if (parsed.protocol !== "https:") {
    return { valid: false, error: "URL must use HTTPS." };
  }
  if (parsed.username || parsed.password) {
    return { valid: false, error: "URL cannot include credentials." };
  }
  if (parsed.port && parsed.port !== "443") {
    return { valid: false, error: "URL must use port 443." };
  }
  if (!isObviouslyPublicHostname(parsed.hostname)) {
    return { valid: false, error: "URL must use a public hostname." };
  }
  if (!URL_SUMMARY_LANGUAGES.some((option) => option.value === language)) {
    return { valid: false, error: "Language must be English or Turkish." };
  }

  const words = Number(maxWords);
  if (!Number.isInteger(words)) {
    return { valid: false, error: "Maximum words must be a whole number." };
  }
  if (words < URL_SUMMARY_MIN_WORDS || words > URL_SUMMARY_MAX_WORDS) {
    return { valid: false, error: "Maximum words must be between 150 and 600." };
  }

  return {
    valid: true,
    value: {
      schemaVersion: 1,
      task: "url_summary",
      sourceUrl: parsed.toString(),
      language,
      maxWords: words,
    },
  };
}

function isObviouslyPublicHostname(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || /\.(?:local|internal|lan|home)$/.test(host)) {
    return false;
  }
  // Reject IPv6 literals here; the bot still performs the authoritative DNS/IP gate.
  if (host.includes(":")) return false;

  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return true;
  const [a, b, c, d] = parts.map(Number);
  if ([a, b, c, d].some((part) => part < 0 || part > 255)) return false;
  return !(
    a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 192 && b === 0 && (c === 0 || c === 2))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
  );
}

export function buildUrlSummaryDescription(request) {
  const result = validateUrlSummaryRequest(request);
  if (!result.valid) throw new Error(result.error);
  return JSON.stringify(result.value);
}
