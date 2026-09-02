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
  if (String(reward).trim() === "") return false;
  const amount = Number(reward);
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

export function buildUrlSummaryDescription(request) {
  const result = validateUrlSummaryRequest(request);
  if (!result.valid) throw new Error(result.error);
  return JSON.stringify(result.value);
}
