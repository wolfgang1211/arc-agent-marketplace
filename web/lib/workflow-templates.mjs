import { parseUnits } from "viem";
import { buildUrlSummaryDescription, validateUrlSummaryRequest, validateUrlSummaryReward, URL_SUMMARY_LANGUAGES } from "./url-summary-job.mjs";
import { CATALOG } from "./workflow-catalog.mjs";

export const CAPABILITY_COPY = Object.freeze({
  repository_supported: Object.freeze({ badge: "Repository-supported worker", explanation: "A compatible URL-summary worker is implemented in this repository. Live availability and acceptance are not guaranteed." }),
  bring_your_own_agent: Object.freeze({ badge: "Template only · Bring your own agent", explanation: "No compatible worker is verified for this template. Arrange your own agent before posting; the job may remain open." }),
});
export const PUBLIC_COPY = "Job text and source URLs are public on-chain. Do not include secrets, personal data, private links, or access tokens.";
export const REWARD_COPY = "Suggested test budget, not a quote or a promise of acceptance. Network fees are separate.";
export const SECTION_SPLIT = "\n\nAcceptance criteria:\n";
const bytes = (text) => new TextEncoder().encode(text).length;
function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export const WORKFLOW_TEMPLATES = freeze(CATALOG.map((template) => ({ ...template, category: template.id, fields: template.fields.map((field) => ({ required: true, defaultValue: "", ...field, ...(field.key === "language" ? { options: URL_SUMMARY_LANGUAGES, defaultValue: "en" } : {}) })) })));
export function createTemplateDraft(id) {
  const template = WORKFLOW_TEMPLATES.find((item) => item.id === id);
  if (!template) throw new RangeError("Choose a known workflow template.");
  return { templateId: id, fields: Object.fromEntries(template.fields.map((field) => [field.key, field.defaultValue])), reward: template.suggestedReward.default, acknowledgedPublic: false, acknowledgedUnsupported: false };
}
export function assertJobTextBounds(description, category) {
  if (typeof description !== "string" || !description.trim() || bytes(description) > 8192) throw new Error("Job text exceeds 8,192 bytes. Shorten the inputs.");
  if (typeof category !== "string" || !category.trim() || bytes(category) > 64) throw new Error("Use a category of 1 to 64 UTF-8 bytes.");
}
export function validateWorkflowReward(reward) {
  if (typeof reward !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(reward.trim()) || reward.length > 20) return false;
  const amount = parseUnits(reward.trim(), 6);
  return amount >= 5000000n && amount <= 100000000n;
}
function validDate(value) {
  if (!/^(19\d\d|20\d\d|2100)-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function publicUrl(value) {
  if (bytes(value) > 1024) return { valid: false, error: "Use at most 1024 UTF-8 bytes." };
  return validateUrlSummaryRequest({ sourceUrl: value, language: "en", maxWords: 400 });
}
// Preview deliberately ignores acknowledgements; publication must use validateTemplateDraft.
export function previewTemplateDraft(draft) {
  const errors = {};
  const template = WORKFLOW_TEMPLATES.find((item) => item.id === draft?.templateId);
  if (!template) return { valid: false, errors: { _form: "Choose a known workflow template." } };
  if (!draft.fields || typeof draft.fields !== "object" || Array.isArray(draft.fields) || Object.keys(draft.fields).some((key) => !template.fields.some((field) => field.key === key))) return { valid: false, errors: { _form: "Unexpected template fields. Reset this draft." } };
  const values = {};
  for (const field of template.fields) {
    const raw = draft.fields[field.key];
    const value = typeof raw === "string" ? raw.replace(/\r\n?/g, "\n").trim() : "";
    values[field.key] = value;
    if (!value) errors[field.key] = "This field is required.";
    else if (/[\x00-\x09\x0b-\x1f\x7f]/.test(value) || value.includes("Acceptance criteria:") || (!["textarea", "url-list"].includes(field.kind) && value.includes("\n"))) errors[field.key] = "Remove control characters, newlines, or the reserved acceptance-criteria label.";
    else if (field.maxBytes && bytes(value) > field.maxBytes) errors[field.key] = `Use at most ${field.maxBytes} UTF-8 bytes.`;
    else if (field.kind === "select" && !field.options.some((option) => option.value === value)) errors[field.key] = "Language must be English or Turkish.";
    else if (field.kind === "integer" && !/^\d+$/.test(value)) errors[field.key] = "Maximum words must be a whole number.";
    else if (field.kind === "integer" && (Number(value) < field.min || Number(value) > field.max)) errors[field.key] = "Maximum words must be between 150 and 600.";
    else if (field.kind === "date" && !validDate(value)) errors[field.key] = "Enter a valid date as YYYY-MM-DD.";
    else if (field.kind === "url") {
      const result = publicUrl(value);
      if (!result.valid) errors[field.key] = result.error;
      else values[field.key] = result.value.sourceUrl;
    } else if (field.kind === "url-list") {
      const lines = value.split("\n").map((line) => line.trim()).filter(Boolean);
      const results = lines.map(publicUrl);
      const urls = results.filter((result) => result.valid).map((result) => result.value.sourceUrl);
      if (lines.length < field.min || lines.length > 3 || urls.length !== lines.length || new Set(urls).size !== lines.length) errors[field.key] = `Enter ${field.min} to 3 distinct public HTTPS URLs.`;
      else values[field.key] = urls.map((url, index) => `${index + 1}. ${url}`).join("\n");
    }
  }
  if (values.startDate && values.endDate && values.startDate > values.endDate) errors.endDate = "End date must be on or after start date.";
  if (template.id === "repository-review-v1") {
    const error = "Use a public GitHub repository URL and a full 40-character commit SHA.";
    if (!/^[0-9a-fA-F]{40}$/.test(values.commit)) errors.commit = error;
    try {
      const url = new URL(values.repositoryUrl);
      const segments = url.pathname.replace(/\/$/, "").split("/").slice(1);
      if (url.hostname !== "github.com" || url.search || url.hash || segments.length !== 2 || segments.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part) || [".", ".."].includes(part)) || /\.git\/?$/.test(url.pathname)) errors.repositoryUrl = error;
    } catch { errors.repositoryUrl = error; }
  }
  const summary = template.id === "url-summary-v1";
  if (!validateWorkflowReward(draft.reward) || (summary && !validateUrlSummaryReward(draft.reward))) errors.reward = summary ? "URL summary rewards must be between 5 and 20 USDC." : "Enter 5 to 100 test USDC with at most 6 decimal places.";
  if (Object.keys(errors).length) return { valid: false, errors };
  const interpolate = (text) => text.replace(/\{(\w+)\}/g, (_, key) => values[key]);
  const acceptanceCriteria = template.criteria.map(interpolate);
  const description = summary ? buildUrlSummaryDescription(values) : `${interpolate(template.task)}${SECTION_SPLIT}${acceptanceCriteria.map((criterion, index) => `${index + 1}. ${criterion}`).join("\n")}`;
  try { assertJobTextBounds(description, template.category); } catch (error) { return { valid: false, errors: { _form: error.message } }; }
  return { valid: true, value: { templateId: template.id, capability: template.capability, category: template.category, description, acceptanceCriteria, reward: draft.reward.trim(), descriptionBytes: bytes(description) } };
}
export function validateTemplateDraft(draft) {
  const result = previewTemplateDraft(draft);
  const errors = result.valid ? {} : { ...result.errors };
  if (draft?.acknowledgedPublic !== true) errors.acknowledgedPublic = "Confirm this acknowledgement before posting.";
  if (WORKFLOW_TEMPLATES.find((item) => item.id === draft?.templateId)?.capability === "bring_your_own_agent" && draft?.acknowledgedUnsupported !== true) errors.acknowledgedUnsupported = "Confirm this acknowledgement before posting.";
  return Object.keys(errors).length ? { valid: false, errors } : result;
}
