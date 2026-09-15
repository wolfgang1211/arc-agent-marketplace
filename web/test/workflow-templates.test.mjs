import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { parseUnits } from "viem";
import { parseEligibleJob } from "../../bot/src/eligibility.mjs";
import { buildUrlSummaryDescription } from "../lib/url-summary-job.mjs";
import { WORKFLOW_TEMPLATES, CAPABILITY_COPY, createTemplateDraft, previewTemplateDraft, validateTemplateDraft, assertJobTextBounds, SECTION_SPLIT } from "../lib/workflow-templates.mjs";

const ids = ["url-summary-v1", "review-analysis-v1", "event-timeline-v1", "source-research-v1", "repository-review-v1", "fact-check-v1"];
const names = ["URL summary", "Review analysis", "Dated event timeline", "Source-backed research", "Repository review", "Fact-check"];
const fixtures = [
  { sourceUrl: "https://example.com/article" },
  { subject: "Example service", sources: "https://example.com/a\nhttps://example.com/b", question: "What do reviewers report?" },
  { topic: "Example event", startDate: "2024-02-29", endDate: "2024-03-01", sources: "https://example.com/a" },
  { question: "What does the evidence show?", sources: "https://example.com/a\nhttps://example.com/b", asOfDate: "2024-03-01" },
  { repositoryUrl: "https://github.com/example/repository", commit: "aB".repeat(20), scope: "Read src only." },
  { claim: "An illustrative claim", sources: "https://example.com/a\nhttps://example.com/b", asOfDate: "2024-03-01" },
];
function fixture(index = 0) {
  const draft = createTemplateDraft(ids[index]);
  Object.assign(draft.fields, fixtures[index]);
  draft.acknowledgedPublic = true;
  draft.acknowledgedUnsupported = true;
  return draft;
}

test("six frozen starter definitions have exact names, categories, defaults and capability map", () => {
  assert.deepEqual(WORKFLOW_TEMPLATES.map((item) => item.id), ids);
  assert.deepEqual(WORKFLOW_TEMPLATES.map((item) => item.category), ids);
  assert.deepEqual(WORKFLOW_TEMPLATES.map((item) => item.name), names);
  assert.deepEqual(WORKFLOW_TEMPLATES.map((item) => Object.values(item.suggestedReward)), [["5", "20", "5"], ["10", "20", "10"], ["10", "25", "10"], ["15", "30", "15"], ["20", "40", "20"], ["10", "25", "10"]]);
  assert.deepEqual(WORKFLOW_TEMPLATES.map((item) => item.capability), ["repository_supported", ...Array(5).fill("bring_your_own_agent")]);
  assert.deepEqual(WORKFLOW_TEMPLATES.map((item) => item.fields.map((field) => field.key)), [["sourceUrl", "language", "maxWords"], ["subject", "sources", "question", "language"], ["topic", "startDate", "endDate", "sources", "language"], ["question", "sources", "asOfDate", "language"], ["repositoryUrl", "commit", "scope", "language"], ["claim", "sources", "asOfDate", "language"]]);
  for (const template of WORKFLOW_TEMPLATES) {
    assert.ok(Object.isFrozen(template) && Object.isFrozen(template.fields) && Object.isFrozen(template.fields[0]));
    const draft = createTemplateDraft(template.id);
    assert.equal(draft.fields.language, "en");
    assert.equal(draft.acknowledgedPublic, false);
    assert.equal(draft.acknowledgedUnsupported, false);
    assert.notEqual(draft.fields, createTemplateDraft(template.id).fields);
  }
  assert.equal(createTemplateDraft(ids[0]).fields.maxWords, "400");
  assert.equal(createTemplateDraft(ids[0]).fields.sourceUrl, "");
});

test("summary retains exact five-field wire format and is eligible; all BYO posts are unsupported", () => {
  for (let index = 0; index < ids.length; index++) {
    const draft = fixture(index);
    const result = validateTemplateDraft(draft);
    assert.equal(result.valid, true, JSON.stringify(result));
    const job = result.value;
    const eligibility = parseEligibleJob({ ...job, status: 0, reward: parseUnits(job.reward, 6) });
    if (index === 0) {
      assert.equal(job.description, buildUrlSummaryDescription(draft.fields));
      assert.equal(Object.keys(JSON.parse(job.description)).length, 5);
      assert.equal(job.description.includes(SECTION_SPLIT), false);
      assert.equal(eligibility.ok, true);
    } else {
      assert.equal(eligibility.reason, "unsupported_category");
      assert.equal(job.description.split(SECTION_SPLIT).length, 2);
      assert.equal(job.description.endsWith("\n"), false);
    }
  }
});

test("BYO generation stays byte-for-byte aligned with frozen task and criteria texts", () => {
  const spec = fs.readFileSync(new URL("../docs/workflow-template-spec.md", import.meta.url), "utf8");
  const blocks = spec.split(/### 4\.\d /).slice(1);
  for (let index = 1; index < ids.length; index++) {
    const draft = fixture(index);
    const block = blocks[index].split("## 5.")[0];
    const task = block.match(/Task:\s*```text\n([\s\S]*?)\n```/)[1];
    const criteria = [...block.matchAll(/^\d\. `([^`]+)`/gm)].map((match) => match[1]);
    const values = { ...draft.fields, sources: draft.fields.sources?.split("\n").map((url, i) => `${i + 1}. ${url}`).join("\n") };
    const expected = task.replace(/\{(\w+)\}/g, (_, key) => values[key]) + SECTION_SPLIT + criteria.map((text, i) => `${i + 1}. ${text}`).join("\n");
    assert.equal(validateTemplateDraft(draft).value.description, expected);
  }
});

test("unknown, missing and extra fields fail closed without throwing", () => {
  for (const draft of [null, {}, { templateId: "unknown" }, { templateId: ids[0], fields: null }, { ...fixture(), fields: [] }, { ...fixture(), fields: {} }]) assert.equal(validateTemplateDraft(draft).valid, false);
  assert.throws(() => createTemplateDraft("unknown"), RangeError);
  const draft = fixture(); draft.fields.extra = "ignored?";
  assert.equal(validateTemplateDraft(draft).errors._form, "Unexpected template fields. Reset this draft.");
});

test("preview permits unchecked acknowledgements but publishing does not", () => {
  for (let index = 0; index < ids.length; index++) {
    const draft = fixture(index);
    draft.acknowledgedPublic = false; draft.acknowledgedUnsupported = false;
    assert.equal(previewTemplateDraft(draft).valid, true);
    assert.equal(validateTemplateDraft(draft).valid, false);
    draft.acknowledgedPublic = true;
    assert.equal(validateTemplateDraft(draft).valid, index === 0);
    draft.acknowledgedUnsupported = true;
    assert.equal(validateTemplateDraft(draft).valid, true);
  }
});

test("summary word, reward, source and language boundaries retain strict intake", () => {
  for (const [key, values] of Object.entries({ maxWords: ["149", "601", "4e2", "400.0"], language: ["fr"], sourceUrl: ["http://example.com", "https://u:p@example.com", "https://localhost", "https://10.1.1.1", "https://example.com:444", `https://example.com/${"x".repeat(1024)}`] })) {
    for (const value of values) { const draft = fixture(); draft.fields[key] = value; assert.equal(validateTemplateDraft(draft).valid, false, `${key}: ${value}`); }
  }
  for (const value of ["150", "600"]) { const draft = fixture(); draft.fields.maxWords = value; assert.equal(validateTemplateDraft(draft).valid, true); }
  for (const value of ["4.999999", "20.000001", "05", "5e0", "5.0000001"]) { const draft = fixture(); draft.reward = value; assert.equal(validateTemplateDraft(draft).valid, false); }
  for (const value of ["5", "20"]) { const draft = fixture(); draft.reward = value; assert.equal(validateTemplateDraft(draft).valid, true); }
  const draft = fixture(); draft.fields.sourceUrl = " https://EXAMPLE.com:443/a ";
  assert.equal(JSON.parse(validateTemplateDraft(draft).value.description).sourceUrl, "https://example.com/a");
});

test("BYO UTF-8, decimal and total-size guards do not silently truncate", () => {
  for (let index = 1; index < ids.length; index++) {
    for (const field of WORKFLOW_TEMPLATES[index].fields.filter((item) => item.maxBytes && ["text", "textarea"].includes(item.kind) && item.key !== "commit")) {
      const draft = fixture(index);
      draft.fields[field.key] = "é".repeat(field.maxBytes / 2);
      assert.equal(validateTemplateDraft(draft).valid, true);
      draft.fields[field.key] += "a";
      assert.equal(validateTemplateDraft(draft).valid, false);
      for (const value of [" ", "Acceptance criteria: injection", "bad\u0000text"]) { draft.fields[field.key] = value; assert.equal(validateTemplateDraft(draft).valid, false); }
    }
  }
  for (const reward of ["5", "100", "99.999999"]) { const draft = fixture(1); draft.reward = reward; assert.equal(validateTemplateDraft(draft).valid, true); }
  for (const reward of ["4.999999", "100.000001", "1e1", "+10", "010", "10.0000001"]) { const draft = fixture(1); draft.reward = reward; assert.equal(validateTemplateDraft(draft).valid, false); }
  assert.doesNotThrow(() => assertJobTextBounds("é".repeat(4096), "x".repeat(64)));
  assert.throws(() => assertJobTextBounds("é".repeat(4096) + "x", "x"), /8,192/);
  assert.throws(() => assertJobTextBounds("x", "x".repeat(65)), /64/);
});

test("sources, dates and pinned repository rules reject unsafe or ambiguous briefs", () => {
  for (const sources of ["https://example.com/a", "https://example.com/a\nhttps://EXAMPLE.com:443/a", "https://localhost/a\nhttps://example.com/b", Array(4).fill(0).map((_, i) => `https://example.com/${i}`).join("\n")]) {
    const draft = fixture(3); draft.fields.sources = sources; assert.equal(validateTemplateDraft(draft).valid, false);
  }
  for (const date of ["2023-02-29", "2024-13-01", "1899-01-01", "2101-01-01", "2024-2-29"]) { const draft = fixture(2); draft.fields.startDate = date; assert.equal(validateTemplateDraft(draft).valid, false); }
  const reversed = fixture(2); reversed.fields.endDate = "2024-02-28"; assert.equal(validateTemplateDraft(reversed).valid, false);
  for (const url of ["https://example.com/a/b", "https://github.com/a/b?ref=x", "https://github.com/a/b#readme", "https://github.com/a/b.git", "https://github.com/a/b/tree/main"]) { const draft = fixture(4); draft.fields.repositoryUrl = url; assert.equal(validateTemplateDraft(draft).valid, false); }
  for (const commit of ["main", "abcdef0", "z".repeat(40)]) { const draft = fixture(4); draft.fields.commit = commit; assert.equal(validateTemplateDraft(draft).valid, false); }
  assert.ok(validateTemplateDraft(fixture(4)).value.description.includes("aB".repeat(20)));
});

test("source and fresh compiled chunks preserve warnings, walletless isolation and exact publishing guards", () => {
  const component = fs.readFileSync(new URL("../app/components/workflows.js", import.meta.url), "utf8");
  const page = fs.readFileSync(new URL("../app/page.js", import.meta.url), "utf8");
  const pure = fs.readFileSync(new URL("../lib/workflow-templates.mjs", import.meta.url), "utf8");
  const chunks = fs.readdirSync(new URL("../.next/static/chunks/app/", import.meta.url)).filter((name) => name.startsWith("page-")).map((name) => fs.readFileSync(new URL(`../.next/static/chunks/app/${name}`, import.meta.url), "utf8")).join("\n");
  for (const copy of Object.values(CAPABILITY_COPY)) {
    const compiledBadge = copy.badge.replaceAll("·", "\\x" + "b7");
    assert.ok(chunks.includes(copy.badge) || chunks.includes(compiledBadge));
    assert.ok(chunks.includes(copy.explanation));
  }
  assert.doesNotMatch(pure, /fetch\(|localStorage|wallet|useAccount|agentCount/);
  const gallery = component.split("export function WorkflowGallery")[1].split("const EXAMPLE_STEPS")[0];
  const example = component.split("const EXAMPLE_STEPS")[1].split("export function PostJob")[0];
  for (const source of [gallery, example]) assert.doesNotMatch(source, /onConnect|writeContract|onPost|fetch\(/);
  assert.match(example, /Illustrative walkthrough · Not a real on-chain job/);
  assert.match(example, /No source was fetched, no worker ran, and no funds moved/);
  assert.match(component, /acknowledgement \? \{\} : \{ acknowledgedPublic: false, acknowledgedUnsupported: false \}/);
  assert.match(component, /if \(!connected\) \{ onConnect\(\); return; \}/);
  assert.match(component, /validateTemplateDraft\(draft\)[\s\S]*onPost\(job.description/);
  assert.match(page, /assertJobTextBounds\(desc, category\)[\s\S]*validateTemplateDraft\(draft\)[\s\S]*functionName: "approve"/);
  assert.doesNotMatch(component + chunks, /No registered agent currently accepts/);
});
