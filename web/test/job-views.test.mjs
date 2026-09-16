import assert from "node:assert/strict";
import test from "node:test";
import { readJobView, jobViewHref, selectJobView } from "../lib/job-views.mjs";

const me = "0xAbC";
const jobs = Array.from({ length: 9 }, (_, status) => ({ id: BigInt(status + 1), status, client: status % 2 ? "0xother" : "0xabc", agent: status === 0 ? "0x0000000000000000000000000000000000000000" : "0xABC" }));

test("role views match case-insensitively across every lifecycle state", () => {
  assert.equal(selectJobView(jobs, { view: "marketplace" }).jobs.length, 9);
  assert.deepEqual(selectJobView(jobs, { view: "my-jobs" }, me).jobs.map(j => j.id), [1n, 3n, 5n, 7n, 9n]);
  assert.equal(selectJobView(jobs, { view: "my-work" }, me).jobs.length, 8);
  assert.equal(selectJobView(jobs, { view: "my-work" }, undefined).jobs.length, 0);
  assert.equal(selectJobView(jobs, { view: "my-jobs" }, "0xother").jobs.length, 4);
  assert.equal(selectJobView(jobs, { view: "my-work" }, "0x0000000000000000000000000000000000000000").jobs.length, 0);
});

test("status counts are role-scoped before the selected status filter", () => {
  const result = selectJobView(jobs, { view: "my-work", status: "active" }, me);
  assert.deepEqual(result.counts, { open: 0, active: 3, settled: 5, total: 8 });
  assert.deepEqual(result.jobs.map(j => j.status), [1, 2, 3]);
  assert.equal(selectJobView(jobs, { view: "my-jobs", status: "settled" }, me).jobs.length, 3);
  assert.deepEqual(selectJobView([], { view: "marketplace" }).counts, { open: 0, active: 0, settled: 0, total: 0 });
  assert.equal(jobs.length, 9);
});

test("URL roundtrips role, status, and bounded page state without losing other parameters", () => {
  const href = jobViewHref("https://example.test/?template=url-summary-v1#jobs", { view: "my-work", status: "settled", page: 2 });
  assert.equal(href, "/?template=url-summary-v1&view=my-work&status=settled&page=2#jobs");
  assert.deepEqual(readJobView(new URL(href, "https://example.test").search), { view: "my-work", status: "settled", page: 2 });
  assert.equal(jobViewHref("https://example.test/?view=my-work&status=active&page=2#jobs", { view: "marketplace", status: "all", page: 0 }), "/#jobs");
});

test("malformed, negative, enormous, and unknown URL values fail to defaults", () => {
  for (const page of ["-1", "1.5", "Infinity", "999999999999999999999", "1e3", "nope"]) {
    assert.deepEqual(readJobView(`?view=unknown&status=bad&page=${page}`), { view: "marketplace", status: "all", page: 0 });
  }
});
