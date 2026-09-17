import { createTemplateDraft, previewTemplateDraft } from "./workflow-templates.mjs";

const MAX_BRIEF_BYTES = 4096;
const DATE = "(\\d{4}-\\d{2}-\\d{2})";
const SHA = "([0-9a-fA-F]{40})";
const PREFIXES = Object.freeze([
  ["repository-review-v1", /^(?:repository|repo) review\b/i],
  ["review-analysis-v1", /^review analysis\b/i],
  ["event-timeline-v1", /^(?:event )?timeline\b/i],
  ["source-research-v1", /^(?:source-backed )?research\b/i],
  ["fact-check-v1", /^fact[ -]check\b/i],
  ["url-summary-v1", /^(?:url )?(?:summary|summarize)\b/i],
]);
export const BRIEF_EXAMPLES = Object.freeze([
  "Summarize https://example.com/article in English, maximum 400 words",
  "Review analysis \"Example service\" question \"What do reviewers report?\" sources https://example.com/a https://example.com/b in English",
  "Timeline \"Example launch\" from 2026-01-01 to 2026-01-31 sources https://example.com/a in English",
  "Research \"What does the supplied evidence show?\" as of 2026-01-31 sources https://example.com/a https://example.com/b in English",
  `Repository review https://github.com/example/repository at ${"a".repeat(40)} scope \"Review src for correctness\" in English`,
  "Fact-check \"The example launched in January\" as of 2026-01-31 sources https://example.com/a https://example.com/b in English",
]);
const bytes = (value) => new TextEncoder().encode(value).length;
function failure(message, errors = {}) { return { valid: false, message, errors }; }
function languageCode(value) { return value?.toLowerCase() === "turkish" ? "tr" : "en"; }
function parseSourcesTail(tail, min) {
  const match = tail.match(/^sources?\s+(.+)$/i);
  if (!match) return null;
  const tokens = match[1].trim().split(/\s+/);
  let language = "en";
  if (tokens.length >= 2 && tokens.at(-2).toLowerCase() === "in" && /^(?:english|turkish)$/i.test(tokens.at(-1))) {
    language = languageCode(tokens.pop());
    tokens.pop();
  }
  if (tokens.length < min || tokens.length > 3 || tokens.some((token) => !/^https:\/\/\S+$/.test(token))) return null;
  return { sources: tokens.join("\n"), language };
}
function finish(templateId, fields) {
  const draft = createTemplateDraft(templateId);
  draft.fields = { ...draft.fields, ...fields };
  const preview = previewTemplateDraft(draft);
  return preview.valid
    ? { valid: true, draft, preview: preview.value }
    : failure("The brief matched a workflow but its values did not pass the workflow rules.", preview.errors);
}
export function compileConstrainedBrief(input) {
  if (typeof input !== "string" || !input.trim()) return failure("Enter a brief using one of the supported patterns.");
  const text = input.replace(/\r\n?/g, "\n").trim();
  if (bytes(text) > MAX_BRIEF_BYTES) return failure("Keep the brief under 4,096 UTF-8 bytes.");
  if (/[\x00-\x09\x0b-\x1f\x7f\u0085\u2028\u2029]/.test(text) || text.includes("\n")) return failure("Use one line without control characters.");
  if ((text.match(/"/g) || []).length % 2) return failure("Close every quoted field.");
  const matches = PREFIXES.filter(([, pattern]) => pattern.test(text));
  if (matches.length !== 1) return failure("Start with Summary, Review analysis, Timeline, Research, Repository review, or Fact-check.");
  const templateId = matches[0][0];

  if (templateId === "url-summary-v1") {
    const match = text.match(/^(?:url )?(?:summary|summarize)\s+(https:\/\/\S+?)(?:\s+in\s+(English|Turkish))?(?:,?\s+(?:max(?:imum)?\s+)?(\d{2,4})\s+words?)?$/i);
    if (!match) return failure("Use: Summarize URL [in English|Turkish] [maximum N words].");
    return finish(templateId, { sourceUrl: match[1], language: languageCode(match[2]), maxWords: match[3] || "400" });
  }
  if (templateId === "review-analysis-v1") {
    const match = text.match(/^review analysis\s+"([^"\r\n]+)"\s+question\s+"([^"\r\n]+)"\s+(.+)$/i);
    const sources = match && parseSourcesTail(match[3], 1);
    if (!match || !sources) return failure("Use: Review analysis \"subject\" question \"question\" sources URL [URL] [URL].");
    return finish(templateId, { subject: match[1], question: match[2], ...sources });
  }
  if (templateId === "event-timeline-v1") {
    const match = text.match(new RegExp(`^(?:event )?timeline\\s+"([^"\\r\\n]+)"\\s+from\\s+${DATE}\\s+to\\s+${DATE}\\s+(.+)$`, "i"));
    const sources = match && parseSourcesTail(match[4], 1);
    if (!match || !sources) return failure("Use: Timeline \"topic\" from YYYY-MM-DD to YYYY-MM-DD sources URL [URL] [URL].");
    return finish(templateId, { topic: match[1], startDate: match[2], endDate: match[3], ...sources });
  }
  if (templateId === "source-research-v1" || templateId === "fact-check-v1") {
    const prefix = templateId === "fact-check-v1" ? "fact[ -]check" : "(?:source-backed )?research";
    const match = text.match(new RegExp(`^${prefix}\\s+"([^"\\r\\n]+)"\\s+as of\\s+${DATE}\\s+(.+)$`, "i"));
    const sources = match && parseSourcesTail(match[3], 2);
    if (!match || !sources) return failure(`Use: ${templateId === "fact-check-v1" ? "Fact-check \"claim\"" : "Research \"question\""} as of YYYY-MM-DD sources URL URL [URL].`);
    return finish(templateId, { [templateId === "fact-check-v1" ? "claim" : "question"]: match[1], asOfDate: match[2], ...sources });
  }
  const match = text.match(new RegExp(`^(?:repository|repo) review\\s+(https:\\/\\/\\S+)\\s+at\\s+${SHA}\\s+scope\\s+"([^"\\r\\n]+)"(?:\\s+in\\s+(English|Turkish))?$`, "i"));
  if (!match) return failure("Use: Repository review GITHUB_URL at 40_CHAR_SHA scope \"scope\" [in English|Turkish].");
  return finish(templateId, { repositoryUrl: match[1], commit: match[2], scope: match[3], language: languageCode(match[4]) });
}
