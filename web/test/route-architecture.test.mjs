import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const app = new URL("../app/", import.meta.url);
const read = (path) => readFile(new URL(path, app), "utf8");

const routes = {
  "workflows/page.js": "workflows",
  "jobs/page.js": "jobs",
  "jobs/new/page.js": "post-job",
  "agents/page.js": "agents",
  "agents/register/page.js": "agent-register",
  "activity/page.js": "activity",
};

test("primary marketplace areas have focused route entry points", async () => {
  for (const [path, surface] of Object.entries(routes)) {
    const source = await read(path);
    assert.match(source, new RegExp(`surface=["']${surface}["']`), `${path} should bind ${surface}`);
    assert.match(source, /export const metadata/);
  }
});

test("job detail route uses the canonical marketplace surface and exact route ID", async () => {
  const [route, page] = await Promise.all([read("jobs/[id]/page.js"), read("page.js")]);
  assert.match(route, /surface="job-detail"/);
  assert.match(route, /jobId=\{params\?\.id\}/);
  assert.match(page, /const detailJobId = parseJobId\(jobId\)/);
  assert.match(page, /detailJobId - 1n/);
  assert.match(page, /pageSize = surface === "job-detail" \? 1n/);
  assert.match(page, /job\.id === detailJobId/);
});

test("navigation targets real routes and keeps post/register journeys separate", async () => {
  const [page, workflows] = await Promise.all([read("page.js"), read("components/workflows.js")]);
  for (const href of ["/workflows", "/jobs", "/agents", "/activity", "/jobs/new", "/agents/register"]) {
    assert.ok(page.includes(`href="${href}"`), `missing navigation target ${href}`);
  }
  assert.doesNotMatch(page, /Post or register|href="#actions"|href="#jobs"|href="#agents"/);
  assert.match(workflows, /href="\/workflows"/);
  assert.doesNotMatch(workflows, /href="\/#workflows"/);
});

test("compiled workflow handoff is validated again before becoming a posting draft", async () => {
  const page = await read("page.js");
  assert.match(page, /sessionStorage\.setItem\("marketplace-job-draft"/);
  assert.match(page, /const checked = previewTemplateDraft\(candidate\)/);
  assert.match(page, /if \(checked\.valid\) setWorkflowDraft\(candidate\)/);
  assert.match(page, /sessionStorage\.removeItem\("marketplace-job-draft"\)/);
});
