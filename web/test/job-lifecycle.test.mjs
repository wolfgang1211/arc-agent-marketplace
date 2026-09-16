import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transform } from "next/dist/build/swc/index.js";
import { jobLifecycle, loadRecentActivity, chainDate, ACTIVITY_LIMIT, settlementOutcomeCopy } from "../lib/job-lifecycle.mjs";

const job = (status, id = 1n) => ({ id, status, reward: 5000001n, createdAt: 100n, deliveryDeadline: 200n, approvalDeadline: 300n, disputeDeadline: 400n, clientShareOnDispute: 5000n });
const states = (status) => Object.fromEntries(jobLifecycle(job(status), 500n).steps.map((step) => [step.key, step.state]));

test("all nine contract branches distinguish historical confirmation from pending or skipped steps", () => {
  const expected = [
    ["pending", "pending", "pending", "pending", "pending"],
    ["confirmed", "pending", "pending", "pending", "pending"],
    ["confirmed", "confirmed", "pending", "pending", "pending"],
    ["confirmed", "confirmed", "confirmed", "pending", "pending"],
    ["confirmed", "confirmed", "confirmed", "not-applicable", "confirmed"],
    ["not-applicable", "not-applicable", "not-applicable", "confirmed", "confirmed"],
    ["confirmed", "not-applicable", "not-applicable", "confirmed", "confirmed"],
    ["confirmed", "confirmed", "not-applicable", "confirmed", "confirmed"],
    ["confirmed", "confirmed", "confirmed", "confirmed", "confirmed"],
  ];
  expected.forEach((expectedStates, status) => {
    const actual = states(status);
    assert.equal(actual.posted, "confirmed");
    assert.equal(actual.funded, "confirmed");
    assert.deepEqual([actual.accepted, actual.submitted, actual.review, actual.timeout, actual.payment], expectedStates, `status ${status}`);
  });
  assert.equal(jobLifecycle(job(9), 500n), null);
  assert.equal(jobLifecycle(job(0, 0n), 500n), null);
});

test("deadline passage never implies timeout settlement; only chain time matters", () => {
  for (const [status, deadline] of [[1, 200n], [2, 300n], [3, 400n]]) {
    assert.match(jobLifecycle(job(status), deadline - 1n).deadline, /Not reached/);
    for (const now of [deadline, deadline + 1n]) {
      const model = jobLifecycle(job(status), now);
      assert.match(model.deadline, /settlement still pending/);
      assert.equal(model.steps.find((step) => step.key === "payment").state, "pending");
    }
    assert.match(jobLifecycle(job(status), null).deadline, /Chain time unavailable/);
  }
  const original = Date.now;
  Date.now = () => Number.MAX_SAFE_INTEGER;
  try { assert.match(jobLifecycle(job(1), 100n).deadline, /Not reached/); } finally { Date.now = original; }
});

test("payment evidence is exact for deterministic outcomes and honest about approval fees", () => {
  const detail = (status) => jobLifecycle(job(status), 500n).steps.at(-1).detail;
  assert.match(detail(4), /Exact net amount requires the JobApproved event/);
  assert.doesNotMatch(detail(4), /5\.000001 USDC paid/);
  assert.match(settlementOutcomeCopy(job(4)), /Gross reward: 5\.000001 USDC/);
  assert.match(settlementOutcomeCopy(job(4)), /Agent paid after any reputation fee/);
  assert.match(detail(5), /5\.000001 USDC refunded/);
  assert.match(detail(6), /5\.000001 USDC refunded/);
  assert.match(detail(7), /5\.000001 USDC paid/);
  assert.match(detail(8), /2\.500000 USDC to the client; 2\.500001 USDC to the agent/);
  assert.equal(jobLifecycle(job(7), 500n).steps.find((step) => step.key === "review").state, "not-applicable");
});

test("activity uses exactly two bounded reads pinned to the same block, sorted by creation ID", async () => {
  for (const count of [0n, 1n, 6n, 7n, 10000000000000000n]) {
    const calls = [];
    const offset = count > ACTIVITY_LIMIT ? count - ACTIVITY_LIMIT : 0n;
    const jobs = Array.from({ length: Number(count - offset) }, (_, index) => job(index % 9, offset + BigInt(index) + 1n));
    const snapshot = await loadRecentActivity({
      getBlock: async () => ({ number: 99n, timestamp: 500n }),
      readContract: async (...args) => { calls.push(args); return args[0] === "jobCount" ? count : [jobs, count]; },
    });
    assert.deepEqual(calls, [["jobCount", [], 99n], ["getJobsPaged", [offset, 6n], 99n]]);
    assert.deepEqual(snapshot.jobs.map((j) => j.id), [...jobs].reverse().map((j) => j.id));
    assert.equal(snapshot.blockNumber, 99n);
  }
});

test("RPC errors, missing blocks, inconsistent totals or records never become empty success", async () => {
  await assert.rejects(loadRecentActivity({ getBlock: async () => { throw new Error("offline"); } }), /offline/);
  await assert.rejects(loadRecentActivity({ getBlock: async () => ({ number: null }) }), /block number unavailable/);
  for (const page of [[[], 1n], [[job(0)], 2n], [[job(99)], 1n], [[job(0, 2n)], 1n]]) {
    await assert.rejects(loadRecentActivity({ getBlock: async () => ({ number: 99n, timestamp: 500n }), readContract: async (name) => name === "jobCount" ? 1n : page }));
  }
});

const componentUrl = new URL("../app/components/job-lifecycle.js", import.meta.url);
const source = await readFile(componentUrl, "utf8");
const transformed = await transform(source, { filename: "job-lifecycle.js", jsc: { parser: { syntax: "ecmascript", jsx: true }, target: "es2022", transform: { react: { runtime: "automatic" } } }, module: { type: "es6" } });
const code = transformed.code.replace(/from ["']([^"']+)["']/g, (_, specifier) => `from ${JSON.stringify(specifier.startsWith(".") ? new URL(specifier, componentUrl).href : import.meta.resolve(specifier))}`);
const { JobLifecycle, RecentActivityView } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const links = { explorer: "https://testnet.arcscan.app", marketplace: `0x${"11".repeat(20)}` };
const render = (component, props) => renderToStaticMarkup(createElement(component, { ...links, ...props }));

test("actual timeline renders collapsed and accessible for every status with honest explorer evidence", () => {
  for (let status = 0; status < 9; status++) {
    const html = render(JobLifecycle, { job: job(status), chainTimestamp: 500n });
    assert.match(html, /<details class="job-lifecycle">/);
    assert.equal((html.match(/<li /g) || []).length, 7);
    assert.match(html, /aria-label="Job 1 lifecycle"/);
    assert.ok(html.includes(`${links.explorer}/address/${links.marketplace}`));
    assert.doesNotMatch(html, /\/tx\//);
    assert.match(html, /transaction hashes are not available/);
  }
});

test("activity renders loading, retryable error, empty and bounded read evidence without stale claims", () => {
  const snapshot = { jobs: [job(7)], blockNumber: 99n, timestamp: 500n };
  const html = render(RecentActivityView, { snapshot });
  assert.match(html, /Approval timeout \/ paid/);
  assert.match(html, /not a latest-transition feed/);
  assert.match(html, /https:\/\/testnet.arcscan.app\/block\/99/);
  assert.match(html, /Posted 1970/);
  for (const state of [{ loading: true }, { error: "RPC failed" }]) {
    const output = render(RecentActivityView, { ...state, snapshot });
    assert.doesNotMatch(output, /Job #1|\/block\/99/);
  }
  assert.match(render(RecentActivityView, { snapshot: { ...snapshot, jobs: [] } }), /No jobs posted/);
  assert.match(render(RecentActivityView, { error: "RPC failed" }), /role="alert"/);
  assert.equal(chainDate("invalid"), "Timestamp unavailable");
});

test("integration keeps indexer progress out of lifecycle and pins reads to Arc", async () => {
  const page = await readFile(new URL("../app/page.js", import.meta.url), "utf8");
  const controller = await readFile(new URL("../app/components/recent-activity.js", import.meta.url), "utf8");
  assert.match(page, /<JobLifecycle job=\{job\}/);
  assert.match(page, /const terminalCopy = settlementOutcomeCopy\(job, agentStake\)/);
  assert.match(page, /functionName: "getJobsPaged",\s*chainId: arcTestnet.id/);
  assert.match(controller, /chainId: arcTestnet.id/);
  assert.match(controller, /functionName, args, blockNumber/);
  assert.match(controller, /return \(\) => \{ active = false; \}/);
  assert.doesNotMatch(controller, /fetchDiscovery|indexedDiscovery|getAllJobs|writeContract/);
});
