import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, create } from "react-test-renderer";
import { transform } from "next/dist/build/swc/index.js";

const componentUrl = new URL("../app/components/job-views.js", import.meta.url);
const source = await readFile(componentUrl, "utf8");
const transformed = await transform(source, {
  filename: "job-views.js",
  jsc: { parser: { syntax: "ecmascript", jsx: true }, target: "es2022", transform: { react: { runtime: "automatic" } } },
  module: { type: "es6" },
});
const code = transformed.code.replace(/from ["']([^"']+)["']/g, (_, specifier) =>
  `from ${JSON.stringify(specifier.startsWith(".") ? new URL(specifier, componentUrl).href : import.meta.resolve(specifier))}`);
const { JobViewControls, JobViewEmpty, useJobView } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const props = { state: { view: "my-work", status: "all", page: 3 }, counts: { total: 8, open: 0, active: 3, settled: 5 }, dataStatus: "ready", connected: true };
const render = (Component, props) => renderToStaticMarkup(createElement(Component, props));

test("actual controls preserve public marketplace and explain bounded counts", () => {
  const html = render(JobViewControls, props);
  for (const text of ["Marketplace", "My Jobs", "My Work", "not your entire history", "In progress", "Settled"]) assert.ok(html.includes(text));
  assert.equal((html.match(/aria-pressed="true"/g) || []).length, 2);
  assert.match(html, /job-view-count">8/);
});

test("loading, error, and disconnected counts never present false zeros", () => {
  for (const [override, expected] of [[{ dataStatus: "loading" }, "…"], [{ dataStatus: "error" }, "—"], [{ connected: false }, "—"]]) {
    const html = render(JobViewControls, { ...props, ...override });
    assert.equal((html.match(new RegExp(`job-view-count">${expected}`, "g")) || []).length, 4);
  }
});

test("real ownership and status clicks emit navigation state without changing the wallet", () => {
  const changes = [];
  const tree = create(createElement(JobViewControls, { ...props, onChange: value => changes.push(value) }));
  const buttons = tree.root.findAllByType("button");
  act(() => buttons[1].props.onClick());
  act(() => buttons[5].props.onClick());
  assert.deepEqual(changes, [{ view: "my-jobs", page: 0 }, { status: "active" }]);
  tree.unmount();
});

test("wallet prompt and confirmed filtered empty state have separate recovery actions", () => {
  const prompt = render(JobViewEmpty, { ...props, connected: false, connectDisabled: true });
  assert.match(prompt, /Connect a wallet to view My Work/);
  assert.match(prompt, /disabled=""/);
  assert.doesNotMatch(prompt, /No matching/);
  const empty = render(JobViewEmpty, props);
  assert.match(empty, /No matching jobs on this page/);
  assert.match(empty, /Clear job filters/);
  assert.doesNotMatch(empty, /Connect a wallet/);
});

test("real URL hook restores deep links and back navigation, cleans up popstate", () => {
  const previousWindow = globalThis.window;
  let listener;
  const location = new URL("https://example.test/?view=my-work&status=settled&page=2#jobs");
  globalThis.window = {
    location,
    history: { pushState: (_state, _title, href) => { location.href = new URL(href, location).href; } },
    addEventListener: (name, callback) => { assert.equal(name, "popstate"); listener = callback; },
    removeEventListener: (name, callback) => { assert.equal(name, "popstate"); assert.equal(callback, listener); listener = undefined; },
  };
  let current;
  function Probe() { current = useJobView(); return null; }
  let tree;
  try {
    act(() => { tree = create(createElement(Probe)); });
    assert.deepEqual(current[0], { view: "my-work", status: "settled", page: 2 });
    act(() => current[1]({ view: "marketplace", page: 0 }));
    assert.equal(location.search, "?status=settled");
    act(() => { location.search = "?view=my-jobs&status=active&page=1"; listener(); });
    assert.deepEqual(current[0], { view: "my-jobs", status: "active", page: 1 });
    act(() => tree.unmount());
    assert.equal(listener, undefined);
  } finally { globalThis.window = previousWindow; }
});

test("integration uses one bounded job source and leaves indexer fallback intact", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");
  assert.match(page, /const JOB_PAGE_SIZE = 20n/);
  assert.match(page, /selectJobView\(jobList, jobView, isConnected \? address : undefined\)/);
  assert.match(page, /selectedJobs.jobs.map/);
  assert.match(page, /loadOnchainAgentFallback\(/);
  assert.match(page, /fetchDiscovery\(/);
  assert.doesNotMatch(source, /useReadContract|fetch\(|readContract|writeContract/);
});
