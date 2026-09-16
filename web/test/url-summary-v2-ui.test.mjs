import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, create } from "react-test-renderer";
import { transform } from "next/dist/build/swc/index.js";
import { createTemplateDraft, previewTemplateDraft } from "../lib/workflow-templates.mjs";
import { parseUrlSummaryDescription } from "../lib/url-summary-schema.mjs";
import { parseEligibleJob } from "../../bot/src/eligibility.mjs";

async function loadComponent(path) {
  const url = new URL(path, import.meta.url);
  const source = await readFile(url, "utf8");
  const transformed = await transform(source, { filename: url.pathname, jsc: { parser: { syntax: "ecmascript", jsx: true }, target: "es2022", transform: { react: { runtime: "automatic" } } }, module: { type: "es6" } });
  const code = transformed.code.replace(/from ["']([^"']+)["']/g, (_, specifier) => `from ${JSON.stringify(specifier.startsWith(".") ? new URL(specifier, url).href : import.meta.resolve(specifier))}`);
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}
const { JobDescription } = await loadComponent("../app/components/job-description.js");
const { PostJob, WorkflowExample } = await loadComponent("../app/components/workflows.js");
const draft = createTemplateDraft("url-summary-v1");
draft.fields.sourceUrl = "https://example.com/article";
draft.acknowledgedPublic = true;
const prepared = previewTemplateDraft(draft).value;
const render = (description, category = "url-summary-v1") => renderToStaticMarkup(createElement(JobDescription, { description, category }));

test("posted v2 job renders the persisted criteria, not a reconstructed preview", () => {
  const html = render(prepared.description);
  assert.match(html, /Acceptance criteria recorded on-chain · Request v2/);
  for (const criterion of JSON.parse(prepared.description).acceptanceCriteria) assert.ok(html.includes(criterion));
  assert.match(html, /View exact on-chain text/);
  assert.match(html, /Requirements only, not a verification verdict/);
});

test("legacy and unsupported requests never acquire v2 criteria", () => {
  const { acceptanceCriteria, ...v2 } = JSON.parse(prepared.description);
  const v1 = JSON.stringify({ ...v2, schemaVersion: 1 });
  const html = render(v1);
  assert.match(html, /Legacy request v1/);
  assert.match(html, /No v2 criteria are inferred/);
  assert.doesNotMatch(html, /<ol>|Acceptance criteria recorded on-chain/);
  assert.equal(Object.hasOwn(parseUrlSummaryDescription(v1).request, "acceptanceCriteria"), false);
  for (const description of ["not json", JSON.stringify({ ...v2, schemaVersion: 3 }), JSON.stringify({ ...v2, acceptanceCriteria: ["<script>injection</script>"] })]) {
    const invalid = render(description);
    assert.match(invalid, /cannot be interpreted safely/);
    assert.doesNotMatch(invalid, /<ol>|<script>/);
  }
});

test("generic jobs retain their original description and criteria", () => {
  const html = render("Review code\n\nAcceptance criteria:\n1. Read only", "custom");
  assert.match(html, /<h3>Review code<\/h3>/);
  assert.match(html, /1\. Read only/);
  assert.doesNotMatch(html, /Request v2/);
});

test("real form submission passes the exact preview to posting; walletless action only connects", () => {
  const posts = [];
  let connects = 0;
  let tree;
  const props = { draft, setDraft() {}, onPost: (...args) => posts.push(args), onConnect: () => connects++, connected: true, busy: false, disabled: false };
  act(() => { tree = create(createElement(PostJob, props)); });
  const previewText = tree.root.findAllByType("pre")[0].children.join("");
  assert.equal(previewText, prepared.description);
  act(() => tree.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  assert.equal(posts.length, 1);
  assert.equal(posts[0][0], previewText);
  assert.equal(parseEligibleJob({ description: posts[0][0], category: posts[0][2], status: 0, reward: 5000000n }).ok, true);
  act(() => tree.update(createElement(PostJob, { ...props, connected: false })));
  act(() => tree.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  assert.equal(connects, 1);
  assert.equal(posts.length, 1);
  act(() => tree.unmount());
});

test("illustrative walkthrough uses the same v2 builder", () => {
  let tree;
  act(() => { tree = create(createElement(WorkflowExample, { onSelect() {} })); });
  const text = tree.root.findByType("pre").children.join("");
  assert.equal(text, prepared.description);
  act(() => tree.unmount());
});
