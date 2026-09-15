import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, create } from "react-test-renderer";
import { transform } from "next/dist/build/swc/index.js";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, stringToHex } from "viem";
import { reportTypedData, validateVerifierReport, REPORT_WARNING } from "../lib/verifier-report.mjs";

const componentUrl = new URL("../app/components/verifier-evidence.js", import.meta.url);
const source = await readFile(componentUrl, "utf8");
const transformed = await transform(source, {
  filename: "verifier-evidence.js",
  jsc: { parser: { syntax: "ecmascript", jsx: true }, target: "es2022", transform: { react: { runtime: "automatic" } } },
  module: { type: "es6" },
});
// Resolve production imports in a data module; no mocked validator or renderer.
const code = transformed.code.replace(/from ["']([^"']+)["']/g, (_, specifier) => {
  const url = specifier.startsWith(".") ? new URL(specifier, componentUrl).href : import.meta.resolve(specifier);
  return `from ${JSON.stringify(url)}`;
});
const { VerifierEvidence, VerifierEvidenceResult } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const render = (component, props) => renderToStaticMarkup(createElement(component, props));

const account = privateKeyToAccount(`0x${"01".repeat(32)}`);
const job = { id: 1n, client: `0x${"22".repeat(20)}`, agent: `0x${"33".repeat(20)}`, description: "request", deliverableURI: "https://example.com/result.json" };
const expected = { chainId: "5042002", marketplace: `0x${"11".repeat(20)}`, jobId: "1", client: job.client, producer: job.agent,
  requestHash: keccak256(stringToHex(job.description)), artifactURI: job.deliverableURI,
  artifactSha256: `0x${"44".repeat(32)}`, criteriaHash: `0x${"55".repeat(32)}`, verifier: account.address };
async function result(verdict) {
  const report = { schemaVersion: "verifier-report-v1", ...expected, verdict, signatureScheme: "eip712-eoa-preview-v1" };
  report.signature = await account.signTypedData(reportTypedData(report));
  return validateVerifierReport(JSON.stringify(report), expected);
}

test("actual inspector initially renders collapsed, empty and disabled without a wallet", () => {
  const html = render(VerifierEvidence, { job, chainId: expected.chainId, marketplace: expected.marketplace });
  assert.match(html, /<details class="verifier-evidence">/);
  assert.doesNotMatch(html, /<details[^>]* open/);
  assert.match(html, /disabled=""[^>]*>Inspect report locally/);
  assert.equal((html.match(/<label>/g) || []).length, 4);
  assert.ok(html.includes(REPORT_WARNING));
  assert.doesNotMatch(html, /Signature and supplied bindings match/);
});

test("actual signed outcomes render as text-only advisory evidence with limitations", async () => {
  for (const verdict of ["checks_passed", "checks_failed", "inconclusive"]) {
    const validated = await result(verdict);
    assert.equal(validated.ok, true);
    const html = render(VerifierEvidenceResult, { result: validated });
    assert.match(html, /Advisory evidence only/);
    assert.match(html, /Not an on-chain acceptance or a validated protocol assessment/);
    assert.ok(html.includes(REPORT_WARNING));
    assert.match(html, /user-supplied comparison/);
    assert.match(html, /No criteria, artifact bytes, assignment consent/);
    assert.doesNotMatch(html, /<a |<iframe|<script|<button/);
  }
});

test("invalid or unavailable report never renders a favorable verdict", () => {
  assert.equal(render(VerifierEvidenceResult, { result: null }), "");
  const html = render(VerifierEvidenceResult, { result: { ok: false, reason: "Invalid report fields." } });
  assert.match(html, /Invalid report fields/);
  assert.doesNotMatch(html, /Checks passed|Advisory evidence only/);
});

test("JSON schema required fields track the actual validated report", async () => {
  const schema = JSON.parse(await readFile(new URL("../docs/verifier-report-v1.schema.json", import.meta.url), "utf8"));
  const validated = await result("checks_passed");
  assert.deepEqual([...schema.required].sort(), Object.keys(validated.report).sort());
  assert.deepEqual(Object.keys(schema.properties).sort(), [...schema.required].sort());
  assert.equal(schema.additionalProperties, false);
});

test("inspector has no wallet/network capabilities or outbound artifact rendering", async () => {
  const validator = await readFile(new URL("../lib/verifier-report.mjs", import.meta.url), "utf8");
  for (const code of [source, validator]) {
    assert.doesNotMatch(code, /from ["'](?:wagmi|wagmi\/actions|viem\/wallet)["']/);
    assert.doesNotMatch(code, /\b(?:fetch|writeContract|sendTransaction|signTypedData|signMessage|approveAndPay|disputeJob|claimTimeout)\s*\(/);
    assert.doesNotMatch(code, /dangerouslySetInnerHTML|localStorage|sessionStorage|<iframe|<a\s/);
  }
  assert.match(source, /generation\.current === current/);
  assert.match(source, /Nothing was inspected or truncated/);
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");
  const invocation = page.match(/<VerifierEvidence[\s\S]*?\/>/)[0];
  assert.doesNotMatch(invocation, /onApprove|onDispute|onClaim|onConnect/);
  for (const field of ["job.description", "job.deliverableURI", "job.client", "job.agent", "status"]) assert.ok(invocation.includes(field));
});

test("fresh compiled homepage retains advisory warnings (post-build guard)", async (t) => {
  const directory = new URL("../.next/static/chunks/app/", import.meta.url);
  const files = (await readdir(directory)).filter((name) => /^page-.*\.js$/.test(name));
  assert.ok(files.length, "Run npm run build before post-build tests");
  const compiled = (await Promise.all(files.map((name) => readFile(new URL(name, directory), "utf8")))).join("\n");
  // A pre-feature build may exist during the initial pre-build test run.
  // REQUIRE_VERIFIER_BUILD=1 makes freshness mandatory for release verification.
  if (process.env.REQUIRE_VERIFIER_BUILD !== "1" && !compiled.includes("Inspect optional verifier evidence")) return t.skip("Pre-feature build; mandatory fresh verification uses REQUIRE_VERIFIER_BUILD=1");
  for (const text of ["Inspect optional verifier evidence", "Advisory evidence only", "user-supplied comparison", "Not an on-chain acceptance", REPORT_WARNING]) assert.ok(compiled.includes(text), `Missing compiled warning: ${text}`);
});

test("real local inspection renders a signature result without network or wallet writes", async () => {
  const validated = await result("checks_passed");
  const originalFetch = globalThis.fetch;
  const originalEthereum = globalThis.ethereum;
  let calls = 0;
  globalThis.fetch = () => { calls++; throw new Error("No network permitted"); };
  globalThis.ethereum = { request: () => { calls++; throw new Error("No wallet permitted"); } };
  let tree;
  try {
    act(() => { tree = create(createElement(VerifierEvidence, { job, chainId: expected.chainId, marketplace: expected.marketplace })); });
    const inputs = tree.root.findAllByType("input");
    act(() => {
      for (const [index, value] of [expected.verifier, expected.artifactSha256, expected.criteriaHash].entries()) inputs[index].props.onChange({ target: { value } });
      tree.root.findByType("textarea").props.onChange({ target: { value: JSON.stringify(validated.report) } });
    });
    await act(async () => { await tree.root.findAllByType("button")[0].props.onClick(); });
    assert.match(JSON.stringify(tree.toJSON()), /Signature and supplied bindings match/);
    assert.match(JSON.stringify(tree.toJSON()), /key control, not account type/);
    assert.equal(calls, 0);
  } finally {
    if (tree) act(() => tree.unmount());
    globalThis.fetch = originalFetch;
    if (originalEthereum === undefined) delete globalThis.ethereum; else globalThis.ethereum = originalEthereum;
  }
});

test("pending real signature checks cannot survive edits, clear or keyed job remount", async () => {
  const validated = await result("checks_passed");
  for (const operation of ["edit", "clear", "remount", "unmount"]) {
    let tree;
    const props = { key: "old-snapshot", job, chainId: expected.chainId, marketplace: expected.marketplace };
    act(() => { tree = create(createElement(VerifierEvidence, props)); });
    act(() => {
      const inputs = tree.root.findAllByType("input");
      for (const [index, value] of [expected.verifier, expected.artifactSha256, expected.criteriaHash].entries()) inputs[index].props.onChange({ target: { value } });
      tree.root.findByType("textarea").props.onChange({ target: { value: JSON.stringify(validated.report) } });
    });
    let pending;
    act(() => {
      pending = tree.root.findAllByType("button")[0].props.onClick();
      if (operation === "edit") tree.root.findByType("textarea").props.onChange({ target: { value: "invalid" } });
      else if (operation === "clear") tree.root.findAllByType("button")[1].props.onClick();
      else if (operation === "remount") tree.update(createElement(VerifierEvidence, { ...props, key: "new-snapshot", job: { ...job, deliverableURI: "https://example.com/changed" } }));
      else tree.unmount();
    });
    await act(async () => { await pending; });
    assert.doesNotMatch(JSON.stringify(tree.toJSON()), /Signature and supplied bindings match|Checks passed/, operation);
    act(() => tree.unmount());
  }
});

test("oversized report paste clears prior evidence rather than truncating", async () => {
  let tree;
  act(() => { tree = create(createElement(VerifierEvidence, { job, chainId: expected.chainId, marketplace: expected.marketplace })); });
  act(() => { tree.root.findByType("textarea").props.onChange({ target: { value: "x".repeat(16385) } }); });
  assert.equal(tree.root.findByType("textarea").props.value, "");
  assert.match(JSON.stringify(tree.toJSON()), /Nothing was inspected or truncated/);
  act(() => tree.unmount());
});
