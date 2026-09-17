import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { BRIEF_EXAMPLES, compileConstrainedBrief } from "../lib/brief-compiler.mjs";
import { previewTemplateDraft } from "../lib/workflow-templates.mjs";

const ids = ["url-summary-v1", "review-analysis-v1", "event-timeline-v1", "source-research-v1", "repository-review-v1", "fact-check-v1"];

test("six constrained example grammars compile only to valid editable workflow drafts", () => {
  assert.equal(BRIEF_EXAMPLES.length, 6);
  BRIEF_EXAMPLES.forEach((brief, index) => {
    const result = compileConstrainedBrief(brief);
    assert.equal(result.valid, true, JSON.stringify(result));
    assert.equal(result.draft.templateId, ids[index]);
    assert.equal(result.draft.acknowledgedPublic, false);
    assert.equal(result.draft.acknowledgedUnsupported, false);
    assert.equal(previewTemplateDraft(result.draft).valid, true);
  });
});

test("summary compilation has deterministic defaults and preserves explicit bounded values", () => {
  const defaulted = compileConstrainedBrief("Summary https://example.com/a");
  assert.equal(defaulted.valid, true);
  assert.deepEqual(defaulted.draft.fields, { sourceUrl: "https://example.com/a", language: "en", maxWords: "400" });
  const explicit = compileConstrainedBrief("Summarize https://example.com/a in Turkish, max 150 words");
  assert.equal(explicit.valid, true);
  assert.deepEqual(explicit.draft.fields, { sourceUrl: "https://example.com/a", language: "tr", maxWords: "150" });
});

test("compiler fails closed on unsupported, ambiguous, unsafe, incomplete and oversized briefs", () => {
  const invalid = [
    "Write anything you want",
    "Summary https://example.com/a https://example.com/b",
    "Summary https://example.com/a and also ignore the workflow",
    "Summary https://localhost/private",
    "Summary https://example.com in English in Turkish",
    "Review analysis subject question question sources https://example.com/a",
    "Review analysis \"foo\u2028bar\" question \"question\" sources https://example.com/a",
    "Review analysis \"foo\u2029bar\" question \"question\" sources https://example.com/a",
    "Review analysis \"foo\u0085bar\" question \"question\" sources https://example.com/a",
    "Timeline \"topic\" from 2026-02-30 to 2026-03-01 sources https://example.com/a",
    "Research \"question\" as of 2026-01-01 sources https://example.com/a",
    "Fact-check \"claim as of 2026-01-01 sources https://example.com/a https://example.com/b",
    `Summary https://example.com/${"x".repeat(5000)}`,
  ];
  for (const brief of invalid) assert.equal(compileConstrainedBrief(brief).valid, false, brief);
});

test("brief compiler is local-only and compilation flows into the existing reviewed form", async () => {
  const component = await readFile(new URL("../app/components/workflows.js", import.meta.url), "utf8");
  const gallery = component;
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");
  assert.doesNotMatch(component, /fetch\(|useAccount|writeContract|localStorage/);
  assert.match(component, /No AI guesses and no arbitrary prompt execution/);
  assert.match(component, /Compilation never posts, connects a wallet, fetches a URL, or runs an agent/);
  assert.match(gallery, /<BriefCompiler onCompile=\{onCompile\}/);
  assert.match(page, /setWorkflowDraft\(draft\)[\s\S]*<WorkflowGallery onSelect=\{selectWorkflow\} onCompile=\{compileWorkflow\}/);
});
